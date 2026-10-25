export type Role = 'teacher' | 'student'
export type QuestionType = 'multiple-choice' | 'essay' | 'theory'

// The bank types a teacher teaches come from the school catalogue.
import type { SchoolLevel, TeacherSubject } from './lib/school'

export interface User {
  id: number
  role: Role
  name: string
  username: string
  student_id?: string | null
  class?: string | null
}

export interface Question {
  id?: number
  prompt: string
  options: string[]
  answer: number
  topic?: string | null
  subject?: string | null
  /** Phase of school (Primary / JSS / SSS) the question belongs to. NULL on
      hand-typed questions; only bank preparation fills it in. */
  class_level?: string | null
  difficulty?: string | null
  explanation?: string | null
  figure?: string | null
  /** Provenance of a figure reused from the web (Wikimedia Commons/Openverse):
      title, licence and a link back to the source page. */
  figureCredit?: { title?: string; credit?: string; license?: string | null; sourceUrl?: string | null } | null
  source?: string
  sourceUrl?: string
  sourceLicense?: string
  /** Format. Multiple-choice questions carry `options`; theory/essay questions
      carry `mark` + `markingGuide` and are marked by the teacher by hand. */
  qtype?: QuestionType
  mark?: number | null
  markingGuide?: string | null
}

export interface ExamSummary {
  id: number
  title: string
  subject: string | null
  class_level: string | null
  duration_minutes: number
  created_at: number
  questions: Question[]
}

// How one continuous paper is split. `compulsory` = answer all of them,
// `optional` = choose exactly `answerAny` of them.
export interface ExamSection {
  title: string
  kind: 'compulsory' | 'optional'
  count?: number
  answerAny?: number | null
  /** 'theory' when the band is a prose/essay section (marked by the teacher). */
  type?: QuestionType
}

// A section resolved against the paper's question numbers, so the client never
// has to re-derive where Section B starts.
export interface ExamSectionRange extends Required<Pick<ExamSection, 'title' | 'kind'>> {
  answerAny: number | null
  start: number
  end: number
  count: number
  type?: QuestionType
}

export interface ExamFull extends ExamSummary {
  questions: Question[]
}

export interface StudentExamQuestion {
  idx: number
  prompt: string
  options: string[]
  topic?: string | null
  figure?: string | null
  qtype?: QuestionType | null
  mark?: number | null
}

export interface StudentExam {
  id: number
  title: string
  subject: string | null
  class_level: string | null
  duration_minutes: number
  sections: ExamSectionRange[]
  maxScore: number
  questions: StudentExamQuestion[]
}

export interface MyExamRow {
  id: number
  title: string
  subject: string | null
  class_level: string | null
  duration_minutes: number
  created_at: number
  completed: number
  score?: number | null
  total?: number | null
  /** Epoch ms the paper was handed in; null while it is still sat. */
  submitted_at?: number | null
}

export interface ReviewItem {
  idx: number
  prompt: string
  options: string[]
  topic?: string | null
  figure?: string | null
  /** Option index for multiple choice, free text for theory/essay. */
  chosen?: number | string | null
  correct: number
  explanation?: string | null
  section?: string
  optional?: boolean
  manual?: boolean
  qtype?: 'theory' | 'essay' | 'multiple-choice' | null
  mark?: number | null
  markingGuide?: string | null
  // False when an optional answer fell outside the candidate's quota, so the
  // review can show it as "answered but not marked".
  counted?: boolean
}

export interface SubmitResult {
  score: number
  total: number
  marked: number
  review: ReviewItem[]
}

export interface MyResult {
  title: string
  subject: string | null
  score: number
  total: number
  marked: number
  tabLeaves: number
  submittedAt: number
  review: ReviewItem[]
}

export interface ExamStudentResult extends MyResult {
  student: { name: string; student_id?: string | null; class?: string | null }
}

export interface StudentRow {
  id: number
  name: string
  student_id?: string | null
  class?: string | null
}

export type AiGenPayload = {
  subject?: string
  classLevel?: string
  topic?: string
  count?: number
  difficulty?: string
  type?: QuestionType
  /** Exact number of questions to illustrate. Takes precedence over ratio. */
  figures?: number
  /** Share of the batch to illustrate, 0–1, when no exact count is given. */
  figureRatio?: number
  /** 'pencil' (default, hand-drawn) or 'clean'. */
  figureStyle?: FigureStyle
  /** 'auto' (default) | 'ai' | 'web' — where this request's pictures come from. */
  figureSource?: FigureSource
}

export type FigureStyle = 'pencil' | 'clean'

/** Where a request's pictures come from: 'auto' (AI draw, with the web as the
    fallback), 'ai' (drawn only), or 'web' (real licensed diagrams from the
    web, e.g. Wikimedia Commons/Openverse). Per request, not a global setting. */
export type FigureSource = 'auto' | 'ai' | 'web'

export interface FigureBatchItem {
  ok: boolean
  image?: string
  model?: string | null
  source?: string | null
  credit?: { title?: string; credit?: string; license?: string | null; sourceUrl?: string | null } | null
  error?: string
}

// A blueprint is the *shape* of the paper, not a list of sections: the teacher
// sets the size and the AI decides what to cover inside each section.
export interface PaperBlueprint {
  coverage?: string
  marks?: number
  compulsory: number
  optional?: number
  answerAny?: number
  /** Per-section format override. Section A and B can mix, e.g. Section A
      multiple-choice and Section B theory/essay (the classic SSCE spread). */
  sectionTypes?: Partial<Record<'A' | 'B', QuestionType>>
  /** A section's format can be one type, or a strict mix — "5 multiple-choice +
      1 essay" — given as {type: count}. Counts are exact: the generator fills
      each group to its own count and never borrows across formats. */
  sectionFormats?: Partial<Record<'A' | 'B', QuestionType | Partial<Record<QuestionType, number>>>>
  /** Exact number of questions to illustrate across the whole paper. */
  figures?: number
  /** Share of the paper to illustrate, 0–1. */
  figureRatio?: number
  /** 'pencil' (default, hand-drawn) or 'clean'. */
  figureStyle?: FigureStyle
  /** 'auto' (default) | 'ai' | 'web' — where this paper's pictures come from. */
  figureSource?: FigureSource
}

export interface PaperSection extends ExamSection {
  instruction?: string
  marks?: number
  requested?: number
  count?: number
  type?: QuestionType
  questions: Question[]
}

// What /ai/paper and /ai/paper/stream both answer with. Streamed papers send
// this in a final `done` event instead of a response body.
export interface PaperPayload {
  success: boolean
  paper: {
    paperTitle: string
    instructions?: string
    maxScore?: number
    sections: PaperSection[]
  } | null
  note?: string | null
  total?: number
  cap?: number
  figures?: number
  figuresWanted?: number
  figuresSkipped?: number
}

export interface PaperRequest {
  subject: string
  classLevel?: string
  type?: QuestionType
  model?: string
  withFigures?: boolean
  figures?: number
  figureRatio?: number
  figureStyle?: FigureStyle
  figureSource?: FigureSource
  blueprint?: PaperBlueprint
  // Legacy shape (list of topics) — still accepted, normalised server-side.
  sections?: { topic: string; count: number; marks?: number }[]
  signal?: AbortSignal
}

// One live line in the "thinking" drawer (exam sheet and question assistant).
// `phase` mirrors the server's unit of work so the drawer can group and colour
// events. `plan` spells out the exact counts being honoured; `web` reports real
// published questions filling a shortfall, with their sources.
export type PaperStep =
  | { phase: 'begin'; message: string; at: number }
  | { phase: 'plan'; message: string; lines?: string[]; at: number }
  | { phase: 'section'; section: string; kind?: 'compulsory' | 'optional'; type?: QuestionType; count?: number; message: string; at: number }
  | { phase: 'progress'; section?: string; done?: number; count?: number; message: string; at: number }
  | { phase: 'figures'; wanted?: number; message: string; at: number }
  | { phase: 'figure'; done?: number; wanted?: number; message: string; at: number }
  | { phase: 'web'; section?: string; message: string; at: number }
  | { phase: 'warn'; section?: string; message: string; at: number }
  | { phase: 'done'; message: string; at: number }

export interface AiEngineResult {
  label: string
  model: string
  provider: string
  latencyMs: number
  ok: boolean
  count: number
}

// One configured engine plus its live circuit-breaker state. `cooling` engines
// are parked by the server after repeated failures and skipped on the next run.
export interface AiModelInfo {
  model: string
  label: string
  key: string
  provider: string
  available: boolean
  latencyMs?: number | null
  liveMs?: number | null
  cooling?: boolean
  retryInMs?: number
  fails?: number
  lastError?: string | null
  selected: boolean
}

// A near-duplicate the server refused (or flagged) on a save. `ofId` is the
// question already in the bank; `index` is the position in the submitted batch.
export interface DuplicateHit {
  index?: number
  ofId: number
  prompt: string
  similarity: number
  method: 'semantic' | 'text'
}

export type SubjectStatus = 'pending' | 'generating' | 'partial' | 'ready'

export interface SubjectRow {
  subject: string
  level: SchoolLevel
  count: number
  target: number
  status: SubjectStatus
}

export interface MySubjects {
  subjects: SubjectRow[]
  queue: number
  target: number
}

export interface MySubjectsSave {
  saved: number
  queued: number
  target: number
}

export interface AiJob {
  id: string
  status: 'running' | 'done' | 'error'
  requested: number
  done: number
  rounds: number
  engines: AiEngineResult[]
  error: string | null
  note: string | null
  elapsedMs: number
  questions?: Question[]
}

// Carries the parsed error body so callers can act on more than the message —
// a 409 from the save endpoints holds the question it matched, which is what
// the duplicate prompt needs to show.
export class ApiError extends Error {
  status: number
  data: Record<string, unknown> | null
  constructor(message: string, status: number, data: Record<string, unknown> | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

/* Whether an error means "the server is not there" rather than "the server said
   no". Status 0 is the dead network; 502/503/504/505 is a proxy reporting a
   dead upstream. The dev proxy answers 502 before any of our code runs, so a
   check on status 0 alone misses the entire development case and leaves the
   login screen looking normal while nothing can be submitted. */
export function isBackendDown(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504 || err.status === 505)
}

/* One message for "the server is not there", because there is only ever one
   reason a browser cannot reach /api and it is never the user's password.

   In development Vite proxies /api to :5050 and answers 502/504 itself when the
   API process is not running; in production the request fails at the network
   layer, which surfaces as a bare "Failed to fetch". Both used to reach the
   login form as an opaque "Request failed (502)", which reads like a wrong
   password and sends people retyping a password that was always correct. */
const BACKEND_DOWN =
  'Server is unreachable. If this is a live site, it may be waking up (free tier) or temporarily down. Please refresh in a few seconds.'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(BACKEND_DOWN, 0, null)
  }

  let data: unknown
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok) {
    const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
    const apiError = payload && typeof payload.error === 'string' ? payload.error : null

    // 502/503/504 with no JSON body of our own is the proxy reporting a dead
    // upstream, not the API rejecting this request.
    if ((res.status === 502 || res.status === 503 || res.status === 504 || res.status === 505) && !apiError) {
      throw new ApiError(BACKEND_DOWN, res.status, payload)
    }

    throw new ApiError(apiError || `Request failed (${res.status})`, res.status, payload)
  }

  return data as T
}

// Streaming endpoints (/api/ai/paper/stream, /api/ai/generate/stream), parsed
// as Server-Sent Events feeds. The server writes `event: step` lines as work
// happens, finishes with `event: done` carrying the JSON payload, and can send
// `event: error` if the run cannot finish. `signal` cancels the fetch; the
// server notices the dropped connection and stops after the current call.
async function streamUrl<TResult>(
  url: string,
  payload: unknown,
  { onStep, signal }: { onStep: (step: PaperStep) => void; signal?: AbortSignal },
): Promise<TResult> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch {
    if (signal?.aborted) throw new ApiError('Generation cancelled', 0, null)
    throw new ApiError(BACKEND_DOWN, 0, null)
  }

  if (!res.ok) {
    let data: unknown = null
    try { data = await res.json() } catch { /* body is not JSON */ }
    const msg = data && typeof data === 'object' ? (data as { error?: string }).error : null
    throw new ApiError(msg || `Generation failed (${res.status})`, res.status, data && typeof data === 'object' ? (data as Record<string, unknown>) : null)
  }
  if (!res.body) throw new ApiError('No response stream', 0, null)

  return new Promise<TResult>((resolve, reject) => {
    let settled = false
    let buffer = ''
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    const consume = (block: string) => {
      let event = 'message'
      const dataLines: string[] = []
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(':')) continue
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
      if (!dataLines.length) return
      let data: unknown
      try { data = JSON.parse(dataLines.join('\n')) as unknown } catch { return }
      if (event === 'done') settle(() => resolve(data as TResult))
      else if (event === 'error') {
        const msg = data && typeof data === 'object' ? (data as { error?: string }).error : null
        settle(() => reject(new ApiError(msg || 'Generation failed', 0, null)))
      } else if (event === 'step') {
        onStep(data as PaperStep)
      }
    }
    // NOTE: the settle-and-return is intentional; continue draining the socket
    // so the server sees the connection close cleanly either way.

    const pump = () => {
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      const read = (): Promise<void> =>
        reader.read().then(({ done, value }) => {
          if (done) {
            // Flush a trailing event block (a server that closes without the
            // final blank line), then decide what the stream ended with.
            if (buffer.trim()) {
              buffer.split(/\r?\n\r?\n/).forEach(consume)
              buffer = ''
            }
            if (!settled) reject(new ApiError('Connection closed before generation finished', 0, null))
            return
          }
          buffer += decoder.decode(value, { stream: true })
          let splitAt: number
          while ((splitAt = nextSplit(buffer)) !== -1) {
            const block = buffer.slice(0, splitAt)
            buffer = buffer.slice(splitAt + splitDelimiterLength(buffer, splitAt))
            consume(block)
          }
          return read()
        })
      read().catch((err) => {
        if (signal?.aborted) settle(() => reject(new ApiError('Generation cancelled', 0, null)))
        else settle(() => reject(err instanceof ApiError ? err : new ApiError(err?.message || 'Stream interrupted', 0, null)))
      })
    }

    pump()
  })
}

function nextSplit(text: string): number {
  const lf = text.indexOf('\n\n')
  const crlf = text.indexOf('\r\n\r\n')
  if (lf === -1) return crlf
  if (crlf === -1) return lf
  return Math.min(lf, crlf)
}
function splitDelimiterLength(text: string, index: number): number {
  return text.startsWith('\r\n\r\n', index) ? 4 : 2
}

function streamPaper(payload: PaperRequest, handlers: { onStep: (step: PaperStep) => void; signal?: AbortSignal }): Promise<PaperPayload> {
  return streamUrl<PaperPayload>('/api/ai/paper/stream', payload, handlers)
}

export const api = {
  // auth
  login: (username: string, password: string, role: 'teacher' | 'student') =>
    req<{ user: User }>('POST', '/api/auth/login', { username, password, role }),
  register: (payload: Record<string, unknown>) =>
    req<{ user: User }>('POST', '/api/auth/register', payload),
  logout: () => req<{ ok: boolean }>('POST', '/api/auth/logout'),
  me: () => req<{ user: User }>('GET', '/api/auth/me'),
  // Profile edits go to /auth/me, not /users/:id — there is no row id in the
  // path, so a settings screen cannot address somebody else's account.
  updateProfile: (patch: { name?: string; studentId?: string; cls?: string }) =>
    req<{ user: User }>('PATCH', '/api/auth/me', patch),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean }>('POST', '/api/auth/password', { currentPassword, newPassword }),

  // teacher: bank
  listQuestions: () => req<{ questions: Question[] }>('GET', '/api/questions'),
  searchQuestions: (query: string) => req<{ questions: Question[]; method: 'semantic' | 'text' }>('GET', `/api/questions/search?q=${encodeURIComponent(query)}`),
  listSimilarQuestions: (id: number) => req<{ questions: Question[] }>('GET', `/api/questions/${id}/similar`),
  // `force` overrides the near-duplicate refusal. Without it the server answers
  // 409 with the question it matched, so the UI can offer the choice.
  createQuestion: (q: Question & { force?: boolean }) =>
    req<{ question: Question }>('POST', '/api/questions', q),
  // All-or-nothing: one transaction for the whole array. A 200-question
  // "Save all" is one request, so it can no longer half-land.
  createQuestionsBulk: (questions: (Question & { force?: boolean })[], force?: boolean) =>
    req<{ saved: number; questions: Question[]; duplicates: DuplicateHit[] }>('POST', '/api/questions/bulk', { questions, force }),
  checkDuplicates: (questions: Question[]) =>
    req<{ duplicates: DuplicateHit[]; threshold?: number; method?: string }>('POST', '/api/questions/duplicates', { questions }),
  updateQuestion: (id: number, q: Question) => req<{ question: Question }>('PUT', `/api/questions/${id}`, q),
  deleteQuestion: (id: number) => req<{ ok: boolean }>('DELETE', `/api/questions/${id}`),

  // teacher: people + exams + results
  listStudents: () => req<{ students: StudentRow[] }>('GET', '/api/students'),
  listExams: () => req<{ exams: ExamSummary[] }>('GET', '/api/exams'),
  createExam: (exam: { title: string; subject?: string | null; class_level?: string | null; duration_minutes?: number; questions: Question[]; sections?: ExamSection[] }) =>
    req<{ exam: ExamFull }>('POST', '/api/exams', exam),
  deleteExam: (id: number) => req<{ ok: boolean }>('DELETE', `/api/exams/${id}`),
  assignExam: (id: number, studentIds: number[], assignAll?: boolean) =>
    req<{ ok: boolean; assigned: number }>('POST', `/api/exams/${id}/assign`, { studentIds, assignAll }),
  examResults: (id: number) =>
    req<{ exam: ExamFull; results: ResultRow[]; assignedCount: number; perQuestion: PerQuestionStat[] }>('GET', `/api/exams/${id}/results`),
  examStudentResult: (examId: number, studentId: number) =>
    req<ExamStudentResult>('GET', `/api/exams/${examId}/results/${studentId}`),

  // teacher: insights
  getClassInsights: () => req<{ summary: string; weakTopics: string[]; strengths: string[]; nextSteps: string[] }>('GET', '/api/insights/class'),

  // teacher: what I teach + how ready each bank is
  mySubjects: () => req<MySubjects>('GET', '/api/my/subjects'),
  saveMySubjects: (subjects: TeacherSubject[]) =>
    req<MySubjectsSave>('PUT', '/api/my/subjects', { subjects }),

  // student
  myExams: () => req<{ exams: MyExamRow[] }>('GET', '/api/my/exams'),
  getMyExam: (id: number) => req<{ exam: StudentExam }>('GET', `/api/my/exams/${id}`),
  submitExam: (id: number, answers: Record<number, number | string>, marked: number, tabLeaves: number) =>
    req<SubmitResult>('POST', `/api/my/exams/${id}/submit`, { answers, marked, tabLeaves }),
  myResult: (examId: number) => req<MyResult>('GET', `/api/my/results/${examId}`),

  // AI lab (multi-provider)
  aiModels: () => req<{
    ready: string[]
    missingKeys: string[]
    models: AiModelInfo[]
    imageModels: { model: string; label: string; provider: string; key: string }[]
    health?: { total: number; healthy: number; cooling: number }
    speed: { generatedAt: string | null; winners: { model: string; provider: string; ms: number }[] } | null
  }>('GET', '/api/ai/models'),
  aiBenchmark: () => req<{ ok: boolean; generatedAt: string; winners: { model: string; provider: string; ms: number }[] }>('POST', '/api/ai/benchmark'),
  // Today's question spend. `limit` is 0 when the school has not set
  // AI_DAILY_QUESTION_LIMIT, i.e. there is no cap to plan around.
  aiUsage: () => req<{
    used: number
    limit: number
    remaining: number | null
    logs: { id: number; action: string; model: string | null; provider: string | null; count: number; latency_ms: number; ok: number; created_at: number }[]
  }>('GET', '/api/ai/usage'),
  aiGenerate: (p: AiGenPayload & { model?: string }) =>
    req<{ success: boolean; count: number; requested: number; questions: Question[]; engines?: AiEngineResult[]; totalMs?: number; note?: string | null; jobId?: string; status?: string; figures?: number; figuresWanted?: number; figuresSkipped?: number }>('POST', '/api/ai/generate', p),
  // Batches over 200 come back as a job id instead of questions; poll these.
  aiStartJob: (p: AiGenPayload & { model?: string }) =>
    req<{ jobId: string; requested: number; status: string }>('POST', '/api/ai/jobs', p),
  aiJob: (id: string) => req<AiJob>('GET', `/api/ai/jobs/${id}`),
  aiVariants: (p: { question: string; count?: number; model?: string }) =>
    req<{ success: boolean; count: number; requested: number; note?: string | null; model?: string | null; questions: Question[] }>('POST', '/api/ai/variants', p),
  aiConvert: (p: { text: string; subject?: string; model?: string; figures?: number; figureStyle?: FigureStyle }) =>
    req<{ success: boolean; count: number; questions: Question[]; figures?: number; figuresWanted?: number; figuresSkipped?: number }>('POST', '/api/ai/convert', p),
  aiRewrite: (p: { question: string; difficulty?: string; model?: string }) =>
    req<{ success: boolean; count: number; questions: Question[] }>('POST', '/api/ai/rewrite', p),
  aiBlueprint: (p: { prompt: string; model?: string }) =>
    req<{ success: boolean; blueprint: any }>('POST', '/api/ai/blueprint', p),
  aiChat: (p: { messages: { role: string; content: string }[]; context?: any; language?: string; model?: string }) =>
    req<{ success: boolean; text: string }>('POST', '/api/ai/chat', p),
  aiExplain: (p: { question: string; answer: string; topic?: string; language?: string; model?: string }) =>
    req<{ success: boolean; explanation: string }>('POST', '/api/ai/explain', p),
  myRecommendations: () =>
    req<{ summary: string; recommendations: string[] }>('GET', '/api/my/recommendations'),
  aiPaper: (p: PaperRequest) => req<PaperPayload>('POST', '/api/ai/paper', p),
  // Streaming twin of aiPaper for the Exam Sheet's Thinking Drawer. Each step
  // is delivered as soon as the server has it; the promise resolves with the
  // same payload as aiPaper. Abort to cancel. The paper and the Question
  // Assistant's generate stream both use this pipeline.
  aiPaperStream: (p: PaperRequest, handlers: { onStep: (step: PaperStep) => void; signal?: AbortSignal }) =>
    streamPaper(p, handlers),
  // Streaming twin of aiGenerate, the Question Assistant's live "thinking"
  // trail: same contract as aiPaperStream, ending with aiGenerate's payload.
  aiGenerateStream: (p: AiGenPayload & { model?: string }, handlers: { onStep: (step: PaperStep) => void; signal?: AbortSignal }) =>
    streamUrl<{ success: boolean; count: number; requested: number; questions: Question[]; engines?: AiEngineResult[]; totalMs?: number; note?: string | null; figures?: number; figuresWanted?: number; figuresSkipped?: number }>(
      '/api/ai/generate/stream',
      p,
      handlers,
    ),
  aiEmbed: (p: { text: string }) =>
    req<{ success: boolean; dims?: number; model?: string; matches?: { id: number; prompt: string; subject: string | null; similarity: number }[]; threshold?: number; error?: string }>('POST', '/api/ai/embed', p),
  aiImage: (p: { prompt: string; model?: string; size?: string; count?: number; style?: FigureStyle; source?: FigureSource }) =>
    req<{ success: boolean; count: number; requested: number; model?: string | null; mime?: string | null; latencyMs?: number; aspect?: string; svgFallback?: boolean; source?: string | null; imageSources?: ({ url: string; title: string; sourceUrl: string; license: string; artist: string } | null)[]; prompt: string; images: string[] }>('POST', '/api/ai/image', p),
  aiFigure: (p: { prompt: string; subject?: string; extra?: string; style?: FigureStyle }) =>
    req<{ success: boolean; svg?: string; image?: string; model?: string | null }>('POST', '/api/ai/figure', p),
  // One request for a whole sheet's worth of diagrams. `results` is positional:
  // results[i] belongs to questions[i]. `source` honours the sheet's Picture
  // source toggle: 'web' asks for real licensed diagrams from Wikimedia etc.
  aiFigures: (p: { questions: { prompt: string; subject?: string | null }[]; subject?: string; style?: FigureStyle; source?: FigureSource; budgetMs?: number }) =>
    req<{ success: boolean; count: number; requested: number; results: (FigureBatchItem | null)[]; elapsedMs: number }>('POST', '/api/ai/figures', p),
}

export interface ResultRow {
  student_id: number
  student_name: string
  student_code?: string | null
  student_class?: string | null
  score: number
  total: number
  marked: number
  tab_leaves: number
  submitted_at: number
}

export interface PerQuestionStat {
  index: number
  prompt: string
  total: number
  correct: number
  pct: number
}