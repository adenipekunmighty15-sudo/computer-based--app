const OPEN_TRIVIA_API = 'https://opentdb.com/api.php'
const OPEN_TRIVIA_SOURCE = 'https://opentdb.com/'
const OPEN_TRIVIA_LICENSE = 'CC BY-SA 4.0'

/* Each subject maps to the Open Trivia category plus the vocabulary that makes a
 * question plausibly about it. The keywords matter because the category is far
 * broader than its name suggests: Open Trivia's "Science: Mathematics" is full of
 * geography and sport trivia, so category membership alone is no evidence that a
 * question is a maths question. */
const SUBJECT_CATEGORIES = [
  { key: 'math', pattern: /math|algebra|geometry|arithmetic|number/, category: 19, keywords: /\b(2\s*\+\s*2|\bsum\b|\btotal\b|equation|\bsolve[ds]?\b|calculate|how many|\bnumber\b|\bcount\b|fraction|percent|ratio|average|multipl|divid|subtract|addition|\bplus\b|\bminus\b|digit|prime|integer|decimal|angle|triangle|\bcircle\b|perimeter|\barea\b|\bvolume\b|probability)/i },
  { key: 'science', pattern: /science|biology|chemistry|physics|environment/, category: 17, keywords: /\b(atom|molecule|element|\bcell\b|organ|photosynth|\benergy\b|force|magnet|electric|gravity|\bplant\b|animal|\bwater\b|\bacid\b|\bbase\b|chemical|reaction|evolution|\blight\b|\bsound\b|\bheat\b|\bdna\b|protein|\bvirus\b|\bbacteria\b)/i },
  { key: 'history', pattern: /history|civic|government/, category: 23, keywords: /\b(war|empire|\bking\b|\bqueen\b|century|ancient|battle|revolution|president|reign|dynasty|civili[sz]ation|\bemperor\b|\bmedieval\b|\bcolony\b)/i },
  { key: 'geography', pattern: /geography|social studies/, category: 22, keywords: /\b(country|capital|\bcity\b|river|mountain|ocean|population|continent|island|desert|climate|border|\bregion\b|\bmap\b|\bstate\b)/i },
  { key: 'computer', pattern: /computer|computing|information technology/, category: 18, keywords: /\b(computer|software|hardware|program|\bcode\b|internet|network|\bdata\b|algorithm|database|pixel|\bfile\b|server|device|\bCPU\b|\bRAM\b)/i },
  { key: 'sport', pattern: /sport|physical education/, category: 21, keywords: /\b(football|soccer|basketball|\bgame\b|match|\bteam\b|player|score|\bgoal\b|championship|athlet|\bmedal\b|olympic|\bcourt\b|\bball\b|\bcup\b)/i },
  { key: 'art', pattern: /art|music|literature/, category: 25, keywords: /\b(painting|sculpture|novel|\bpoem\b|poet|artist|music|\bsong\b|compos|\bauthor\b|\bplay\b|theatre|theater|\bstyle\b|\bperiod\b|novelist|playwright)/i },
  { key: 'general knowledge', pattern: /general knowledge/, category: 9, keywords: null },
]

const IGNORED_TOPIC_WORDS = new Set(['and', 'for', 'the', 'with', 'about', 'introduction', 'basics'])

function decodeText(value) {
  let text = String(value || '')
  try { text = decodeURIComponent(text) } catch {}
  return text
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
}

function shuffle(items) {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function categoryFor(subject) {
  const value = String(subject || '').toLowerCase()
  return SUBJECT_CATEGORIES.find((entry) => entry.pattern.test(value)) ?? null
}

function topicTerms(topic, subject) {
  const normalizedTopic = String(topic || '').toLowerCase().trim()
  if (!normalizedTopic || normalizedTopic === String(subject || '').toLowerCase().trim()) return []
  return normalizedTopic.match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !IGNORED_TOPIC_WORDS.has(word)) || []
}

/* Open Trivia answers from a fixed bank and refuses the whole request when asked
 * for more than the bank holds: measured `amount=25&category=19` fails with "no
 * data of the requested type was found", while `amount=10` returns ten questions
 * in ~1.4s. It also allows roughly one request every five seconds and answers
 * bursts with HTTP 429 / `response_code: 5`.
 *
 * The old code asked for `count * 5` and gave up after a single 9s attempt, so it
 * both over-asked (empty result) and was out-timed (abort) — and because the HTTP
 * error collapsed into an empty list, the fallback silently contributed nothing.
 * So the request now walks *down* from an optimistic size to the bare minimum,
 * spacing attempts far enough apart to stay inside the rate limit. */
const RATE_LIMIT_GAP_MS = 5200
let nextRequestAt = 0

/* Open Trivia is generous — every category we use answered `amount=50` — but it
 * refuses anything beyond its bank, and the only way to find out is to ask. The
 * measured ceilings were 50 for all of Science: Mathematics, Science & Nature,
 * History, Geography, Computer Science, Sports and Arts, so the first attempt goes
 * wide: a narrow-topic request such as Algebra matches almost no question by name,
 * and the subject vocabulary is what has to carry the filter, which needs a pool to
 * choose from. The ladder then walks down to the bare minimum. */
function requestAmounts(count) {
  const wanted = Math.max(1, Number(count) || 1)
  const sizes = [Math.min(50, Math.max(wanted * 4, 20))]
  while (sizes[sizes.length - 1] > wanted) {
    const next = Math.max(wanted, Math.floor(sizes[sizes.length - 1] / 2))
    if (next === sizes[sizes.length - 1]) break
    sizes.push(next)
  }
  if (sizes[sizes.length - 1] !== wanted) sizes.push(wanted)
  return sizes
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchOnce(base, amount, timeoutMs, rateLimitMs) {
  const query = new URLSearchParams(base)
  query.set('amount', String(amount))

  // Queue behind any in-flight request so parallel generation rounds cannot
  // spend the whole allowance on 429s.
  const wait = Math.max(0, nextRequestAt - Date.now())
  nextRequestAt = Date.now() + wait + rateLimitMs
  if (wait) await sleep(wait)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${OPEN_TRIVIA_API}?${query}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'CBTQuestionLab/1.0 (educational question fallback)' },
      signal: controller.signal,
    })
    if (response.status === 429) return { rateLimited: true }
    if (!response.ok) return { results: null }
    const data = await response.json()
    if (data?.response_code !== 0 || !Array.isArray(data.results)) return { results: null }
    return { results: data.results }
  } catch {
    // The service intermittently drops the TLS handshake, so one smaller retry
    // is worth more than surfacing the error.
    return { results: null }
  } finally {
    clearTimeout(timer)
  }
}

/* A trivia question about a narrow topic almost never repeats that topic's name.
 * Measured on Open Trivia's own "Science: Mathematics" bank: 0 of 10 questions
 * contained the word "algebra", yet "What is the square root of 49?" and "What
 * numbers are in the 5th row of Pascal's Triangle?" are exactly the maths a
 * teacher asking for Algebra wants. Requiring a literal topic word therefore threw
 * every usable question away and the fallback returned nothing at all.
 *
 * So topic words rank rather than gate. Questions that do mention the topic win;
 * when none do, the subject's own vocabulary decides what is close enough. The
 * category label is never searched — it is a classification, not question
 * content, and "Science: Mathematics" would match the topic word "mathematics"
 * for reasons that have nothing to do with the question. */
function scoreItem(item, terms, subjectKeywords) {
  const stem = decodeText(item.question).toLowerCase()
  const content = `${stem} ${item.incorrect_answers.map(decodeText).join(' ')} ${decodeText(item.correct_answer)}`.toLowerCase()
  const matchesTerm = (term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(content)
  const topicHits = terms.filter(matchesTerm).length
  const subjectHit = subjectKeywords ? subjectKeywords.test(content) : true
  return { item, topicHits, subjectHit, score: topicHits * 3 + (subjectHit ? 1 : 0) }
}

/* `rateLimitMs` is the floor between outgoing requests. It defaults to the
 * service's own limit; tests pass 0 so they exercise the retry ladder without
 * sitting through real cooldowns. */
export async function fetchInternetQuestions(
  spec = {},
  count = 10,
  { timeoutMs = 20000, rateLimitMs = RATE_LIMIT_GAP_MS } = {},
) {
  const subjectCategory = categoryFor(spec.subject)
  if (!subjectCategory) return []

  const wanted = Math.max(1, Math.min(50, Number(count) || 1))
  const difficulty = String(spec.difficulty || '').toLowerCase()
  const base = { category: String(subjectCategory.category), type: 'multiple', encode: 'url3986' }
  if (['easy', 'medium', 'hard'].includes(difficulty)) base.difficulty = difficulty

  let results = null
  for (const amount of requestAmounts(wanted)) {
    const attempt = await fetchOnce(base, amount, timeoutMs, rateLimitMs)
    if (attempt.rateLimited) {
      // Out of requests, not out of questions: wait it out and ask again for the
      // same size rather than shrinking a request that may well have succeeded.
      await sleep(rateLimitMs)
      const retry = await fetchOnce(base, amount, timeoutMs, rateLimitMs)
      if (retry.results?.length) { results = retry.results; break }
      continue
    }
    if (attempt.results?.length) { results = attempt.results; break }
  }
  if (!results?.length) {
    console.warn('[question fallback] Open Trivia returned no usable questions for', spec.subject, '/', spec.topic)
    return []
  }

  const terms = topicTerms(spec.topic, spec.subject)
  const scored = results.map((item) => scoreItem(item, terms, subjectCategory.keywords))
  const onTopic = scored.filter((entry) => entry.topicHits > 0)
  const pool = (onTopic.length ? onTopic : scored.filter((entry) => entry.subjectHit))
    .sort((a, b) => b.score - a.score)

  return pool
    .slice(0, wanted)
    .map(({ item }) => {
      const correct = decodeText(item.correct_answer)
      const options = shuffle([...item.incorrect_answers.map(decodeText), correct])
      return {
        prompt: decodeText(item.question),
        options,
        answer: options.indexOf(correct),
        subject: String(spec.subject || item.category),
        topic: String(spec.topic || item.category),
        difficulty: difficulty === 'mixed' ? item.difficulty : (difficulty || item.difficulty),
        explanation: `Source: Open Trivia Database (${OPEN_TRIVIA_SOURCE}), ${OPEN_TRIVIA_LICENSE}.`,
        source: 'Open Trivia Database',
        sourceUrl: OPEN_TRIVIA_SOURCE,
        sourceLicense: OPEN_TRIVIA_LICENSE,
      }
    })
}