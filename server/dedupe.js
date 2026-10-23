import { EMBED_MODEL } from './config/ai.js'

// Near-duplicate detection for the question bank.
//
// The original design assumed Postgres + pgvector. This project runs on
// node:sqlite, so the vector work happens in JS: questions that were saved
// while an embedder was configured keep their vector in `questions.embedding`
// and are compared with cosine similarity. Without an embedder key (the common
// case for a single-school deployment) we fall back to normalised-text
// similarity, which still catches verbatim re-saves and light rewordings —
// the failure mode that actually produced duplicate bank entries.

const EMBED_ENABLED_DEFAULT = true

// Cosine similarity above which two questions are treated as the same question.
export const DUP_SIMILARITY = 0.96
// Fallback threshold for the text-only comparison (Jaccard over word trigrams).
export const DUP_TEXT_SIMILARITY = 0.82

export function dedupeEnabled(env) {
  const raw = String(env.DEDUPE_QUESTIONS ?? '').toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'off') return false
  if (raw === '1' || raw === 'true' || raw === 'on') return true
  return EMBED_ENABLED_DEFAULT
}

export function embedderConfigured(env) {
  const key = env[EMBED_MODEL.key]
  return Boolean(key && String(key).length >= 20)
}

/* ── text normalisation ─────────────────────────────────────────────────── */

const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'of', 'in', 'on', 'at', 'to', 'for', 'from',
  'by', 'with', 'and', 'or', 'if', 'then', 'that', 'this', 'these', 'those', 'it', 'its', 'as', 'what',
  'which', 'who', 'whom', 'whose', 'how', 'when', 'where', 'why', 'do', 'does', 'did', 'has', 'have', 'had',
])

export function normaliseText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9\s.+/*=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s) {
  return normaliseText(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w))
}

function trigrams(s) {
  const t = ` ${tokens(s).join(' ')} `
  const out = new Set()
  for (let i = 0; i + 3 <= t.length; i += 1) out.add(t.slice(i, i + 3))
  return out
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const g of a) if (b.has(g)) shared += 1
  return shared / (a.size + b.size - shared)
}

/* ── vectors ────────────────────────────────────────────────────────────── */

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/* ── embedder ───────────────────────────────────────────────────────────── */

const embedCache = new Map()

async function embedOne(env, text) {
  const key = env[EMBED_MODEL.key]
  const input = String(text || '').slice(0, 2000)
  const cacheKey = `${EMBED_MODEL.model}:${input}`
  const hit = embedCache.get(cacheKey)
  if (hit) return hit
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const r = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL.model, input: [input], input_type: 'query' }),
      signal: controller.signal,
    })
    if (!r.ok) throw new Error(`Embedding HTTP ${r.status}`)
    const data = await r.json()
    const vector = data?.data?.[0]?.embedding
    if (!Array.isArray(vector) || vector.length === 0) throw new Error('Embedding response had no vector')
    if (embedCache.size > 500) embedCache.clear()
    embedCache.set(cacheKey, vector)
    return vector
  } finally {
    clearTimeout(timer)
  }
}

// Embedding on the stem alone confuses a physics and a maths question that share
// wording, so the subject and the correct answer go in with it.
export function dedupeTextFor(q) {
  const answer = Array.isArray(q?.options) ? q.options[q.answer] : null
  return [
    q?.subject ? `Subject: ${q.subject}.` : '',
    q?.topic ? `Topic: ${q.topic}.` : '',
    `Question: ${q?.prompt || ''}`,
    answer ? `Answer: ${answer}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// Batches of 8 keep the request count sane without serialising a 200-question save.
const EMBED_BATCH = 8

export async function embedQuestions(env, questions) {
  if (!embedderConfigured(env)) return questions.map(() => null)
  const out = []
  for (let i = 0; i < questions.length; i += EMBED_BATCH) {
    const chunk = questions.slice(i, i + EMBED_BATCH)
    const vectors = await Promise.all(
      chunk.map((q) => embedOne(env, dedupeTextFor(q)).catch(() => null)),
    )
    out.push(...vectors)
  }
  return out
}

/* ── comparison against the bank ────────────────────────────────────────── */

// `rows` are the bank rows a teacher can see: { id, prompt, subject, topic, options, answer, embedding }.
export function findDuplicate(candidate, rows, { similarity = DUP_SIMILARITY } = {}) {
  const vector = Array.isArray(candidate.embedding) ? candidate.embedding : null
  const grams = trigrams(candidate.prompt)
  const norm = normaliseText(candidate.prompt)
  let best = null

  for (const row of rows) {
    if (row.id != null && candidate.id != null && row.id === candidate.id) continue
    let score = 0
    let method = 'text'
    if (vector && Array.isArray(row.embedding) && row.embedding.length === vector.length) {
      score = cosineSimilarity(vector, row.embedding)
      method = 'semantic'
    } else {
      if (normaliseText(row.prompt) === norm) score = 1
      else score = jaccard(grams, trigrams(row.prompt))
    }
    if (score <= best?.similarity) continue
    best = { id: row.id, prompt: row.prompt, subject: row.subject ?? null, similarity: score, method }
  }

  const threshold = vector ? similarity : DUP_TEXT_SIMILARITY
  return best && best.similarity >= threshold ? best : null
}
