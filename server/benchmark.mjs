// AI provider benchmark — tests every available key/model combo,
// measures latency + JSON validity, then saves a live speed ranking to
//   server/ai-speed-rank.json
// Run:  node server/benchmark.mjs
// Rankings are loaded by config/ai.js so the fastest models are tried first.

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FALLBACK = 'C:/Users/mighty/Desktop/mcpherson-attendance/backend/.env'
const LOCAL = path.join(__dirname, '.env')

const env = { ...process.env }
for (const p of [LOCAL, FALLBACK]) {
  if (fs.existsSync(p)) Object.assign(env, dotenv.parse(fs.readFileSync(p, 'utf8')))
}

const BASE = {
  nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
}
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models'

// key -> provider + candidate models. Only include keys that are actually set.
const K = (name) => (env[name] && env[name].length > 20 && !/your_|placeholder|example/i.test(env[name]) ? env[name] : null)

// Only combos measured working on 2026-09-18 are kept. All end-of-life / no-access /
// no-credit / 30s-timeout pairs (z-ai glm, gpt-oss-20b, deepseek v4 flash, kimi,
// mistral, gemma, llama-3.3/3.1, phi-4, minimax, stepfun, koala, poolside, groq,
// gemini, openai-direct 429) were pruned so a re-run finishes quickly. Re-add a
// pair here if you later verify a provider works again.
const PAIRS = [
  // ── NVIDIA NIM ──
  ...(K('NVIDIA_ULTRA_KEY') ? [
    ['nvidia/nemotron-3-super-120b-a12b', 'nvidia', 'NVIDIA_ULTRA_KEY', 'ULTRA/Nemotron3Super'],
    ['nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'nvidia', 'NVIDIA_ULTRA_KEY', 'ULTRA/NanoOmni30B'],
  ] : []),
  ...(K('NVIDIA_ULTRA_KEY_2') ? [
    ['nvidia/nemotron-3-super-120b-a12b', 'nvidia', 'NVIDIA_ULTRA_KEY_2', 'ULTRA2/Nem3Super'],
  ] : []),
  ...(K('NVIDIA_NANO_KEY') ? [
    ['nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'nvidia', 'NVIDIA_NANO_KEY', 'NANO/NanoOmni30B'],
  ] : []),
  // ── AI Lab keys (server/.env — confirmed working by 60s retest 2026-09-18) ──
  ...(K('AI_LAB_KEY_1') ? [['nvidia/nemotron-3-super-120b-a12b', 'nvidia', 'AI_LAB_KEY_1', 'Lab1/Nem3Super']] : []),
  ...(K('AI_LAB_KEY_2') ? [['nvidia/nemotron-3-super-120b-a12b', 'nvidia', 'AI_LAB_KEY_2', 'Lab2/Nem3Super']] : []),
  ...(K('AI_LAB_KEY_3') ? [['nvidia/nemotron-3-ultra-550b-a55b', 'nvidia', 'AI_LAB_KEY_3', 'Lab3/Nem3Ultra']] : []),
  ...(K('AI_LAB_KEY_4') ? [['nvidia/nemotron-3-ultra-550b-a55b', 'nvidia', 'AI_LAB_KEY_4', 'Lab4/Nem3Ultra']] : []),
  ...(K('AI_LAB_KEY_5') ? [['meta/llama-3.2-11b-vision-instruct', 'nvidia', 'AI_LAB_KEY_5', 'Lab5/Llama11B']] : []),
  ...(K('AI_LAB_KEY_6') ? [['nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'nvidia', 'AI_LAB_KEY_6', 'Lab6/NanoOmni']] : []),
  // ── OpenRouter ──
  ...(K('OPENROUTER_API_KEY') ? [
    ['openai/gpt-4o-mini', 'openrouter', 'OPENROUTER_API_KEY', 'OR/GPT4o-mini'],
  ] : []),
]

const SYS = `You write exam multiple-choice questions. Return ONLY a JSON array, no extra text. Item shape: {"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"correct":"A","explanation":"short","topic":"...","difficulty":"easy"}`
const USER = process.env.BENCH_QUESTION || 'Generate exactly 3 DIFFERENT questions on Fractions for SS3 Mathematics.'
const PER_TEST_TIMEOUT = Number(process.env.BENCH_TIMEOUT || 30000)
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY || 6)

function cleanJson(raw) {
  if (!raw) return null
  let t = raw.trim()
  t = t.replace(/```(?:json)?/gi, '').replace(/^`+|`+$/g, '')
  const open = t.indexOf('[') >= 0 && (t.indexOf('[') < t.indexOf('{') || t.indexOf('{') === -1) ? '[' : '{'
  const close = open === '[' ? ']' : '}'
  const s = t.indexOf(open)
  const e = t.lastIndexOf(close)
  if (s === -1 || e === -1 || e < s) return null
  try { return JSON.parse(t.slice(s, e + 1)) } catch { return null }
}

async function testOne(pair) {
  const [model, provider, keyName, label] = pair
  const key = env[keyName]
  const t0 = Date.now()
  const controller = new AbortController()
  const timeoutMs = PER_TEST_TIMEOUT
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let content = null
    if (provider === 'gemini') {
      const res = await fetch(`${GEMINI}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${SYS}\n\n${USER}` }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 1500 },
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const b = await res.text().catch(() => '')
        return { model, provider, key: keyName, label, ok: false, ms: Date.now() - t0, status: res.status, detail: b.slice(0, 120) }
      }
      const data = await res.json()
      content = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || null
    } else {
      const res = await fetch(BASE[provider], {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYS },
            { role: 'user', content: USER },
          ],
          max_tokens: 1500,
          temperature: 0.5,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const b = await res.text().catch(() => '')
        return { model, provider, key: keyName, label, ok: false, ms: Date.now() - t0, status: res.status, detail: b.slice(0, 120) }
      }
      const data = await res.json()
      content = data?.choices?.[0]?.message?.content ?? null
    }
    const ms = Date.now() - t0
    const clean = cleanJson(content)
    const count = Array.isArray(clean) ? clean.length : 0
    return {
      model, provider, key: keyName, label,
      ok: count > 0, ms, status: 200,
      questions: count,
      detail: count > 0 ? `x${count}` : `bad/${typeof clean === 'object' ? 'obj' : 'null'}: ${String(content || '').slice(0, 80).replace(/\n/g, ' ')}`,
    }
  } catch (err) {
    return { model, provider, key: keyName, label, ok: false, ms: Date.now() - t0, status: 'ERR', detail: (err?.message || String(err)).slice(0, 110) }
  } finally {
    clearTimeout(timer)
  }
}

export async function runBenchmark(envOverride = null) {
  if (envOverride) Object.assign(env, envOverride)
  if (PAIRS.length === 0) {
    console.log('No configured keys with valid length were found — nothing to benchmark.')
    return { generatedAt: new Date().toISOString(), winners: [], all: [] }
  }
  const results = []
  let i = 0
  async function worker() {
    while (i < PAIRS.length) {
      const idx = i
      i += 1
      const r = await testOne(PAIRS[idx])
      results.push(r)
      process.stdout.write(`${r.ok ? '✓' : '✗'} ${String(r.ms).padStart(6)}ms  ${r.label.padEnd(26)} ${r.ok ? `${r.questions}q` : `${r.status} ${r.detail}`}\n`)
    }
  }
  const workers = Array.from({ length: CONCURRENCY }, () => worker())
  await Promise.all(workers)

  results.sort((a, b) => (a.ok === b.ok ? a.ms - b.ms : a.ok ? -1 : 1))

  if (!process.env.BENCH_QUIET) {
    console.log('\n─── Results (sorted by latency) ───')
    for (const r of results) {
      console.log(`${r.ok ? 'OK ' : 'X  '} ${String(r.ms).padStart(6)}ms  ${r.provider.padEnd(9)} ${r.key.padEnd(20)} ${(r.model || '').padEnd(42)} ${r.ok ? `${r.questions}q` : (r.status + ' ' + (r.detail || ''))}`)
    }
  }

  const winners = results.filter((r) => r.ok)
  const rankFile = path.join(__dirname, 'ai-speed-rank.json')
  let previous = null
  try {
    previous = JSON.parse(fs.readFileSync(rankFile, 'utf8'))
  } catch {
    previous = null
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    // A temporary network outage must not erase the last known-good ordering.
    winners: winners.length > 0 ? winners : (previous?.winners || []),
    all: results,
  }
  fs.writeFileSync(rankFile, JSON.stringify(payload, null, 2))
  if (!process.env.BENCH_QUIET) {
    const savedCount = payload.winners.length
    console.log(`\nSaved ${savedCount} working providers to ${rankFile}${winners.length === 0 && savedCount > 0 ? ' (kept previous ranking)' : ''}`)
  }
  return payload
}

// CLI: run when executed directly (node server/benchmark.mjs)
if (process.argv[1] && process.argv[1].includes('benchmark.mjs')) {
  await runBenchmark().catch((e) => { console.error(e); process.exit(1) })
}
