// Test every candidate NVIDIA model against a single NVIDIA NIM key.
// Usage: node server/test-nvidia-key.mjs "nvapi-..."
// Each model gets a small MCQ prompt; "OK" means valid question JSON came back.

const KEY = process.argv[2] || process.env.NV_TEST_KEY

const CANDIDATES = [
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'nvidia/nemotron-nano-3-30b-a3b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'meta-llama/llama-3.2-11b-vision-instruct',
  'qwen/qwen2.5-72b-instruct',
  'cognitivecomputations/dolphin-2.9-llama-3.1-8b',
  'z-ai/glm-4.5-flash',
  'z-ai/glm-5.2',
  'z-ai/glm-5.3-flash',
  'deepseek-ai/deepseek-v4-flash-0731',
  'deepseek-ai/deepseek-v4-pro',
  'moonshotai/kimi-k2.6',
  'moonshotai/kimi-k3',
  'mistralai/mistral-large-2-instruct',
  'nv-mistralai/mistral-nemo-12b-instruct',
  'microsoft/phi-4-mini-instruct',
  'google/gemma-4-31b-it',
  'google/gemma-2-27b-it',
  'minimax/MiniMax-Text-01',
  'stepfun/step-1-8k-chat',
  'lnlabs/koala-70b',
  'poolside/laguna-xs-2.1',
  'poolside/laguna-3-flash',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'writer/palmyra-creative-122b',
]

if (!KEY) {
  console.error('Pass the key as argv[2] or set NV_TEST_KEY')
  process.exit(1)
}

const BASE = 'https://integrate.api.nvidia.com/v1/chat/completions'
const TIMEOUT_MS = Number(process.env.NV_TEST_TIMEOUT || 45000)
const CONCURRENCY = Number(process.env.NV_TEST_CONCURRENCY || 8)

const SYS = 'You write exam multiple-choice questions. Return ONLY a JSON array, no extra text. Item shape: {"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"correct":"A","explanation":"short","topic":"...","difficulty":"easy"}'
const USER = 'Generate exactly 3 DIFFERENT questions on Fractions for SS3 Mathematics.'

function cleanJson(raw) {
  if (!raw) return null
  let t = raw.trim().replace(/```(?:json)?/gi, '').replace(/^`+|`+$/g, '')
  const open = t.indexOf('[') >= 0 && (t.indexOf('[') < t.indexOf('{') || t.indexOf('{') === -1) ? '[' : '{'
  const close = open === '[' ? ']' : '}'
  const s = t.indexOf(open)
  const e = t.lastIndexOf(close)
  if (s === -1 || e === -1 || e < s) return null
  try { return JSON.parse(t.slice(s, e + 1)) } catch { return null }
}

async function testOne(model) {
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: USER }],
        max_tokens: 1500,
        temperature: 0.5,
      }),
      signal: controller.signal,
    })
    const ms = Date.now() - t0
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { model, ok: false, ms, status: res.status, detail: body.replace(/\s+/g, ' ').slice(0, 150) }
    }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.delta?.reasoning_content || ''
    const clean = cleanJson(content)
    const count = Array.isArray(clean) ? clean.length : 0
    return {
      model, ok: count > 0, ms, status: 200,
      questions: count,
      detail: count > 0 ? `x${count}` : `bad: ${String(content || '').slice(0, 80).replace(/\s+/g, ' ')}`,
    }
  } catch (err) {
    return { model, ok: false, ms: Date.now() - t0, status: 'ERR', detail: (err?.message || String(err)).slice(0, 110) }
  } finally {
    clearTimeout(timer)
  }
}

const results = []
let i = 0
async function worker() {
  while (i < CANDIDATES.length) {
    const idx = i
    i += 1
    const r = await testOne(CANDIDATES[idx])
    results.push(r)
    process.stdout.write(`${r.ok ? '✓' : '✗'} ${String(r.status).padStart(3)} ${String(r.ms).padStart(6)}ms  ${r.model.padEnd(44)} ${r.ok ? `${r.questions}q` : r.detail}\n`)
  }
}
const workers = Array.from({ length: CONCURRENCY }, () => worker())
await Promise.all(workers)

results.sort((a, b) => (a.ok === b.ok ? a.ms - b.ms : a.ok ? -1 : 1))
console.log('\n─── Working models (sorted by latency) ───')
for (const r of results) {
  if (r.ok) console.log(`OK  ${String(r.ms).padStart(6)}ms  ${r.model}`)
}
console.log('\n─── Failures ───')
for (const r of results) {
  if (!r.ok) console.log(`X   ${String(r.status).padStart(3)} ${String(r.ms).padStart(6)}ms  ${r.model.padEnd(44)} ${r.detail}`)
}