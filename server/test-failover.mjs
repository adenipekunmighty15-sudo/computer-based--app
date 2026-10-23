import { callWithFailover, rankModels, liveEngines, engineHealth, CHAT_MODELS } from './config/ai.js'

// Run: node server/test-failover.mjs
// Exercises the failover + circuit-breaker contract with a stubbed network, so
// provider behaviour can be changed without spending real keys.

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`) }
  else console.log(`ok   ${name}`)
}

// Three CHAT_MODELS entries with unique keys, so each maps to exactly one engine.
const DEAD = 'AI_LAB_KEY_1', BUSY = 'AI_LAB_KEY_2', GOOD = 'AI_LAB_KEY_3', SOLO = 'AI_LAB_KEY_6'
const uniq = (ks) => ks.every((k) => CHAT_MODELS.filter((m) => m.key === k).length === 1)
check('test keys are unique per model entry', uniq([DEAD, BUSY, GOOD, SOLO]), true)

const k = (n) => `nvapi-${n}-${'x'.repeat(40)}`
const env = { [DEAD]: k('dead'), [BUSY]: k('busy'), [GOOD]: k('good') }

const good = { choices: [{ message: { content: '[{"question":"q1","options":["a","b","c","d"],"correct":"A"}]' } }] }
const calls = { [DEAD]: 0, [BUSY]: 0, [GOOD]: 0 }
const behaviour = {
  [DEAD]: () => ({ status: 404, body: 'not found' }),
  [BUSY]: () => ({ status: 503, body: 'ResourceExhausted' }),
  [GOOD]: () => ({ status: 200, body: good }),
}
const stub = () => async (_url, opts) => {
  const token = (opts.headers.Authorization || '').replace('Bearer ', '')
  const name = Object.keys(calls).find((n) => token === env[n])
  if (!name) return { ok: false, status: 500, headers: { get: () => null }, text: async () => 'unexpected key', json: async () => ({}) }
  calls[name]++
  const r = behaviour[name]()
  return { ok: r.status === 200, status: r.status, headers: { get: () => null }, text: async () => r.body, json: async () => r.body }
}
globalThis.fetch = stub()
const msgs = [{ role: 'user', content: 'go' }]

check('env resolves to exactly 3 engines', getUsable(env).length, 3)

// 1. A dead + a busy engine must not sink the request
const r1 = await callWithFailover(env, msgs, { timeoutMs: 5000 })
check('recovered via healthy engine', r1.model.key, GOOD)
check('dead tried exactly once', calls[DEAD], 1)
check('503 not retried (capacity error)', calls[BUSY], 1)

// 2. Both failures are now parked
check('404 cooling', engineHealth(find(DEAD)).cooling, true)
check('404 long cooldown', engineHealth(find(DEAD)).retryInMs > 1500000, true)
check('503 cooling', engineHealth(find(BUSY)).cooling, true)

// 3. Next request must not pay for them again
const before = { ...calls }
const r2 = await callWithFailover(env, msgs, { timeoutMs: 5000 })
check('second call succeeded', r2.model.key, GOOD)
check('cooling engines skipped', { dead: calls[DEAD] - before[DEAD], busy: calls[BUSY] - before[BUSY] }, { dead: 0, busy: 0 })

// 4. Ranking demotes them
check('healthy engine ranked first', rankModels(env)[0].key, GOOD)
check('only the healthy engine is live', liveEngines(rankModels(env)).map((m) => m.key), [GOOD])

// 5. All-cooling must still try rather than claim no AI exists
const soloEnv = { [SOLO]: k('solo') }
globalThis.fetch = async (_u, o) => {
  if (!o.headers.Authorization.includes(soloEnv[SOLO])) throw new Error('unexpected key')
  return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'nope', json: async () => ({}) }
}
try { await callWithFailover(soloEnv, msgs, { timeoutMs: 5000 }) } catch {}
const soloRanked = rankModels(soloEnv)
check('only engine is cooling', soloRanked[0].cooling, true)
check('all-cooling still offers an engine', liveEngines(soloRanked).map((m) => m.key), [SOLO])

// 6. An engine that answers but never returns usable JSON is retired too
globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{}', json: async () => ({ choices: [{ message: { content: 'Sorry, I cannot help with that.' } }] }) })
let msg = ''
try { await callWithFailover(soloEnv, msgs, { timeoutMs: 5000 }) } catch (e) { msg = e.message }
check('prose-only surfaces a real reason', /no usable JSON/.test(msg), true)

// 7. Fan-out stays capped and staggered instead of slamming every key at once
const manyEnv = {}
for (const m of CHAT_MODELS) if (!manyEnv[m.key]) manyEnv[m.key] = k(m.key)
let inFlight = 0, peak = 0
const starts = []
globalThis.fetch = async () => {
  starts.push(Date.now()); inFlight++; peak = Math.max(peak, inFlight)
  await new Promise((r) => setTimeout(r, 40))
  inFlight--
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{}', json: async () => ({ choices: [{ message: { content: '[{"question":"q","options":["a","b","c","d"],"correct":"A"}]' } }] }) }
}
await callWithFailover(manyEnv, msgs, { timeoutMs: 5000 })
check('fan-out capped at 6', peak <= 6, true)
check('configured engines exceed the cap', CHAT_MODELS.length > 6, true)
// 40ms responses with a 400ms stagger: starts must be spread, not simultaneous.
const gaps = starts.slice(1).map((t, i) => t - starts[i])
check('no wasted launches after the winner', starts.length <= 2, true)
check('launches are staggered, not simultaneous', gaps.length === 0 || gaps.every((g) => g >= 300), true)

function getUsable(e) { return rankModels(e) }
function find(key) { return CHAT_MODELS.find((m) => m.key === key) }

console.log(fails ? `\n${fails} FAILED` : "\nall passed")
process.exit(fails ? 1 : 0)



