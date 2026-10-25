/* server/web-source.js — the internet fallback for CBT Question Lab.
 *
 * Everything in here exists for one reason: the AI engines can all be down at the
 * same time. That is not hypothetical on this project. Every configured model
 * provider (NVIDIA, OpenRouter, Gemini) returned 503/timeout/404 together in
 * production logs, and the old answer to that was a hard-coded template that
 * ignored the teacher's subject entirely and produced four variants of "Which
 * option best completes the statement". A teacher who asked for photosynthesis
 * questions got questions about "practice" and "regularity".
 *
 * So when generation fails we go and READ THE ACTUAL INTERNET. Two independent
 * strategies, in priority order:
 *
 *   1. harvestPastQuestions() — search the web for real exam questions on the
 *      topic, fetch the pages, and lift genuine MCQs (stem, options, answer) off
 *      them. These are authentic past-question items with a real answer key, and
 *      every one keeps the URL it came from.
 *
 *   2. buildFromWikipedia() — read the encyclopedia article on the topic and
 *      build verifiable questions from it deterministically: "which statement
 *      about X is correct" (correct = a real sentence from the article,
 *      distractors = the opening sentences of three sibling articles, so they
 *      are the same shape of statement and genuinely plausible) and cloze
 *      questions that blank out a key term. No model is involved, so the answers
 *      are right by construction.
 *
 * For pictures there is findWebImage(), which searches Wikimedia Commons — no
 * key, no quota, no rate limit, and it is the one image source that reliably
 * returns a labelled diagram for "water cycle" or "solenoid circuit".
 *
 * Nothing here silently pretends to be AI. Every question carries a `source`
 * field ('web-past-question' or 'web-encyclopedia') and every image carries its
 * licence and URL, so the teacher can see where the content came from and check
 * it.
 */

// ── HTTP plumbing ───────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

// Ceilings for everything that touches a stranger's server. A web fallback runs
// while the user is waiting on a paper, so it must never become the reason a
// request hangs: every fetch is bounded, and the whole harvest shares a
// wall-clock budget that callers pass in.
const MAX_BYTES = 6 * 1024 * 1024
const DEFAULT_FETCH_MS = 12000

async function httpGet(url, { timeoutMs = DEFAULT_FETCH_MS, binary = false, accept, userAgent } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': userAgent || UA,
        'Accept-Language': 'en-US,en;q=0.9',
        ...(accept ? { Accept: accept } : {}),
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}`, retryAfter: Number(res.headers.get('retry-after')) || 0 }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES) return { ok: false, status: res.status, error: `response too large (${buf.length} bytes)` }
    return {
      ok: true,
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      body: binary ? buf : buf.toString('utf8'),
      finalUrl: res.url || url,
    }
  } catch (err) {
    const msg = String(err?.message || err)
    return { ok: false, status: 0, error: /abort/i.test(msg) ? `timed out after ${timeoutMs}ms` : msg }
  } finally {
    clearTimeout(timer)
  }
}

export function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br|table|td|th|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Web search ──────────────────────────────────────────────────────────────

/* DuckDuckGo's HTML endpoint has no API key, which is the whole appeal, but it
 * is also aggressively rate limited: measured 2026-10-03, the third query inside
 * a few seconds comes back HTTP 202 with a stub page and zero results, and it
 * stays that way for the rest of the burst. So every search goes through one
 * serialised queue with a minimum gap, and a 202 is treated as "throttled" —
 * retried with a growing gap rather than parsed as "no results". Parsing it as
 * "no results" is how a fallback silently stops working. */
const SEARCH_GAP_MS = 5000
let searchChain = Promise.resolve()
let lastSearchAt = 0

async function throttledSearch(rawQuery, timeoutMs) {
  const run = async () => {
    const wait = Math.max(0, lastSearchAt + SEARCH_GAP_MS - Date.now())
    if (wait > 0) await sleep(wait)
    lastSearchAt = Date.now()
    return rawQuery()
  }
  // Chain onto the queue so concurrent callers serialise instead of all arriving
  // inside the same throttle window.
  const next = searchChain.then(run, run)
  searchChain = next.catch(() => {})
  return next
}

// Serialised + spaced, with a growing gap when the engine pushes back.
export async function searchWeb(query, { limit = 8, timeoutMs = 12000 } = {}) {
  const q = String(query || '').trim()
  if (!q) return []
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`
  let gap = SEARCH_GAP_MS
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await throttledSearch(() => httpGet(url, { timeoutMs }), timeoutMs)
    if (!res.ok) {
      if (attempt === 2) return []
      gap = Math.min(gap * 2, 30000)
      await sleep(gap)
      continue
    }
    const results = parseSearchResults(res.body, limit)
    // HTTP 202 with no results is the throttle page, not an empty result set.
    if (!results.length && attempt < 2) {
      gap = Math.min(gap * 2, 30000)
      await sleep(gap)
      continue
    }
    return results
  }
  return []
}

// DuckDuckGo wraps outbound links in /l/?uddg=<urlencoded>. Unwrap it.
export function parseSearchResults(html, limit = 8) {
  const out = []
  const seen = new Set()
  const anchor = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = anchor.exec(String(html || ''))) && out.length < limit) {
    const href = m[1]
    const wrapped = href.match(/[?&]uddg=([^&]+)/)
    let link
    try {
      link = decodeURIComponent(wrapped ? wrapped[1] : href)
    } catch {
      link = wrapped ? href : href
    }
    if (!/^https?:\/\//i.test(link)) continue
    if (seen.has(link)) continue
    seen.add(link)
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    out.push({ url: link, title })
  }
  return out
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
}

// ── Harvesting real past questions off web pages ───────────────────────────

const OPTION_LINE = /^\s*(?:\(?([A-Da-d])\)?[.)\]:]|[-*•‣▪])\s+(\S.{2,240}?)\s*$/
const ANSWER_INLINE = /(?:answer|correct\s*(?:option|answer)?|ans)\s*(?:is|:|=)?\s*\(?([A-Da-d])\)?(?![a-z])/i
const QUESTION_LEAD = /^(?:Q(?:uestion)?\.?\s*)?(\d{1,3})[.)\]]\s+(.*\S.*)$/i

/* Lift MCQ items out of one page of plain text.
 *
 * Real past-question pages put options on their own line under a numbered stem,
 * and the key either inline ("Answer: C"), quoted after the stem, or in a
 * trailing "Answer Key" block. `requireAnswer: false` is how the trailing-block
 * layout is supported: those pages legitimately have unanswerable stems until
 * extractAnswerKey() supplies the letters, so the number each stem was published
 * under is preserved as `number` for the join. Items with no resolvable answer
 * are dropped by default — a question that cannot be marked must not reach a
 * student's exam paper. */
export function extractMcqsFromHtml(html, { baseUrl = '', requireAnswer = true } = {}) {
  return extractMcqsFromText(htmlToText(html), { baseUrl, requireAnswer })
}

export function extractMcqsFromText(text, { baseUrl = '', requireAnswer = true } = {}) {
  const lines = String(text || '').split('\n').map((l) => l.trim())
  const items = []

  for (let i = 0; i < lines.length && items.length < 60; i += 1) {
    const line = lines[i]
    if (line.length < 15 || line.length > 400) continue

    const lead = line.match(QUESTION_LEAD)
    const looksLikeQuestion = Boolean(lead) || /\?\s*$/.test(line)
    if (!looksLikeQuestion) continue

    const stem = (lead ? lead[2] : line)
      .replace(/^\s*(?:Q(?:uestion)?\.?\s*)?\d{1,3}[.)\]]\s*/, '')
      .trim()
    if (stem.length < 12) continue
    const number = lead ? Number(lead[1]) : null

    // Collect the immediately-following option lines.
    const options = {}
    let j = i + 1
    let blanks = 0
    while (j < lines.length && blanks <= 2 && j < i + 14) {
      const opt = lines[j].match(OPTION_LINE)
      if (opt) {
        const letter = (opt[1] || String.fromCharCode(65 + Object.keys(options).length)).toUpperCase()
        const value = decodeEntities(opt[2].replace(/\s+/g, ' ').trim())
        if (value.length >= 2 && !(letter in options)) options[letter] = value
        blanks = 0
      } else if (!lines[j]) {
        blanks += 1
      } else {
        break
      }
      j += 1
    }

    const letters = Object.keys(options).sort()
    // Fewer than three options is an essay prompt or a formatting artefact, and
    // its stem would arrive in the paper with no way to answer it.
    if (letters.length < 3) continue

    // Answer: inline on a following line, or quoted in parentheses at the stem end.
    let answer = null
    let explanation = null
    const stemTail = stem.match(/(?:answer|ans)\s*[:=]?\s*\(?([A-Da-d])\)?\s*$/i)
    if (stemTail) answer = stemTail[1].toUpperCase()
    for (let k = j; k < Math.min(lines.length, j + 4); k += 1) {
      if (!lines[k]) continue
      // Some sites answer with the option text: "Answer: C — Oxaloacetic acid".
      const withText = lines[k].match(/(?:answer|ans)\s*[:=]?\s*\(?([A-Da-d])\)?\s*[—–\-:]?\s*(.{4,200})$/i)
      if (withText) {
        if (answer === null) answer = withText[1].toUpperCase()
        explanation = withText[2].trim()
        break
      }
      const inline = lines[k].match(ANSWER_INLINE)
      if (inline && answer === null) {
        answer = inline[1].toUpperCase()
        break
      }
      if (lines[k].length > 120) break
    }

    if (answer && !options[answer]) answer = null
    if (requireAnswer && !answer) continue

    items.push({
      number: Number.isFinite(number) ? number : null,
      prompt: stem.replace(/\s*\(?(?:answer|ans)\s*[:=]?\s*[A-Da-d]\)?\.?\s*$/i, '').trim(),
      options: letters.map((l) => options[l]),
      answer: answer ? letters.indexOf(answer) : null,
      explanation: explanation || null,
      baseUrl,
    })
    i = j - 1
  }

  return items
}

// Pull a follow-up page's answer key ("1. B  2. C  3. A") and attach it to stems
// that carry no key of their own. Returned as a Map of "1" -> "B".
export function extractAnswerKey(text) {
  const map = new Map()
  const body = String(text || '')
  // A block introduced by an "answers"/"answer key" heading.
  const section = body.match(/(?:answer\s*key|answers|key)\s*[:\-–]?\s*\n([\s\S]{0, 2500})/i)
  const scope = section ? section[1] : body
  const re = /(\d{1,3})\s*[.)\]]?\s*\(?([A-Da-d])\)?(?=\s*[.)\]]?\s*\(?[A-Da-d]\)?|\s*$)/g
  let m
  while ((m = re.exec(scope))) {
    const n = Number(m[1])
    if (!Number.isFinite(n) || n < 1 || n > 300) continue
    map.set(String(n), m[2].toUpperCase())
  }
  return map
}

// Join a trailing answer key onto unanswerable stems by their published number.
export function applyAnswerKey(items, key) {
  if (!key || key.size === 0) return items
  const out = []
  for (const item of items) {
    if (item.answer !== null || item.number === null) {
      out.push(item)
      continue
    }
    const letter = key.get(String(item.number))
    const idx = letter ? letter.toUpperCase().charCodeAt(0) - 65 : -1
    if (idx >= 0 && idx < item.options.length) {
      out.push({ ...item, answer: idx, explanation: item.explanation || `Answer key from the source page: ${letter.toUpperCase()}.` })
    } else {
      out.push(item)
    }
  }
  return out
}

// ── Wikipedia: the reliable, unlimited backbone ─────────────────────────────

const WIKI_API = 'https://en.wikipedia.org/w/api.php'

/* Wikimedia's API policy asks clients to identify themselves with a descriptive
 * User-Agent rather than a browser's, and it is not a formality: sending a
 * spoofed Chrome string is what produced the HTTP 429s that emptied live runs.
 * The contact address is the app's own, so a school administrator reading
 * Wikimedia's logs can tell who the traffic is. */
const WIKI_UA = 'CBTQuestionGenerator/1.0 (school exam paper generator; https://localhost; admin contact via app config)'

/* Wikipedia's API is reliable but it is a stranger's server, and a transient
 * failure here is invisible: the caller simply gets null and reports "no
 * questions found", which looks identical to a topic with no article.
 *
 * Two things are needed to make it dependable. It must not be called in a
 * burst — building a paper asks for one article plus six siblings, and firing
 * those as separate requests is what earned an HTTP 429 and an empty paper
 * during live testing. Hence a serialised queue with a minimum gap, and 429s
 * answered with a real backoff instead of a single immediate retry. */
const WIKI_GAP_MS = 400
const WIKI_BACKOFF_MS = [1500, 4000, 8000]
let wikiChain = Promise.resolve()
let lastWikiAt = 0

function wikiQueue(run) {
  const job = async () => {
    const wait = Math.max(0, lastWikiAt + WIKI_GAP_MS - Date.now())
    if (wait > 0) await sleep(wait)
    lastWikiAt = Date.now()
    return run()
  }
  const next = wikiChain.then(job, job)
  wikiChain = next.catch(() => {})
  return next
}

async function wikiApi(params, timeoutMs) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString()
  let last = null
  for (let attempt = 0; attempt <= WIKI_BACKOFF_MS.length; attempt += 1) {
    if (attempt) await sleep(WIKI_BACKOFF_MS[attempt - 1])
    const res = await wikiQueue(() => httpGet(`${WIKI_API}?${qs}`, { timeoutMs, userAgent: WIKI_UA }))
    if (!res.ok || !res.body) {
      last = res.error || `HTTP ${res.status}`
      // Only a rate limit is worth waiting on; a 404 or a timeout will not
      // improve by being asked again immediately.
      if (res.status !== 429 && res.status !== 503) break
      // Respect a Retry-After if the server sent one.
      if (res.retryAfter) await sleep(res.retryAfter * 1000)
      continue
    }
    try {
      return JSON.parse(res.body)
    } catch {
      last = 'unparseable JSON'
      break
    }
  }
  console.warn(`[web] wikipedia api failed (${last}): ${qs.slice(0, 120)}`)
  return null
}

/* The Wikimedia API is not rate limited to anything like DuckDuckGo's HTML
 * endpoint, which makes it the one source that can be leaned on when the paid
 * engines are down. Search returns the article titles closest to the topic;
 * extract returns the article body as plain text.
 *
 * `preferTitle` matters more than it looks. A plain relevance search for
 * "Photosynthesis" returns "Photosynthesis (disambiguation)" as hit #1, and a
 * disambiguation page has no definable subject — its lead paragraph is a list of
 * meanings. Building questions from it produced an item whose correct answer was
 * literally "Photosynthesis (disambiguation)". Ranking the exact title first, and
 * dropping parenthetical pages entirely, fixes both that and the class of topic
 * that has no article at all ("Fractions Revision Quiz"). */
const PAGE_QUALIFIER_RE = /\((disambiguation|dabambiguation|surname|given name|index|list of)\)/i

/* Titles that merely echo the topic plus a vague noun, or that are a sibling of
 * the subject rather than the subject itself. "Photosynthesis Research" (a
 * journal), "Photosynthesis system" and "Field of fractions" all score highly on
 * raw relevance while being useless as the article a teacher meant. */
const VAGUE_TITLE_WORD_RE = /\b(research|system|systems|study|studies|review|overview|history|outline|process|theory|method|approach|concept|definition|example|examples|formula|formulas|equation|equations|diagram|worksheet|quiz|test|notes|pdf|video|news|blog|summary|introduction|guide|tutorial|practice|revision|mcq|objective)\b/i

/* Compare titles on normalised forms rather than raw strings, so that a teacher
 * asking for "Fractions" is not given "Frog Fractions" — a 2012 browser game,
 * which is what relevance ranking alone produced. Normalisation singularises the
 * final word so "Fractions" matches the article "Fraction", and strips the
 * parenthetical qualifier so "Respiration (physiology)" does not beat
 * "Respiration". */
function normaliseTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(\w+?)s\b$/, '$1')
    .trim()
}

function articleScore(title, want) {
  const raw = String(title).toLowerCase()
  if (PAGE_QUALIFIER_RE.test(raw)) return -1
  if (VAGUE_TITLE_WORD_RE.test(raw)) return -1

  const t = normaliseTitle(title)
  const w = normaliseTitle(want)
  if (!w) return 5
  if (t === w) return 100
  if (t.startsWith(`${w} `)) return 60
  // "Frog Fractions" and "Field of fractions" end with the topic but are about
  // something else entirely, so they must rank below any article whose own
  // subject is the topic.
  if (t.endsWith(` ${w}`)) return 20
  if (new RegExp(`\\b${w}\\b`).test(t)) return 30
  return 5
}

export async function wikipediaSearch(query, { limit = 6, timeoutMs = DEFAULT_FETCH_MS, preferTitle } = {}) {
  const j = await wikiApi({ action: 'query', list: 'search', srsearch: query, srlimit: String(limit), srnamespace: '0' }, timeoutMs)
  const hits = j?.query?.search || []
  const want = preferTitle || query
  return hits
    .map((h) => ({ title: h.title, snippet: String(h.snippet || '').replace(/<[^>]+>/g, '') }))
    .map((h) => ({ ...h, score: articleScore(h.title, want) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
}

export async function wikipediaExtract(title, { timeoutMs = DEFAULT_FETCH_MS } = {}) {
  const [page] = await wikipediaExtractMany([title], { timeoutMs })
  return page || null
}

/* Fetch several articles in a single request.
 *
 * Wikipedia accepts up to 20 titles in one `prop=extracts` call, and this is the
 * difference between a working fallback and an intermittently empty one: fetching
 * the topic and its six siblings individually is seven round trips in a burst,
 * which is precisely what triggers the 429 that silently emptied live runs.
 * One request returns them all, in the order they were asked for.
 *
 * A title with no extract (a redirect that resolved to nothing, or a page the
 * API declines to expand) is omitted rather than returned as a null slot, so
 * callers get a compact list of real articles. */
export async function wikipediaExtractMany(titles, { timeoutMs = DEFAULT_FETCH_MS } = {}) {
  const wanted = [...new Set((titles || []).map((t) => String(t || '').trim()).filter(Boolean))]
  if (!wanted.length) return []
  // The API caps a titles= list at 20; callers here need far fewer, but chunking
  // keeps the function correct for any input.
  const out = []
  for (let i = 0; i < wanted.length; i += 20) {
    const chunk = wanted.slice(i, i + 20)
    const j = await wikiApi({ action: 'query', prop: 'extracts', explaintext: '1', redirects: '1', titles: chunk.join('|') }, timeoutMs)
    const pages = j?.query?.pages
    if (!Array.isArray(pages)) continue
    for (const page of pages) {
      const text = page?.extract
      if (!text || typeof text !== 'string' || !text.trim()) continue
      const title = page.title || ''
      out.push({ title, text, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` })
    }
  }
  // Restore the caller's ordering: relevance decides which sibling is used where.
  const rank = new Map(wanted.map((t, i) => [t, i]))
  return out.sort((a, b) => (rank.get(a.title) ?? 999) - (rank.get(b.title) ?? 999))
}

// The opening sentence is a definition on Wikipedia by construction — that is
/* ── Building questions from article text, with no model involved ──────────
 *
 * The hard constraint here is that a question with no defensible answer is worse
 * than no question at all: it reaches a student's exam paper and the marking
 * scheme is wrong. Every generator below therefore derives its correct answer
 * verbatim from the source and can prove where it came from, and each one is
 * paired with distractors that are the same *kind* of thing as the answer, since
 * distractors of a different shape are trivially eliminated and the question
 * tests nothing.
 *
 * Two of the three generators here were rewritten after live testing showed the
 * obvious approaches produce unusable items:
 *
 *  - Distractors taken from *sibling* articles in a Wikipedia search are near
 *    synonyms, not distractors. "Photosynthesis is a system of biological
 *    processes…" against "Artificial photosynthesis is a chemical process that
 *    biomimics…" is answerable by spotting which option contains the topic word,
 *    with no reading required. Sibling articles are now only used where the
 *    correct answer is a *term* and the distractors are other terms, where
 *    topical closeness is a virtue rather than a giveaway.
 *
 *  - Blank-the-first-word cloze questions are guessable by construction.
 *    "________ respiration is the process of oxidizing biological fuels" has one
 *    possible answer. Cloze stems now have to start with real context, and the
 *    blanked term has to be specific enough that it cannot be deduced from the
 *    remainder of its own sentence.
 */

function shuffle(items) {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// The opening sentence of an article is a definition by construction — that is
// what a Wikipedia lead section is, and it is the most reliable fact a free-text
// source will give up. Headings and section markers are stripped first: the
// plaintext extract format still emits "== Section ==" lines, and they leak into
// both stems and options if they are not.
function leadSentence(text) {
  const body = String(text || '')
    .replace(/==+\s*([^=]+?)\s*==+/g, '$1')
    .replace(/^\s*#{1,6}\s*[^\n]*$/gm, '')
    .replace(/\n{2,}/g, '\n')
  const para = body.split('\n').map((p) => p.trim()).filter((p) => p.length > 60 && !/^[\[\]*.#|=-]/.test(p))
  const first = para[0] || ''
  const m = first.match(/^(.{20,420}?[.!?])(?:\s|$)/)
  return (m ? m[1] : first.slice(0, 300)).replace(/\s+/g, ' ').trim()
}

/* Cut a lead sentence down to the clause that carries the definition, so an
 * option is scannable and the other three can be compared against it.
 *
 * The important step is removing the subject from its own definition. A lead
 * paragraph almost always opens by naming the article, so without this the stem
 * reads "Which term is best described as: 'Anoxygenic photosynthesis is a
 * special form of photosynthesis…'?" and the answer is printed in the question. */
function definitionClause(sentence, subject) {
  const subj = String(subject || '').trim()
  let t = String(sentence).replace(/\s+/g, ' ').trim()

  if (subj && t.toLowerCase().startsWith(`${subj.toLowerCase()} `)) {
    t = t.slice(subj.length).trim()
    t = t.replace(/^(is|was|are|were|refers to|describes)\s+/i, '').replace(/^,\s*/, '')
    t = t.replace(/\s+[a-z]$/, '')
  }
  // If the subject survives in the definition the item is unusable, so the
  // article is skipped by the caller rather than emitted with the answer
  // visible. This is the common case, not an edge case: a Wikipedia lead almost
  // always names its subject, which is why term/definition items are a bonus
  // here and the sentence-based generators carry the load.
  if (subj && new RegExp(`\\b${subj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) return ''

  const cut = t.split(/,\s+(?:which|where|who|although|though|and\s+is|and\s+are)\s+/i)[0]
  const base = (cut.length >= 45 ? cut : t).replace(/\s*[;:]\s*$/, '')
  return base.length > 200 ? `${base.slice(0, 197)}…` : base
}

const GENERIC_SUBJECT_RE = /^(list of|index of|outline of|timeline of|glossary of|comparison of|table of|outline|history of|list)/i

// Words too common to identify a topic, used when deciding whether two article
// titles are about the same thing.
const TITLE_STOP = new Set(['of', 'the', 'and', 'in', 'a', 'an', 'for', 'to', 'on', 'by', 'with', 'from', 'at', 'as', 'is', 'are'])

const titleWords = (title) => String(title).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !TITLE_STOP.has(w))

// Two articles are "about the same thing" if their titles share a distinctive
// word. Photosynthesis and "Photosynthetic efficiency" share two; Photosynthesis
// and "Respiration" share none, which is what makes the latter a usable source
// of false statements.
function titlesOverlap(a, b) {
  const setB = new Set(titleWords(b))
  return titleWords(a).some((w) => setB.has(w))
}

/* Generator 1 — term/definition matching. The strongest item this module can
 * produce without a model, because the correct answer is a term taken from the
 * same sentence that supplied its definition, so it cannot be wrong:
 *
 *   "Which term is defined as: 'a system of biological processes by which
 *    photopigment-bearing autotrophic organisms convert light energy'?"
 *      A. Anoxygenic photosynthesis   B. Photosynthesis   ...
 *
 * The distractors are other article titles in the same search, which makes them
 * the same category of thing — genuinely confusable, and not answerable by
 * spotting a keyword. Titles that are supersets or subsets of the answer
 * ("Photosynthesis system" against "Photosynthesis") are excluded: a student can
 * eliminate those on form rather than meaning. */
function termDefinitionQuestions(articles, meta, want) {
  const pool = articles
    .map((art) => ({ title: art.title, definition: definitionClause(leadSentence(art.text), art.title) }))
    .filter((x) => x.definition.length >= 45 && x.title.length >= 3 && x.title.length <= 60)
  if (pool.length < 4) return []

  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const out = []
  const usedTitle = new Set()
  for (const target of shuffle(pool)) {
    if (out.length >= want) break
    if (usedTitle.has(target.title)) continue
    const answerKey = norm(target.title)
    const others = pool.filter((p) => {
      if (p.title === target.title || usedTitle.has(p.title)) return false
      const k = norm(p.title)
      // Near-identical forms are distractors of appearance, not of meaning.
      if (k === answerKey || k.includes(answerKey) || answerKey.includes(k)) return false
      return true
    })
    if (others.length < 3) continue
    const picked = shuffle(others).slice(0, 3)
    const q = makeMcq(
      `Which term is best described as: "${target.definition}"?`,
      target.title,
      picked.map((o) => o.title),
      {
        ...meta,
        topic: target.title,
        source: 'web-encyclopedia',
        sourceUrl: target.url,
        explanation: `"${target.title}" — from the Wikipedia article of that name.`,
        difficulty: 'medium',
      },
    )
    if (!q) continue
    usedTitle.add(target.title)
    // Claim the distractors too, so two questions never share an option set.
    picked.forEach((o) => usedTitle.add(o.title))
    out.push(q)
  }
  return out
}

/* Generator 2 — true statement about a topic. The correct option is a real
 * sentence from the topic's own article; the three wrong options are real
 * sentences from articles on *other subjects in the same field*.
 *
 * Choosing the false statements is the whole difficulty here, and it took two
 * wrong attempts to get right. Sentences from articles that share a title word
 * with the topic ("Artificial photosynthesis…") are sub-topics, so the student
 * just looks for the topic word. Sentences from articles that share no word with
 * it are worse still: live testing produced a photosynthesis question whose
 * distractors were a sea slug's discovery date and a sentence about growing
 * psilocybin mushrooms, which tells a student nothing except that the app is
 * broken.
 *
 * What is wanted is the middle case — false statements drawn from sibling
 * concepts, so all four options read as statements about the topic and only the
 * true one survives reading them. Hence `neighbours` is passed the sibling
 * articles only: related by construction, and every sentence naming the topic
 * itself has already been dropped, so none of the options gives itself away. */
function trueStatementQuestions(article, siblings, meta, want) {
  const topicBits = titleWords(article.title)
  const facts = usableSentences(article.text)
    .filter((s) => s.length >= 70 && s.length <= 230)
    .slice(0, 60)
  // A false statement must not name the topic, or the option that does is the
  // only one a student can pick.
  const namesTopic = (s) => titleWords(s).some((w) => topicBits.includes(w))
  const falsePool = siblings
    .flatMap((n) => usableSentences(n.text || ''))
    .filter((f) => f && f.length >= 70 && f.length <= 230 && !namesTopic(f))
  if (facts.length < 2 || falsePool.length < 6) return []

  const stemVariants = [
    `Which of the following is a true statement about ${article.title}?`,
    `Which statement about ${article.title} is correct?`,
  ]
  const out = []
  const usedFact = new Set()
  for (let i = 0; i < Math.min(want, facts.length); i += 1) {
    const fact = facts.find((f) => !usedFact.has(f))
    if (!fact) break
    usedFact.add(fact)
    const q = makeMcq(stemVariants[i % stemVariants.length], fact, shuffle(falsePool).slice(0, 3), {
      ...meta,
      topic: article.title,
      source: 'web-encyclopedia',
      sourceUrl: article.url,
      explanation: `From the Wikipedia article "${article.title}".`,
      difficulty: 'medium',
    })
    if (q) out.push(q)
  }
  return out
}

/* Terms worth blanking are technical noun phrases: capitalised proper/technical
 * names, hyphenated compounds, or words with a discipline suffix.
 *
 * The candidate regex is deliberately broad and the *filter* does the real work.
 * The first live version let through "the process", "of oxygen" and "algae and"
 * because it only rejected a term when every word was a stop word; the rule now
 * is that no word at all may be one. It costs a few legitimate phrases like
 * "stroma of the chloroplast", and buys options a student cannot eliminate on
 * sight — which is the difference between a question and a guessing game. */
const TERM_RE = /\b([A-Z][a-z]{2,}(?:[\s-]+(?:of|the|and|for|to|in|on)?[\s-]*[A-Z][a-z]{2,}){0,3}|[a-z]{4,}(?:-[a-z]{3,}){1,2}|[a-z]{4,}(?:osis|itis|ectomy|genesis|metry|trophy|lism|icity)|[a-z]+ic\s+[a-z]{4,})\b/g

// Any single occurrence of one of these inside a candidate disqualifies it.
const TERM_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'by',
  'with', 'from', 'into', 'than', 'then', 'that', 'this', 'these', 'those', 'there',
  'their', 'his', 'her', 'its', 'our', 'they', 'them', 'he', 'she', 'it', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'as', 'which', 'who', 'what', 'when', 'where',
  'while', 'however', 'therefore', 'although', 'because', 'also', 'such', 'some',
  'many', 'most', 'more', 'less', 'each', 'other', 'others', 'one', 'two', 'three',
  'first', 'second', 'third', 'new', 'used', 'using', 'known', 'called', 'may',
  'can', 'will', 'would', 'should', 'could', 'has', 'have', 'had', 'not', 'all',
  'any', 'more', 'over', 'under', 'between', 'during', 'after', 'before', 'about',
  'including', 'example', 'examples', 'see', 'main', 'page', 'reference', 'references',
  'wikipedia', 'however', 'usually', 'generally', 'often', 's',
])

function candidateTerms(text) {
  const counts = new Map()
  const source = String(text || '').slice(0, 60000)
  let m
  TERM_RE.lastIndex = 0
  while ((m = TERM_RE.exec(source))) {
    const term = m[1].trim().replace(/\s+/g, ' ')
    const key = term.toLowerCase()
    if (term.length < 9 || term.length > 48) continue
    const words = key.split(/[\s-]+/).filter(Boolean)
    if (words.length < 1) continue
    if (words.some((w) => TERM_STOP_WORDS.has(w) || w.length < 4)) continue
    counts.set(term, (counts.get(term) || 0) + 1)
  }
  /* A proper noun is a name, not a concept: blanking "Paulinella" or offering
   * "Pseudoblepharisma" against "light-independent" produces an item no student
   * can answer and no examiner would accept. The tell is that the term occurs
   * only capitalised — "Paulinella" appears, "paulinella" never does — so an
   * organism, a person or a place is discarded unless the article also uses the
   * word as an ordinary one ("Light-independent reactions"). Only initial
   * capitals are tested, since the other patterns match lower-case vocabulary. */
  const isProperNounOnly = (term) => {
    if (!/^[A-Z]/.test(term)) return false
    return !source.includes(term.charAt(0).toLowerCase() + term.slice(1))
  }

  // Repeated terms are the article's actual vocabulary; a term seen once is
  // usually a proper noun inside a citation.
  return [...counts.entries()]
    .filter(([term, n]) => n >= 2 && !isProperNounOnly(term))
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term)
    .slice(0, 40)
}

function usableSentences(text) {
  return String(text || '')
    // Drop heading markers before splitting, or "== Aerobic respiration =="
    // becomes a sentence and then a cloze stem.
    .replace(/==+\s*([^=]+?)\s*==+/g, '')
    .replace(/^\s*#{1,6}\s*[^\n]*$/gm, '')
    // Mathematics articles are full of TeX that survived plaintext extraction:
    // "the set of all LFTs for which ad ≠ bc is closed under composition". A
    // school exam paper cannot contain that, so such sentences are dropped
    // rather than cleaned up — there are plenty more sentences to choose from.
    .replace(/\\displaystyle|\{\\?frac|\{\\?displaystyle|[{}]\{[^}]*\}\}/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => {
      if (s.length < 60 || s.length > 260) return false
      if (/\?\s*$/.test(s)) return false // that's a question, not a fact
      if (/^(See also|References|External links|Notes|Further reading|Bibliography|Sources|Citations)/i.test(s)) return false
      if (/\b(he|she|it|they)\b\s+(said|told|argued|believed|claims?|reported)\b/i.test(s)) return false
      if (/\[(\d+)\]|\{\{|\{\{/.test(s)) return false // citation noise
      if (/\bWikipedia\b/i.test(s)) return false
      // Remaining markup, symbols-heavy maths, and stray single glyphs.
      if (/[\\{}|^~]|[∑∏∫≈≠≤≥±∞√αβγδθλμπσφψω]/.test(s)) return false
      if (/\b[a-z] \d|\d[a-z]\b/.test(s) && !/\b\d{4}\b/.test(s)) return false
      if (!/[a-z]{3}/.test(s)) return false
      return true
    })
}

function makeMcq(stem, correct, distractors, meta) {
  const target = String(correct || '').trim()
  if (!target) return null
  const wrong = [...new Set(
    distractors
      .map((d) => String(d || '').trim())
      .filter((d) => d && d.toLowerCase() !== target.toLowerCase()),
  )]
  if (wrong.length < 3) return null
  const options = shuffle([target, ...wrong.slice(0, 3)])
  return {
    prompt: stem,
    options,
    answer: options.indexOf(target),
    explanation: meta.explanation || null,
    topic: meta.topic || null,
    subject: meta.subject || null,
    difficulty: meta.difficulty || 'medium',
    source: meta.source,
    sourceUrl: meta.sourceUrl || null,
  }
}

/* Generator 3 — cloze. Kept, but heavily constrained, because it is the only
 * generator that can produce a large number of items from a single article.
 * Every rule below removes a case where the answer is recoverable from the stem:
 *
 *  - the blank may not be the first word, so the stem always opens with context;
 *  - the stem may not contain the article title, or the topic word gives it away;
 *  - the term must appear at least twice in the article, so it is central rather
 *    than incidental;
 *  - the distractors are other qualifying terms from the SAME article, keeping
 *    them in one category. */
function clozeQuestions(article, meta, want) {
  const terms = candidateTerms(article.text)
  if (terms.length < 6) return []
  const titleBits = titleWords(article.title)
  const sentences = usableSentences(article.text)
  if (!sentences.length) return []

  const out = []
  const usedSentence = new Set()
  const usedTerm = new Set()

  for (const sentence of sentences) {
    if (out.length >= want) break
    if (usedSentence.has(sentence)) continue
    // Naming the topic in the stem hands the answer over for a term question.
    if (titleBits.some((w) => sentence.toLowerCase().includes(w))) continue

    let chosen = null
    for (const term of terms) {
      const key = term.toLowerCase()
      if (usedTerm.has(key)) continue
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      const m = sentence.match(re)
      if (!m) continue
      // A blank in the first three words is the giveaway case.
      if (m.index === undefined || m.index < sentence.search(/[A-Za-z]/)) continue
      const wordsBefore = sentence.slice(0, m.index).trim().split(/\s+/).filter(Boolean)
      if (wordsBefore.length < 5) continue
      chosen = { term, re }
      break
    }
    if (!chosen) continue

    const blanked = sentence.replace(chosen.re, '________').replace(/\s+/g, ' ').trim()
    if (blanked.length < 70 || blanked.length > 240) continue

    const distractors = shuffle(terms.filter((t) => t.toLowerCase() !== chosen.term.toLowerCase())).slice(0, 3)
    const q = makeMcq(blanked, chosen.term, distractors, {
      ...meta,
      topic: article.title,
      source: 'web-encyclopedia',
      sourceUrl: article.url,
      explanation: `"${chosen.term}" — from the Wikipedia article "${article.title}".`,
      difficulty: 'medium',
    })
    if (!q) continue
    usedSentence.add(sentence)
    usedTerm.add(chosen.term.toLowerCase())
    out.push({ ...q, prompt: `Complete the statement: ${blanked}` })
  }
  return out
}

/* Build `want` questions from the encyclopedia. Returns [] rather than throwing
 * when the topic has no usable article — the caller then falls through to the
 * next strategy.
 *
 * Articles are split into two groups by title overlap. `siblings` share a word
 * with the topic and are only ever used as a source of *terms*; `unrelated`
 * share no word with it and are the source of *false statements*. That split is
 * the whole reason the distractors work. */
export async function buildFromWikipedia(subject, topic, want, { timeoutMs = DEFAULT_FETCH_MS, signal } = {}) {
  const queries = [topic, `${topic} ${subject}`, subject]
    .map((q) => String(q || '').trim())
    .filter((q) => q.length > 1)
  const seenQuery = new Set()
  const searchQueries = queries.filter((q) => (seenQuery.has(q.toLowerCase()) ? false : (seenQuery.add(q.toLowerCase()), true)))
  if (!searchQueries.length || want <= 0) return []

  let hits = []
  for (const q of searchQueries) {
    if (signal?.aborted) return []
    // `preferTitle` keeps a disambiguation or "…quiz" page from becoming the
    // main article; see articleScore.
    hits = await wikipediaSearch(q, { limit: 10, timeoutMs, preferTitle: topic || q })
    if (hits.length) break
  }
  const titles = [...new Set(hits.filter((h) => !GENERIC_SUBJECT_RE.test(h.title)).map((h) => h.title))]
  if (!titles.length) return []

  const main = await wikipediaExtract(titles[0], { timeoutMs })
  if (!main || !main.text) return []

  /* Only siblings — articles whose titles share a distinctive word with the
   * topic — are used. They supply both kinds of material this module needs: other
   * real terms, and false statements from the same field. Articles sharing
   * nothing with the topic help neither generator, and including them is what
   * previously put a sea slug into a photosynthesis paper. */
  const siblingTitles = titles.slice(1, 9).filter((t) => titlesOverlap(main.title, t)).slice(0, 6)
  const siblingArts = (await wikipediaExtractMany(siblingTitles, { timeoutMs })).filter((a) => a.text)

  const meta = { subject: subject || main.title, topic: topic || main.title }
  const siblings = siblingArts
  const pool = [main, ...siblings]

  /* Some articles are stubs. "Respiration" on Wikipedia is 1.7 kB, which is not
   * enough for the cloze and statement generators to find anything, so a short
   * main article is supplemented by its longest sibling — "Cellular respiration"
   * in that case. The teacher still gets questions on the topic they asked for,
   * because the supplement is drawn from the same family and its own title
   * travels with it. */
  const MIN_MAIN_CHARS = 6000
  const sources = main.text.length < MIN_MAIN_CHARS
    ? [main, ...[...siblings].sort((a, b) => (b.text?.length || 0) - (a.text?.length || 0)).slice(0, 2)]
    : [main]
  const statementSources = sources.filter((a) => (a.text?.length || 0) >= MIN_MAIN_CHARS)
  const clozeSource = statementSources[0] || sources[0]

  const out = [
    ...termDefinitionQuestions(pool, meta, Math.max(2, Math.ceil(want * 0.4))),
    ...statementSources.flatMap((a) => trueStatementQuestions(a, siblings, meta, Math.max(1, Math.ceil(want * 0.2)))),
    ...clozeQuestions(clozeSource, meta, Math.max(1, Math.ceil(want * 0.34))),
  ]

  // Two questions built from the same sentence, or sharing an option set, read as
  // a broken paper even though each is individually correct.
  const seenStem = new Set()
  const seenOptions = new Set()
  const unique = out.filter((q) => {
    const stemKey = q.prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const optKey = [...q.options].map((o) => o.toLowerCase().replace(/[^a-z0-9]+/g, '')).sort().join('|')
    if (seenStem.has(stemKey) || seenOptions.has(optKey)) return false
    seenStem.add(stemKey)
    seenOptions.add(optKey)
    return true
  })

  // Definitions and true-statement items first: they need no guessing.
  const rank = (q) => (q.prompt.startsWith('Which term is best described') ? 0 : q.prompt.startsWith('Complete the statement') ? 2 : 1)
  return unique.sort((a, b) => rank(a) - rank(b)).slice(0, want)
}

// ── Strategy 1: real past questions off the open web ────────────────────────

const SKIP_HOSTS = /(^|\.)(google\.|youtube\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|pinterest\.|amazon\.|ebay\.|quora\.com|scribd\.com|slideplayer|issuu\.com|pdfcoffee|z-lib|slideshare)/i

// Search phrasings that actually surface item-level MCQs rather than a site index.
function searchPhrasings(subject, topic) {
  const t = String(topic || '').trim()
  const s = String(subject || '').trim()
  const out = []
  if (t && s) out.push(`${t} multiple choice questions and answers`, `${t} ${s} past questions obj`)
  if (t) out.push(`${t} objective questions with answers`)
  if (s) out.push(`${s} past questions multiple choice answers`)
  return [...new Set(out)].slice(0, 3)
}

/* Search, fetch and parse real exam pages. Bounded on every axis: at most
 * maxPages fetches, all sharing the caller's deadline, and only the question-ish
 * parts of the page are ever read. */
export async function harvestPastQuestions(subject, topic, want, { timeoutMs = 10000, budgetMs = 45000, maxPages = 4, signal } = {}) {
  const deadline = Date.now() + Math.max(1000, budgetMs)
  const found = []
  const seenStems = new Set()

  const take = (item, url) => {
    if (!item || found.length >= want) return
    if (item.answer === null || item.answer === undefined) return
    if (!Array.isArray(item.options) || item.options.length < 3) return
    const stemKey = String(item.prompt).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (stemKey.length < 12 || seenStems.has(stemKey)) return
    seenStems.add(stemKey)
    found.push({
      prompt: item.prompt,
      options: item.options.slice(0, 4),
      answer: item.answer,
      explanation: item.explanation || null,
      topic: topic || subject || null,
      subject: subject || null,
      difficulty: 'medium',
      source: 'web-past-question',
      sourceUrl: item.baseUrl || url,
    })
  }

  for (const phrasing of searchPhrasings(subject, topic)) {
    if (found.length >= want || Date.now() > deadline || signal?.aborted) break
    const results = await searchWeb(phrasing, { limit: 8, timeoutMs })
    let fetched = 0
    for (const hit of results) {
      if (found.length >= want || fetched >= maxPages || Date.now() > deadline || signal?.aborted) break
      if (SKIP_HOSTS.test(hit.url)) continue
      const left = deadline - Date.now()
      if (left < 2500) break
      fetched += 1

      const page = await httpGet(hit.url, { timeoutMs: Math.min(timeoutMs, left) })
      if (!page.ok || !page.body) continue
      // Skip PDFs and other non-HTML payloads; parsing them as text yields junk.
      if (/application\/(pdf|zip|octet-stream)/i.test(page.contentType)) continue

      const text = htmlToText(page.body)
      // Two passes. The first keeps only self-marked items, which is the common
      // case. When a page turns out to be questions-then-key instead, the second
      // pass re-reads it with answers optional and joins the trailing key on by
      // question number.
      const marked = extractMcqsFromText(text, { baseUrl: page.finalUrl })
      if (marked.length) marked.forEach((item) => take(item, hit.url))
      if (found.length >= want) break

      const unmarked = extractMcqsFromText(text, { baseUrl: page.finalUrl, requireAnswer: false })
        .filter((item) => item.answer === null && item.number !== null)
      if (unmarked.length >= 3) {
        const key = extractAnswerKey(text)
        if (key.size) applyAnswerKey(unmarked, key).forEach((item) => take(item, hit.url))
      }
    }
  }
  return found.slice(0, want)
}

/* The public entry point used by the generation pipeline.
 *
 * Order matters: authentic past questions first, because a teacher would always
 * rather have a real WAEC item than a well-formed question about photosynthesis
 * written by a template. The encyclopedia route is not a consolation prize — it
 * is unlimited, key-free and answerable by construction — so it covers whatever
 * the web search could not supply.
 *
 * The two run concurrently rather than in series. They are independent network
 * paths with no shared state, and running them one after the other meant a
 * teacher waited the sum of both: measured 73s for a request where the
 * search-throttled half contributed nothing. */
export async function webQuestionSet(spec = {}, want = 10, options = {}) {
  const subject = String(spec.subject || '').trim()
  const topic = String(spec.topic || '').trim()
  const target = Math.max(1, Math.min(60, Number(want) || 10))
  const budgetMs = options.budgetMs ?? 60000
  const stats = { pastQuestions: 0, encyclopedia: 0, pagesFetched: 0 }

  const [harvested, built] = await Promise.all([
    harvestPastQuestions(subject, topic, target, {
      timeoutMs: options.fetchTimeoutMs ?? 10000,
      budgetMs: Math.floor(budgetMs * 0.85),
      maxPages: options.maxPages ?? 4,
      signal: options.signal,
    }).catch((err) => {
      console.warn('[web] past-question harvest failed:', err?.message || err)
      return []
    }),
    buildFromWikipedia(subject, topic, target, {
      timeoutMs: options.fetchTimeoutMs ?? 12000,
      signal: options.signal,
    }).catch((err) => {
      console.warn('[web] encyclopedia build failed:', err?.message || err)
      return []
    }),
  ])

  stats.pastQuestions = harvested.length
  stats.encyclopedia = built.length
  const questions = [...harvested, ...built]

  // Drop exact repeats and anything that lost its options in transit.
  const seen = new Set()
  const seenOptions = new Set()
  const clean = questions.filter((q) => {
    if (!q || !q.prompt || q.prompt.length < 12) return false
    if (!Array.isArray(q.options) || q.options.length < 3) return false
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) return false
    if (new Set(q.options.map((o) => String(o).toLowerCase())).size < 3) return false
    const key = q.prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (seen.has(key)) return false
    const optKey = q.options.map((o) => o.toLowerCase().replace(/[^a-z0-9]+/g, '')).sort().join('|')
    if (seenOptions.has(optKey)) return false
    seen.add(key)
    seenOptions.add(optKey)
    return true
  })

  return { questions: clean.slice(0, target), stats, source: clean[0]?.source || null }
}

// ── Pictures: Wikimedia Commons, then Openverse ─────────────────────────────

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
// Commons holds textbook-quality labelled diagrams that are free to reuse, and
// unlike every hosted image model it has no quota and no cold start — which
// matters here because it is the fallback. Answers are filtered on dimensions
// because a 16x16 favicon satisfies a text search but makes a useless diagram.
const MIN_EDGE = 260
const MAX_BYTES_IMAGE = 3 * 1024 * 1024

const stripHtml = (v) => String(v || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

export async function commonsImageSearch(query, { limit = 8, timeoutMs = DEFAULT_FETCH_MS } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: String(query || ''),
    gsrnamespace: '6',
    gsrlimit: String(Math.min(20, limit)),
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '900',
  })
  const res = await httpGet(`${COMMONS_API}?${params.toString()}`, { timeoutMs })
  if (!res.ok || !res.body) return []
  let pages
  try {
    pages = JSON.parse(res.body)?.query?.pages || []
  } catch {
    return []
  }
  return pages
    .map((p) => {
      const ii = p?.imageinfo?.[0]
      if (!ii) return null
      const meta = ii.extmetadata || {}
      return {
        title: p.title,
        mime: ii.mime,
        width: ii.width || 0,
        height: ii.height || 0,
        // thumburl is Commons' rendered copy — for an SVG it is a PNG of the
        // drawing, which is what an <img> needs anyway.
        url: String(ii.thumburl || ii.url || '').split('?')[0],
        descriptionUrl: ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
        license: stripHtml(meta.LicenseShortName?.value) || null,
        artist: stripHtml(meta.Artist?.value) || null,
      }
    })
    .filter(Boolean)
    .filter((r) => /^image\/(png|jpeg|jpg|svg\+xml|webp)$/i.test(r.mime || ''))
}

function aspectPenalty(cand, targetAspect) {
  if (!targetAspect) return 0
  if (!cand.width || !cand.height) return 0
  const a = cand.width / cand.height
  const ratio = a / targetAspect
  // Mild penalty rather than a hard filter: a portrait diagram is still a fine
  // diagram, it is just not ideal, and Commons is not deep enough to be picky.
  return Math.abs(Math.log(ratio))
}

/* Find a real, reusable diagram for a question and return it as a data URL, the
 * same shape the AI image paths produce so nothing downstream has to know where
 * it came from. Licence and artist travel with the image because CC BY-SA
 * requires attribution and a teacher printing a worksheet needs it. */
export async function findWebImage(query, { timeoutMs = 15000, maxBytes = MAX_BYTES_IMAGE, targetAspect = 1.35 } = {}) {
  const q = String(query || '').trim()
  if (!q) return null

  let candidates = []
  try {
    candidates = await commonsImageSearch(q, { limit: 12, timeoutMs })
  } catch (err) {
    console.warn('[web] commons search failed:', err?.message || err)
  }

  // Openverse aggregates Flickr/Wikimedia and is tried only when Commons has
  // nothing usable, because it is markedly less reliable (it intermittently
  // answers with an HTML error page instead of JSON).
  if (!candidates.some((c) => Math.min(c.width, c.height) >= MIN_EDGE)) {
    candidates = candidates.concat(await openverseImageSearch(q, { timeoutMs }).catch(() => []))
  }

  const usable = candidates
    .filter((c) => c.url && /^https?:\/\//i.test(c.url))
    .filter((c) => titleMatchesQuery(c.title, q))
    .filter((c) => Math.min(c.width || MIN_EDGE, c.height || MIN_EDGE) >= MIN_EDGE)
    .filter((c) => Math.max(c.width || 0, c.height || 0) <= 6000)
    .map((c) => ({ ...c, score: aspectPenalty(c, targetAspect) }))
    .sort((a, b) => a.score - b.score)

  for (const cand of usable.slice(0, 5)) {
    const img = await httpGet(cand.url, { timeoutMs: Math.min(timeoutMs, 20000), binary: true })
    if (!img.ok || !img.body?.length) continue
    if (img.body.length > maxBytes) continue
    if (!/^image\//i.test(img.contentType || '')) continue
    const mime = /svg/i.test(img.contentType) ? 'image/svg+xml' : String(img.contentType).split(';')[0]
    return {
      image: `data:${mime};base64,${img.body.toString('base64')}`,
      bytes: img.body.length,
      title: String(cand.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
      credit: cand.artist || cand.license || 'Wikimedia Commons',
      license: cand.license || null,
      sourceUrl: cand.descriptionUrl || null,
      provider: 'web',
    }
  }
  return null
}

async function openverseImageSearch(query, { timeoutMs = 12000 } = {}) {
  const res = await httpGet(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=8&license_type=all-cc`, { timeoutMs })
  if (!res.ok || !res.body) return []
  // Guard against the HTML error page Openverse sometimes returns with a 200.
  if (!/^\s*[{[]/.test(res.body)) return []
  let results
  try {
    results = JSON.parse(res.body)?.results || []
  } catch {
    return []
  }
  return results
    .map((r) => ({
      title: r.title || 'Openverse image',
      mime: r.filetype ? `image/${String(r.filetype).replace('jpg', 'jpeg')}` : '',
      width: r.width || 0,
      height: r.height || 0,
      url: r.url,
      descriptionUrl: r.foreign_landing_url || r.url,
      license: r.license ? `${r.license}${r.license_version ? ` ${r.license_version}` : ''}` : null,
      artist: r.creator || null,
    }))
    .filter(Boolean)
}

/* Turn a question into image-search terms that will actually find a diagram.
 *
 * Almost nothing from the stem survives contact with a search index. Commons
 * matches file names and alt text, so it needs a diagram *name* — "photosynthesis
 * diagram" — and every extra word is a chance to retrieve nothing. Measured: the
 * query "Photosynthesis term described diagram", built from a real question stem
 * by taking its longer words, returned zero results, while "Photosynthesis
 * diagram" returned twelve.
 *
 * So the rule is narrow by design: the topic leads, at most two stem words may
 * follow, and they must be long and absent from an exhaustive list of the
 * vocabulary questions are built from. Anything less specific costs results and
 * buys nothing. */
const IMAGE_NOISE = new Set([
  // interrogatives and question-frame vocabulary
  'which', 'following', 'follows', 'statement', 'statements', 'correct', 'incorrect',
  'option', 'options', 'choose', 'chosen', 'answer', 'answers', 'best', 'described',
  'describe', 'term', 'called', 'known', 'given', 'when', 'where', 'what', 'which',
  'these', 'those', 'there', 'their', 'they', 'them', 'this', 'that', 'with', 'without',
  'from', 'into', 'about', 'above', 'below', 'does', 'done', 'each', 'every', 'both',
  // stem boilerplate used by this module's own generators
  'complete', 'organisms', 'process', 'processes', 'occur', 'occurs', 'used', 'using',
  'called', 'known', 'known as', 'refers', 'means', 'mean', 'following are', 'is',
  'are', 'was', 'were', 'has', 'have', 'had', 'been', 'being', 'can', 'could', 'will',
  'would', 'should', 'may', 'might', 'must', 'one', 'two', 'three', 'four', 'five',
  'most', 'more', 'less', 'least', 'other', 'others', 'another', 'same', 'different',
  'always', 'never', 'often', 'usually', 'generally', 'mainly', 'only', 'also', 'not',
  'than', 'then', 'during', 'between', 'within', 'through', 'over', 'under', 'after',
  'before', 'including', 'example', 'examples', 'such', 'make', 'makes', 'made',
  'take', 'takes', 'give', 'gives', 'produce', 'produces', 'created', 'shown', 'show',
  'left', 'right', 'side', 'part', 'parts', 'type', 'types', 'kind', 'kinds', 'name',
])

export function imageQueryFor({ subject, topic, prompt } = {}) {
  const anchor = String(topic || subject || '').trim()
  const anchorWords = new Set(String(anchor).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  const words = [...new Set(
    String(prompt || '')
      .replace(/[^A-Za-z0-9\s-]/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      // Long enough to be a content word, and not vocabulary the stem is made of.
      .filter((w) => w.length >= 6 && !IMAGE_NOISE.has(w) && !anchorWords.has(w)),
  )].slice(0, 2)
  const query = [anchor, ...words].filter(Boolean).join(' ').trim()
  if (!query) return 'science diagram'
  return query.toLowerCase().includes('diagram') ? query.slice(0, 120) : `${query} diagram`.slice(0, 120)
}

/* Commons relevance is loose enough to matter: "Fractions diagram" returns
 * "Fractions of the Parliament of Ukraine" and a chemistry question can return a
 * moss photograph. A candidate whose title shares no distinctive word with the
 * query is not a diagram of the thing being asked about, whatever the search
 * engine thought, so it is dropped before anything is downloaded. */
function titleMatchesQuery(title, query) {
  const t = String(title || '').toLowerCase().replace(/^file:/, '').replace(/[^a-z0-9\s-]/g, ' ')
  const q = String(query || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
  const words = q.split(/\s+/).filter((w) => w.length >= 5 && w !== 'diagram')
  if (!words.length) return true
  return words.some((w) => t.includes(w))
}

