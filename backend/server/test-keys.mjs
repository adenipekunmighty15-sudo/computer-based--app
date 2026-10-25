import fs from 'fs'
import dotenv from 'dotenv'

const BASE = 'https://integrate.api.nvidia.com/v1'
const fallback = 'C:/Users/mighty/Desktop/mcpherson-attendance/backend/.env'
const env = { ...process.env }
for (const p of ['C:/Users/mighty/Desktop/cbt app for t gold brighter tomorrow model school/server/.env.example', fallback]) {
  if (fs.existsSync(p)) Object.assign(env, dotenv.parse(fs.readFileSync(p, 'utf8')))
}

const pairs = [
  { key: env.NVIDIA_ULTRA_KEY, model: 'nvidia/nemotron-3.5-lightning-30b-a3b', label: 'ULTRA / Nemotron3.5Lightning', t: 60000 },
  { key: env.NVIDIA_ULTRA_KEY, model: 'nvidia/nemotron-nano-3-30b-a3b', label: 'ULTRA / NemotronNano3', t: 60000 },
  { key: env.NVIDIA_ULTRA_KEY, model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', label: 'ULTRA / NanoOmni30B', t: 60000 },
  { key: env.DEEPSEEK_KEY, model: 'deepseek-ai/deepseek-v4-flash-0731', label: 'DEEPSEEK / V4Flash-0731', t: 70000 },
  { key: env.ZAI_KEY, model: 'z-ai/glm-5.3-flash', label: 'ZAI / GLM5.3Flash', t: 70000 },
  { key: env.ZAI_KEY, model: 'z-ai/glm-5.3', label: 'ZAI / GLM5.3', t: 60000 },
  { key: env.KIMI_KEY, model: 'moonshotai/kimi-k2.6', label: 'KIMI / KimiK2.6', t: 60000 },
  { key: env.KIMI_KEY, model: 'moonshotai/kimi-k3', label: 'KIMI / KimiK3', t: 60000 },
  { key: env.NVIDIA_ULTRA_KEY, model: 'mistralai/mistral-large-2-instruct', label: 'ULTRA / MistralLarge2', t: 60000 },
  { key: env.MISTRAL_LARGE_KEY, model: 'mistralai/mistral-large-2-instruct', label: 'MISTRAL_KEY / MistralLarge2', t: 60000 },
  { key: env.NVIDIA_ULTRA_KEY, model: 'writer/palmyra-creative-122b', label: 'ULTRA / PalmyraCreative', t: 60000 },
  { key: env.NVIDIA_ULTRA_KEY, model: 'nv-mistralai/mistral-nemo-12b-instruct', label: 'ULTRA / MistralNemo12B', t: 60000 },
  { key: env.GEMMA4_KEY, model: 'google/gemma-4-31b-it', label: 'GEMMA4 / Gemma4-31B', t: 60000 },
  { key: env.POOLSIDE_KEY, model: 'poolside/laguna-xs-2.1', label: 'POOLSIDE / LagunaXS', t: 60000 },
  { key: env.NVIDIA_ULTRA_KEY, model: 'nvidia/nemotron-3-super-120b-a12b', label: 'ULTRA / Nemotron3Super', t: 60000 },
]

const sys = `You write exam multiple-choice questions. Return ONLY a JSON array, no extra text. Item shape: {"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"correct":"A","explanation":"short","topic":"...","difficulty":"easy"}`

async function test(p) {
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), p.t || 20000)
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: 'Generate exactly 3 DIFFERENT questions on Fractions for SS3 Mathematics.' },
        ],
        max_tokens: 1200,
        temperature: 0.5,
      }),
      signal: controller.signal,
    })
    const ms = Date.now() - t0
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { label: p.label, ok: false, ms, status: res.status, detail: body.slice(0, 140) }
    }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ''
    const t = content.trim().replace(/```(?:json)?/gi, '').replace(/^`+|`+$/g, '')
    const s = t.indexOf('[')
    const e = t.lastIndexOf(']')
    let parsed = false
    if (s >= 0 && e > s) { try { parsed = Array.isArray(JSON.parse(t.slice(s, e + 1))) } catch { parsed = false } }
    let count = 0
    if (parsed) { try { count = JSON.parse(t.slice(s, e + 1)).length } catch { count = 0 } }
    return { label: p.label, ok: true, ms, status: res.status, reply: `${parsed ? 'VALID' : 'BAD'}-JSON${count ? ` x${count}` : ''}: ${content.slice(0, 60).replace(/\n/g, ' ')}` }
  } catch (err) {
    return { label: p.label, ok: false, ms: Date.now() - t0, status: 'ERR', detail: (err?.message || String(err)).slice(0, 120) }
  } finally {
    clearTimeout(timer)
  }
}

const results = await Promise.all(pairs.map(test))
results.sort((a, b) => (a.ok === b.ok ? a.ms - b.ms : a.ok ? -1 : 1))
for (const r of results) {
  console.log(`${r.ok ? 'OK' : 'X'} ${String(r.status).padStart(3)} ${String(r.ms).padStart(6)}ms  ${r.label}  ${r.ok ? r.reply : r.detail}`)
}