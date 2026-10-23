import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  CHAT_MODELS,
  EMBED_MODEL,
  IMAGE_MODELS,
  getUsableModels,
  rankModels,
  splitGenerate,
  callProvider,
  loadSpeedRank,
  saveSpeedRank,
  callNvidiaChat,
  callWithFailover,
  genImageWithFailover,
  generateFigure,
  usableImageModels,
  parseQuestions,
  cleanJson,
  AI_DISCLAIMER,
  MCQ_SYSTEM,
  toBankQuestions,
  validateQuestion,
  engineHealth,
  resolveTimeoutMs,
  buildPaperSections,
  normaliseLegacySections,
  sectionIsTheory,
  normaliseSectionType,
  theoryQType,
  toTheoryQuestions,
  paperInstructions,
  paperMaxScore,
  tooSimilar,
  sectionFormatGroups,
  sectionFormatLabel,
  MAX_PAPER_QUESTIONS,
  svgToDataUrl,
} from './config/ai.js'
import { figureBudget, figureSourceMode, pickFigureTargets, normaliseFigureSvg } from './figures.js'
import { authRequired, login, logout, changePassword, rateLimit, hashPassword, SESSION_COOKIE, getCookie } from './auth.js'
import {
  getUserByUsername,
  getUserByToken,
  createSession,
  sanitizeUser,
  updateUserProfile,
  listStudents,
  listQuestions,
  getQuestion,
  getQuestionRow,
  canEditQuestion,
  questionBelongsTo,
  insertQuestion,
  insertQuestionsBulk,
  updateQuestion,
  deleteQuestion,
  findDuplicateQuestion,
  questionFingerprints,
  listExams,
  getExam,
  getExamStudentSafe,
  insertExam,
  deleteExam,
  assignExam,
  assignedStudentIds,
  canEditExam,
  isAssigned,
  getResult,
  saveResult,
  listExamResults,
  getExamStudentResult,
  listAssignedExamsWithResults,
  startAttempt,
  getAttempt,
  saveDraft,
  getDraft,
  deleteDraft,
  logAiUsage,
  aiUsageSince,
  recentAiLogs,
  replaceTeacherSubjects,
  getTeacherSubjects,
  bankCounts,
} from './db.js'
import { computeDeadline, isSubmissionLate, gradeExam, isManualQuestion, examSectionRanges, examMaxScore } from './scoring.js'
import { dedupeEnabled, embedQuestions, findDuplicate, DUP_SIMILARITY, DUP_TEXT_SIMILARITY } from './dedupe.js'
import { createJob, getJob, updateJob, finishJob, failJob, isRunning, jobView } from './jobs.js'
import { generateLocalQuestionSet, generateLocalSvgFigure } from './local-fallback.js'
import { searchCommonsImages } from './web-image-fallback.js'
import { fetchInternetQuestions } from './web-question-fallback.js'
import { webQuestionSet, findWebImage, imageQueryFor } from './web-source.js'
import { setBankGenerateTask, enqueueBankPrep, isBankQueued, bankTarget, bankQueueSize } from './bank-prep.js'
import { SUBJECT_CATALOGUE, SCHOOL_LEVELS } from './school-catalogue.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Load keys from this project's own .env only ──
// This app used to also read a shared pool from another project's .env. That
// file is not ours to trust: it can set CORS_ORIGINS (opening the API to a
// foreign origin) and shadow our own keys. A deployment must be self-contained,
// so only server/.env is read here.
const localEnv = path.join(__dirname, '.env')

const env = { ...process.env }
if (fs.existsSync(localEnv)) {
  Object.assign(env, dotenv.parse(fs.readFileSync(localEnv, 'utf8')))
  console.log(`Loaded keys from ${localEnv}`)
}

const app = express()

const ALLOWED_ORIGINS = (env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5050,http://localhost:3000,http://127.0.0.1:5173,http://127.0.0.1:3000')
  .split(',').map((s) => s.trim()).filter(Boolean)

const corsOptions = {
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true)
    cb(null, false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Length'],
  maxAge: 600,
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use(express.json({ limit: '5mb' }))

const PORT = process.env.PORT || 5050
// Route wrapper: forward async rejections to the global error handler below.
// It must NOT answer directly, so there is exactly one place that decides what
// a failure looks like on the wire.
const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res)).catch(next)
}

const mustBeTeacher = authRequired(['teacher'])
const mustBeStudent = authRequired(['student'])
const anyAuth = authRequired()

// HttpOnly SameSite cookie used for all session state. `secure` is enabled when
// COOKIE_SECURE=1 (HTTPS behind a proxy) and disabled for local dev.
function sessionCookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: env.COOKIE_SECURE === '1',
  }
}

const authRouter = express.Router()
const teacherRouter = express.Router()
const studentRouter = express.Router()

// ── Auth ──
authRouter.post('/auth/login',
  rateLimit({ max: 300, message: 'Too many login attempts from this network. Try again shortly.' }),
  rateLimit({
    max: 10,
    message: 'Too many attempts for this username from this network. Try again shortly.',
    key: (req) => `${req.ip}:${String(req.body?.username || '').trim().toLowerCase()}`,
  }),
  wrap(async (req, res) => {
  const result = await login(req.body || {})
  if (!result.ok) return res.status(401).json({ error: result.error })
  res.cookie(SESSION_COOKIE, result.token, sessionCookieOpts())
  res.json({ user: sanitizeUser(result.user) })
  }),
)

// Keyed per username rather than per IP. A school shares one public address,
// so an IP-keyed cap of 10 meant only ten students on the whole campus could
// ever create an account before hitting a 429. Per-username keeps a single
// name from being spammed while letting every pupil and teacher register.
authRouter.post('/auth/register',
  rateLimit({
    max: 5,
    message: 'Too many attempts for this username. Try again in a minute.',
    key: (req) => `register:${String(req.body?.username || '').trim().toLowerCase()}`,
  }),
  rateLimit({ max: 120, message: 'Too many accounts created from this network. Try again shortly.' }),
  wrap(async (req, res) => {
  const { role, name, username, password, studentId, cls, teacherCode } = req.body || {}
  if (!['teacher', 'student'].includes(role)) return res.status(400).json({ error: 'Role must be teacher or student' })
  if (!name || !name.trim()) return res.status(400).json({ error: 'Full name is required' })
  if (!username || !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: 'Username must be 3-32 chars (letters, numbers, . _ -)' })
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })

  // Fail closed: teacher self-registration is only open when a signup code is
  // configured AND matches. With no code set the route used to let anyone in,
  // so a single missing env var silently exposed teacher accounts.
  const teacherSignupCode = env.TEACHER_SIGNUP_CODE
  if (role === 'teacher') {
    if (!teacherSignupCode) return res.status(403).json({ error: 'Teacher sign-up is disabled. Ask an administrator for access.' })
    if (teacherCode !== teacherSignupCode) return res.status(403).json({ error: 'Invalid teacher signup code' })
  }
  if (getUserByUsername(username)) return res.status(409).json({ error: 'Username already exists' })

  const hash = await hashPassword(password)
  const { insertRawUser } = await import('./db.js')
  const id = insertRawUser(role, name.trim(), username.trim(), hash, role === 'student' ? (studentId || null) : null, role === 'student' ? (cls || null) : null)
  const token = createSession(id)
  res.cookie(SESSION_COOKIE, token, sessionCookieOpts())
  res.status(201).json({ user: { id, role, name: name.trim(), username: username.trim(), student_id: role === 'student' ? studentId : null, class: role === 'student' ? cls : null } })
}))

authRouter.post('/auth/logout', anyAuth, (req, res) => {
  logout(getCookie(req, SESSION_COOKIE))
  const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (headerToken) logout(headerToken)
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax' })
  res.json({ ok: true })
})

authRouter.get('/auth/me', anyAuth, (req, res) => res.json({ user: req.user }))

// The signed-in person's own record. PATCH rather than POST /users/:id because
// there is no id in the path on purpose: a settings screen must not be able to
// name a different row, even by accident.
authRouter.patch('/auth/me', anyAuth, wrap((req, res) => {
  const { name, studentId, cls } = req.body || {}
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name cannot be empty' })
  if (String(name ?? '').length > 120) return res.status(400).json({ error: 'Name is too long' })
  if (String(cls ?? '').length > 80) return res.status(400).json({ error: 'Class name is too long' })
  if (String(studentId ?? '').length > 40) return res.status(400).json({ error: 'Student ID is too long' })

  const user = updateUserProfile(req.user.id, { name, studentId, cls })
  if (!user) return res.status(404).json({ error: 'Account not found' })
  res.json({ user })
}))

// Rate limited per user as well as per address: a lab machine shares one IP
// with the whole school, so an IP-only cap would lock out every teacher.
authRouter.post('/auth/password',
  anyAuth,
  rateLimit({
    max: 8,
    message: 'Too many password attempts. Wait a minute, then try again.',
    key: (req) => `pw:${req.user?.id ?? req.ip}`,
  }),
  wrap(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {}
    const result = await changePassword({
      userId: req.user.id,
      currentPassword,
      newPassword,
      keepToken: getCookie(req, SESSION_COOKIE),
    })
    if (!result.ok) return res.status(400).json({ error: result.error })
    res.json({ ok: true })
  }),
)

// ── Teacher: question bank ──
teacherRouter.get('/questions', mustBeTeacher, wrap(async (req, res) => {
  res.json({ questions: listQuestions(req.user.id) })
}))

teacherRouter.get('/questions/search', mustBeTeacher, wrap(async (req, res) => {
  const query = String(req.query.q || '').trim()
  if (!query) return res.json({ questions: [] })
  
  const { searchQuestionsByVector, searchQuestionsByText } = await import('./db.js')
  const { embedQuestions, embedderConfigured } = await import('./dedupe.js')
  
  if (embedderConfigured(env)) {
    const [vector] = await embedQuestions(env, [{ prompt: query }])
    if (vector) {
      const questions = searchQuestionsByVector(vector, req.user.id)
      return res.json({ questions, method: 'semantic' })
    }
  }
  
  const questions = searchQuestionsByText(query, req.user.id)
  res.json({ questions, method: 'text' })
}))

teacherRouter.get('/questions/:id/similar', mustBeTeacher, wrap(async (req, res) => {
  const { id } = req.params
  const row = getQuestionRow(Number(id))
  if (!row) return res.status(404).json({ error: 'Question not found' })
  
  const { searchQuestionsByVector } = await import('./db.js')
  const embedding = row.embedding ? JSON.parse(row.embedding) : null
  
  if (!embedding) return res.json({ questions: [], note: 'No embedding for this question' })
  
  // Exclude the question itself
  const questions = searchQuestionsByVector(embedding, req.user.id)
    .filter(q => q.id !== Number(id))
    
  res.json({ questions })
}))

// Shared by the single and bulk save paths: reject a question that is not a
// well-formed MCQ. The old code checked this only on the single route, so a
// bulk save could write rows the bank UI then failed to render.
function invalidQuestion(q) {
  if (!q || !q.prompt || !String(q.prompt).trim()) return 'Every question needs a prompt'
  if (!Array.isArray(q.options) || q.options.length < 2) return 'Every question needs at least 2 options'
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) return 'Every question needs a valid answer index'
  return null
}

teacherRouter.post('/questions', mustBeTeacher, rateLimit({ max: 300, message: 'Too many saves, slow down.' }), wrap(async (req, res) => {
  const q = req.body || {}
  const bad = invalidQuestion(q)
  if (bad) return res.status(400).json({ error: bad })

  // Near-duplicate guard. `force` is the teacher's explicit override, so the
  // warning is advisory by default rather than a silent drop.
  if (dedupeEnabled(env) && !q.force) {
    const [vector] = await embedQuestions(env, [q])
    const dupe = findDuplicate({ ...q, embedding: vector }, questionFingerprints(req.user.id))
    if (dupe) {
      return res.status(409).json({
        error: 'This looks like a question already in the bank',
        duplicate: dupe,
        similarity: dupe.similarity,
      })
    }
    q.embedding = vector
  }
  res.status(201).json({ question: insertQuestion(q, req.user.id) })
}))

// One transaction for the whole batch. A 200-question "Save all" used to be a
// loop of single POSTs: if request 90 of 200 failed the bank held 89 saved
// questions, the UI reported failure, and pressing Save again wrote 89
// duplicates. Here the batch is all-or-nothing, and anything already refused as
// a duplicate is reported back so the teacher can drop or override it.
teacherRouter.post('/questions/bulk', mustBeTeacher, rateLimit({ max: 30, message: 'Too many bulk saves, slow down.' }), wrap(async (req, res) => {
  const list = req.body?.questions
  if (!Array.isArray(list) || list.length === 0) return res.status(400).json({ error: 'No questions supplied' })
  if (list.length > 2000) return res.status(400).json({ error: 'Save at most 2000 questions at a time' })

  for (let i = 0; i < list.length; i += 1) {
    const bad = invalidQuestion(list[i])
    if (bad) return res.status(400).json({ error: `Question ${i + 1}: ${bad}` })
  }

  const checkDupes = dedupeEnabled(env) && !req.body?.force
  const vectors = checkDupes ? await embedQuestions(env, list) : list.map(() => null)
  const bank = questionFingerprints(req.user.id)

  const fresh = []
  const duplicates = []
  for (let i = 0; i < list.length; i += 1) {
    const candidate = { ...list[i], embedding: vectors[i] }
    if (checkDupes) {
      // Compared against the batch too, not just the bank: 200 questions from
      // one model call are near-identical by construction.
      const dupe = findDuplicate(candidate, [...bank, ...fresh])
      if (dupe) {
        duplicates.push({ index: i, prompt: list[i].prompt, similarity: dupe.similarity, method: dupe.method, ofId: dupe.id })
        continue
      }
    }
    fresh.push(candidate)
  }

  if (req.body?.force) {
    const saved = insertQuestionsBulk(list.map((q, i) => ({ ...q, embedding: vectors[i] })), req.user.id)
    return res.status(201).json({ saved: saved.length, questions: saved, duplicates: [] })
  }
  if (duplicates.length && fresh.length === 0) {
    return res.status(409).json({ error: `All ${duplicates.length} of these questions are already in the bank`, saved: 0, duplicates })
  }
  if (!fresh.length) return res.status(400).json({ error: 'Nothing to save' })

  const saved = insertQuestionsBulk(fresh, req.user.id)
  logAiSummary(req, 'bulk-save', { count: saved.length, requested: list.length, ok: true, extra: `dupes=${duplicates.length}` })
  res.status(201).json({ saved: saved.length, questions: saved, duplicates })
}))

// Pre-flight check so the editor can warn before the teacher commits to a save.
teacherRouter.post('/questions/duplicates', mustBeTeacher, rateLimit({ max: 120 }), wrap(async (req, res) => {
  const list = Array.isArray(req.body?.questions) ? req.body.questions.slice(0, 50) : []
  if (!list.length || !dedupeEnabled(env)) return res.json({ duplicates: [], method: dedupeEnabled(env) ? 'text' : 'off' })
  const vectors = await embedQuestions(env, list)
  const bank = questionFingerprints(req.user.id)
  const seen = []
  const duplicates = []
  for (let i = 0; i < list.length; i += 1) {
    const dupe = findDuplicate({ ...list[i], embedding: vectors[i] }, [...bank, ...seen])
    if (dupe) duplicates.push({ index: i, prompt: list[i].prompt, similarity: dupe.similarity, method: dupe.method, ofId: dupe.id })
    else seen.push({ id: `new-${i}`, prompt: list[i].prompt, subject: list[i].subject ?? null, topic: list[i].topic ?? null, embedding: vectors[i] })
  }
  res.json({ duplicates, threshold: vectors[0] ? DUP_SIMILARITY : DUP_TEXT_SIMILARITY, method: vectors[0] ? 'semantic' : 'text' })
}))

teacherRouter.put('/questions/:id', mustBeTeacher, rateLimit({ max: 300 }), wrap(async (req, res) => {
  const row = getQuestionRow(Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'Question not found' })
  if (!canEditQuestion(row, req.user.id)) return res.status(403).json({ error: 'You can only edit your own questions' })
  const q = req.body || {}
  const bad = invalidQuestion(q)
  if (bad) return res.status(400).json({ error: bad })
  // Passing the editor adopts a shared/system question, matching canEditQuestion.
  res.json({ question: updateQuestion(row.id, q, req.user.id) })
}))

teacherRouter.delete('/questions/:id', mustBeTeacher, wrap(async (req, res) => {
  const row = getQuestionRow(Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'Question not found' })
  // Shared/system questions (no owner) are never deletable by a teacher.
  if (!questionBelongsTo(row, req.user.id)) return res.status(403).json({ error: 'You can only delete your own questions' })
  deleteQuestion(row.id)
  res.json({ ok: true })
}))

// ── Teacher: students + exams ──
teacherRouter.get('/students', mustBeTeacher, wrap(async (req, res) => {
  res.json({ students: listStudents() })
}))

teacherRouter.get('/exams', mustBeTeacher, wrap(async (req, res) => {
  res.json({ exams: listExams() })
}))

teacherRouter.post('/exams', mustBeTeacher, rateLimit({ max: 30 }), wrap(async (req, res) => {
  const exam = req.body || {}
  if (!exam.title || !exam.title.trim()) return res.status(400).json({ error: 'Exam title is required' })
  if (!Array.isArray(exam.questions) || exam.questions.length === 0) return res.status(400).json({ error: 'An exam needs at least one question' })
  res.status(201).json({ exam: insertExam(exam, req.user.id) })
}))

teacherRouter.delete('/exams/:id', mustBeTeacher, wrap(async (req, res) => {
  const exam = getExam(Number(req.params.id))
  if (!exam) return res.status(404).json({ error: 'Exam not found' })
  if (!canEditExam(exam, req.user.id)) return res.status(403).json({ error: 'You can only delete exams you created' })
  deleteExam(exam.id)
  res.json({ ok: true })
}))

teacherRouter.post('/exams/:id/assign', mustBeTeacher, wrap(async (req, res) => {
  const examId = Number(req.params.id)
  const exam = getExam(examId)
  if (!exam) return res.status(404).json({ error: 'Exam not found' })
  if (!canEditExam(exam, req.user.id)) return res.status(403).json({ error: 'You can only assign exams you created' })
  const { studentIds, assignAll } = req.body || {}
  let ids = Array.isArray(studentIds) ? studentIds.map(Number).filter((n) => Number.isInteger(n)) : []
  if (assignAll) ids = listStudents().map((s) => s.id)
  if (!ids.length) return res.status(400).json({ error: 'Select at least one student (or assign to all)' })
  assignExam(examId, ids)
  res.json({ ok: true, assigned: assignedStudentIds(examId).length })
}))

teacherRouter.get('/exams/:id/results', mustBeTeacher, wrap(async (req, res) => {
  const examId = Number(req.params.id)
  const exam = getExam(examId)
  if (!exam) return res.status(404).json({ error: 'Exam not found' })
  const results = listExamResults(examId)
  const assignedCount = assignedStudentIds(examId).length
  const perQuestion = exam.questions.map((q, idx) => {
    let total = 0
    let correct = 0
    for (const r of results) {
      const answers = JSON.parse(r.answers || '{}')
      if (answers[idx] !== undefined) {
        total += 1
        if (answers[idx] === q.answer) correct += 1
      }
    }
    return { index: idx, prompt: q.prompt, total, correct, pct: total ? Math.round((correct / total) * 100) : 0 }
  })
  res.json({ exam, results, assignedCount, perQuestion })
}))

teacherRouter.get('/exams/:id/results/:studentId', mustBeTeacher, wrap(async (req, res) => {
  const examId = Number(req.params.id)
  const studentId = Number(req.params.studentId)
  const exam = getExam(examId)
  if (!exam) return res.status(404).json({ error: 'Exam not found' })
  const result = getExamStudentResult(examId, studentId)
  if (!result) return res.status(404).json({ error: 'Student result not found' })
  const answers = result.answers ? JSON.parse(result.answers) : {}
  const { counted } = gradeExam(exam, answers)
  res.json({
    title: exam.title,
    subject: exam.subject,
    score: result.score,
    total: result.total,
    marked: result.marked,
    submittedAt: result.submitted_at,
    student: { name: result.student_name, student_id: result.student_code, class: result.student_class },
    review: buildExamReview(exam, answers, counted),
  })
}))

// ── Teacher: Insights ──
teacherRouter.get('/insights/class', mustBeTeacher, wrap(async (req, res) => {
  const { getTeacherInsightsData } = await import('./db.js')
  const stats = getTeacherInsightsData(req.user.id)
  
  if (!stats.length) {
    return res.json({ 
      summary: 'No exam results yet. Insights will appear once students start submitting their papers.',
      weakTopics: [],
      strengths: [],
      nextSteps: []
    })
  }

  // Aggregate by topic across all exams
  const topicStats = {}
  for (const exam of stats) {
    for (const q of exam.perQuestion) {
      if (!topicStats[q.topic]) topicStats[q.topic] = { total: 0, correct: 0, subject: q.subject }
      topicStats[q.topic].total += q.total
      topicStats[q.topic].correct += q.correct
    }
  }

  const topics = Object.entries(topicStats).map(([name, s]) => ({
    name,
    subject: s.subject,
    pct: s.total ? (s.correct / s.total) : 0,
    volume: s.total
  }))

  // Call AI to generate a narrative summary and recommendations
  const messages = [
    { role: 'system', content: 'You are an expert educational data analyst. Analyze the following class performance data and provide actionable insights for the teacher. Be concise, encouraging, and specific.' },
    { role: 'user', content: `Here is the performance data for my classes aggregated by topic:\n${JSON.stringify(topics)}\n\nPlease provide:\n1. A 2-3 sentence summary of overall performance.\n2. Top 3 weak topics that need immediate attention.\n3. Top 2 strengths where the class is excelling.\n4. 3 specific next steps (e.g., "Review topic X", "Give a practice quiz on Y").\n\nReturn ONLY a JSON object with keys: "summary", "weakTopics" (array of strings), "strengths" (array of strings), "nextSteps" (array of strings).` }
  ]

  const result = await callWithFailover(env, messages, { temperature: 0.4 })
  let insights = { summary: 'Error generating insights', weakTopics: [], strengths: [], nextSteps: [] }
  try {
    insights = JSON.parse(cleanJson(result.text))
  } catch (err) {
    console.error('Failed to parse AI insights:', err)
  }

  res.json(insights)
}))

// ── Teacher: AI Question Lab (teacher-only). No artificial rate limiter:
// teachers may generate as much as they want; the provider failover in
// config/ai.js keeps individual engines from being flooded. A per-teacher daily
// budget exists only when AI_DAILY_QUESTION_LIMIT is set (off by default).

const dailyAILimit = parseInt(env.AI_DAILY_QUESTION_LIMIT || '0', 10) || 0

function aiBudgetFor(userId) {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const used = aiUsageSince(userId, dayStart.getTime()).questions
  return { used, limit: dailyAILimit, remaining: dailyAILimit ? Math.max(0, dailyAILimit - used) : null }
}

// Reject when a daily question budget is configured and this request would exceed it.
function assertAiBudget(res, userId, extra) {
  const b = budgetOk(userId, extra)
  if (b.ok) return true
  res.status(429).json({ error: `Daily AI question budget reached (${b.limit}). Sent to ${b.used}; resets tomorrow.` })
  return false
}

// Non-blocking variant for background work: a queued subject that cannot run
// today is skipped in place, not dropped — the queue forgets it, so a later
// read re-queues it with no data loss.
function budgetOk(userId, extra) {
  if (!dailyAILimit) return { ok: true, used: 0, limit: null, remaining: null }
  const b = aiBudgetFor(userId)
  return { ok: b.used + extra <= b.limit, used: b.used, limit: b.limit, remaining: Math.max(0, b.limit - b.used) }
}

function logAiSummary(req, action, info = {}) {
  const { model = null, provider = null, count = 0, requested = null, latencyMs = null, ok = false, raw = null, extra = null } = info
  const parts = [
    `[ai] ${action}`,
    `user=${req.user?.id || req.user?.username || '?'}`,
    `model=${model || 'n/a'}`,
    `provider=${provider || 'n/a'}`,
    `count=${count}${requested != null ? '/' + requested : ''}`,
    `ms=${latencyMs ?? 'n/a'}`,
    ok ? 'OK' : 'FAIL',
  ]
  if (extra) parts.push(String(extra))
  console.log(parts.join(' '))
  if (raw) {
    const flat = String(raw).replace(/\s+/g, ' ').trim()
    console.log(`  [ai] ${action} raw: ${flat.length > 500 ? flat.slice(0, 500) + '…' : flat}`)
  }
}

function recordAi(req, action, info = {}) {
  try {
    logAiUsage({
      userId: req.user.id,
      action,
      model: info.model ?? null,
      provider: info.provider ?? null,
      count: info.count ?? 0,
      latencyMs: info.latencyMs ?? 0,
      ok: info.ok ?? false,
    })
  } catch (err) {
    console.warn('[ai] audit log failed:', err?.message || err)
  }
  logAiSummary(req, action, info)
}

// Run an async worker over items with a bounded number in flight at once.
// Keeps figure generation from firing 20+ simultaneous model calls.
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

// Draw diagrams onto a flat list of questions and attach them in place.
//
// Shared by /ai/generate and /ai/paper so both paths give the same result for the
// same request: the same scoring picks which questions are illustrated, the same
// concurrency limit applies, and the same wall-clock budget keeps the HTTP
// request from hanging on a slow diagram engine.
//
// Three knobs, all optional:
//   figures     an exact count ("10 pictures out of 30")
//   figureRatio a share of the paper (0.34)
//   style       'pencil' (default) or 'clean'
//
// Returns { added, skipped, tried } — the caller reports these to the teacher.
async function attachFigures(req, questions, { subject, env: envIn, onStep, shouldStop, ...spec } = {}) {
  const total = questions.length
  const want = figureBudget(spec, total)
  if (!want || !total) return { added: 0, skipped: 0, tried: 0, want: 0 }

  // Not `const env = envIn || env`: that shadowed the module-level `env` and read
  // it inside its own initializer, so the whole route died with
  // "Cannot access 'env' before initialization" the moment a figure was wanted.
  const keys = envIn || env
  const targets = pickFigureTargets(questions, want)
  if (!targets.length) return { added: 0, skipped: 0, tried: 0, want }
  /* `source` is per-request, not a global setting: one paper can be drawn by
     AI, the next can use only real licensed diagrams from the web. */
  const source = figureSourceMode(spec.source)
  onStep?.({ phase: 'figures', wanted: targets.length, message: source === 'web'
    ? `Looking up real diagrams — ${targets.length} to find${subject ? ` for ${subject}` : ''}`
    : `Drawing diagrams — ${targets.length} to draw${subject ? ` for ${subject}` : ''}` })

  /* Diagrams take 25–45s from the engines that can actually draw them, so a 45s
     per-figure ceiling was failing the majority of them and reporting them as
     "skipped". Four at a time, each with room to finish. */
  const perFigureMs = resolveTimeoutMs(spec.figureTimeoutMs ?? keys.AI_FIGURE_TIMEOUT_MS, 90000)
  const concurrency = Math.max(1, Math.min(4, spec.concurrency || 4))
  /* The wall-clock budget is derived from how many figures were actually asked
     for, not a flat two minutes. A fixed budget silently capped the real
     ceiling: at four at a time, 120s only ever covered about ten diagrams, so a
     request for 200 returned 190 as "skipped" and looked like the cap was the
     server's fault. Now a big request simply takes proportionally longer —
     the teacher waits for their pictures instead of being quietly shorted. */
  const derivedMs = Math.ceil(targets.length / concurrency) * perFigureMs
  const configuredBudget = spec.figureBudgetMs ?? keys.AI_FIGURE_BUDGET_MS
  const budgetMs = configuredBudget ? resolveTimeoutMs(configuredBudget, 120000) : derivedMs
  const started = Date.now()

  let added = 0
  let skipped = 0
  await mapLimit(targets, concurrency, async (qi) => {
    if (Date.now() - started > budgetMs) {
      skipped += 1
      return
    }
    if (shouldStop && shouldStop()) {
      skipped += 1
      onStep?.({ phase: 'figure', done: added, wanted: targets.length, message: `${added} of ${targets.length} diagrams drawn — stopped early` })
      return
    }
    const q = questions[qi]
    const context = { subject: subject || q.subject, prompt: q.prompt }
    /* Three tiers, in order of how well they fit the question: a drawn diagram
       from the image engines, then a real diagram published under a free licence
       and found on Wikimedia Commons/Openverse, then a locally drawn SVG. The web
       tier matters because every image engine here is either over quota or gone —
       measured: stability-diffusion-3.5-large 404s on all three wire formats, the
       Cosmos endpoints 404, Gemini's image models are rate-limited — and without a
       second source a failed draw could only ever produce a generic placeholder. */
    const useWebImage = async () => {
      const query = imageQueryFor({ subject: context.subject, topic: q.topic, prompt: context.prompt })
      const web = await findWebImage(query)
      if (!web?.image) return false
      q.figure = web.image
      if (!q.figureCredit) q.figureCredit = { title: web.title, credit: web.credit, license: web.license, sourceUrl: web.sourceUrl }
      return true
    }
    const recordWeb = () => recordAi(req, 'figure-web', { model: 'wikimedia-commons', provider: 'web', count: 1, requested: 1, ok: true })
    // `web` mode skips the model draw entirely — a licensed real diagram, then
    // the local fallback. `ai` mode skips the web tier so nothing external is
    // fetched. `auto` (default) draws first and falls back to the web only
    // when the draw comes back empty or throws.
    if (source === 'web') {
      const found = await useWebImage().catch(() => false)
      if (found) {
        added += 1
        recordWeb()
      } else {
        q.figure = generateLocalSvgFigure({ subject: context.subject, prompt: context.prompt, style: spec.style || 'pencil' })
        added += 1
        recordAi(req, 'figure-fallback', { model: 'local-svg', provider: 'local', count: 1, requested: 1, ok: true })
      }
      onStep?.({ phase: 'figure', done: added, wanted: targets.length, message: `Finding diagram ${Math.min(added + skipped, targets.length)} of ${targets.length}…` })
      return
    }
    try {
      const fig = await generateFigure(keys, context, {
        timeoutMs: perFigureMs,
        totalBudgetMs: perFigureMs * 2,
        style: spec.style,
      })
      if (fig) {
        q.figure = fig.image
        added += 1
        recordAi(req, 'figure', { model: fig.model, provider: fig.provider, count: 1, requested: 1, ok: true })
      } else if (source !== 'ai' && await useWebImage()) {
        added += 1
        recordWeb()
      } else {
        const fallback = generateLocalSvgFigure({ subject: context.subject, prompt: context.prompt, style: spec.style || 'pencil' })
        q.figure = fallback
        added += 1
        recordAi(req, 'figure-fallback', { model: 'local-svg', provider: 'local', count: 1, requested: 1, ok: true })
      }
    } catch (err) {
      if (source !== 'ai' && await useWebImage().catch(() => false)) {
        added += 1
        recordWeb()
      } else {
        const fallback = generateLocalSvgFigure({ subject: context.subject, prompt: context.prompt, style: spec.style || 'pencil' })
        q.figure = fallback
        added += 1
        console.warn('[ai] figure failed; used local SVG fallback:', err?.message || err)
        recordAi(req, 'figure-fallback', { model: 'local-svg', provider: 'local', count: 1, requested: 1, ok: true })
      }
    }
    onStep?.({ phase: 'figure', done: added, wanted: targets.length, message: `Drawing diagram ${Math.min(added + skipped, targets.length)} of ${targets.length}…` })
  })

  return { added, skipped, tried: targets.length, want }
}

teacherRouter.get('/ai/models', mustBeTeacher, wrap(async (req, res) => {
  const ranked = rankModels(env)
  const speed = loadSpeedRank()
  const models = ranked.map((m) => {
    const health = engineHealth(m)
    return {
      model: m.model,
      label: m.label,
      key: m.key,
      provider: m.provider || 'nvidia',
      available: !health.cooling,
      latencyMs: m.latencyMs,
      liveMs: m.liveMs ?? null,
      cooling: health.cooling,
      retryInMs: health.retryInMs,
      fails: health.fails,
      lastError: health.lastError,
      selected: (speed.winners || []).some((w) => w.provider === (m.provider || 'nvidia') && w.model === m.model),
    }
  })
  const missing = [...new Set(CHAT_MODELS.map((m) => m.key).filter((k) => !env[k] || env[k].length < 20))]
  const imageModels = usableImageModels(env).map((m) => ({ model: m.model, label: m.label, provider: m.provider, key: m.key }))
  const cooling = models.filter((m) => m.cooling).length
  res.json({
    models,
    ready: ranked.filter((m) => !engineHealth(m).cooling).map((m) => m.model),
    missingKeys: missing,
    embeddings: EMBED_MODEL,
    imageModels,
    health: { total: models.length, healthy: models.length - cooling, cooling },
    speed: { generatedAt: speed.generatedAt, winners: speed.winners },
  })
}))

// Per-teacher AI usage + audit trail. Supports cost control and shows what went where.
teacherRouter.get('/ai/usage', mustBeTeacher, wrap(async (req, res) => {
  const budget = aiBudgetFor(req.user.id)
  res.json({ ...budget, logs: recentAiLogs(req.user.id, 40) })
}))

// Re-run the click-through speed test for every configured key, save the ranking.
teacherRouter.post('/ai/benchmark', mustBeTeacher, wrap(async (req, res) => {
  const { runBenchmark } = await import('./benchmark.mjs')
  const payload = await runBenchmark(env)
  recordAi(req, 'benchmark', {
    count: payload.winners?.length || 0,
    ok: payload.winners?.length > 0,
    extra: `winners=${payload.winners?.length} generatedAt=${new Date(payload.generatedAt).toISOString()}`,
  })
  res.json({ ok: payload.winners.length > 0, winners: payload.winners, generatedAt: payload.generatedAt })
}))

// ── Question generation ──
//
// One implementation serves both transports. A small batch answers inline; a
// large one runs as a background job so the HTTP connection is not held open
// for the minutes that thousands of tokens take.

const SYNC_GENERATE_MAX = 200
const JOB_ROUND_SIZE = 60
const MAX_GENERATE_QUESTIONS = 9000
const JOB_MAX_ROUNDS = Math.ceil(MAX_GENERATE_QUESTIONS / JOB_ROUND_SIZE)
// Rounds for an inline request. Small, because each one is a fan-out to six
// engines and the caller is waiting: 25 questions a round means a 20-question
// paper is one round, and a 200-question one is eight.
const SYNC_ROUND_SIZE = 25
const SYNC_MAX_ROUNDS = 12
function normalizeQuestionType(type) {
  const value = String(type || 'multiple-choice').trim().toLowerCase()
  if (value === 'mcq' || value === 'multiple choice' || value === 'multiple-choice') return 'multiple-choice'
  if (value === 'essay' || value === 'theory' || value === 'structured') return 'theory'
  return 'multiple-choice'
}

function generateMessagesFor({ subject, classLevel, topic, difficulty, type }, chunk) {
  const cls = classLevel ? ` for ${classLevel}` : ''
  const diff = difficulty || 'mixed'
  const mode = normalizeQuestionType(type)
  const typeNote = mode === 'theory' ? 'Theory/essay questions with a marking guide.' : 'Multiple-choice questions with 4 options (A-D).'
  return [
    { role: 'system', content: MCQ_SYSTEM },
    { role: 'user', content: `Subject: ${subject || 'General Knowledge'}\nClass${cls}\nMain topic: ${topic || 'General'}\nDifficulty: ${diff}\nQuestion type: ${typeNote}\n\nGenerate exactly ${chunk} DIFFERENT questions on "${topic || subject || 'the given topic'}".\nNumber them and ensure they are not repetitive. ${mode === 'theory' ? 'For theory/essay questions use shape: {"question":"...","mark":"5","markingGuide":"..."}.' : ''}` },
  ]
}

function topicIsNarrowerThanSubject(spec) {
  const topic = String(spec?.topic || '').trim().toLowerCase()
  const subject = String(spec?.subject || '').trim().toLowerCase()
  return Boolean(topic) && topic !== subject
}

async function collectWebQuestions(spec, want) {
  if (normalizeQuestionType(spec?.type) === 'theory') return { questions: [], labels: [] }

  const trivia = async (count) => {
    const found = await fetchInternetQuestions(spec, count).catch((err) => {
      console.warn('[fallback] Open Trivia failed:', err?.message || err)
      return []
    })
    return { questions: found, label: 'Open Trivia Database' }
  }
  const encyclopedia = async (count) => {
    const { questions, stats } = await webQuestionSet(spec, count, { budgetMs: 25000, maxPages: 2 }).catch((err) => {
      console.warn('[fallback] encyclopedia build failed:', err?.message || err)
      return { questions: [], stats: {} }
    })
    if (stats?.pagesFetched) console.log(`[fallback] encyclopedia: ${questions.length} questions from ${stats.pagesFetched} pages`)
    return { questions, label: 'Wikipedia' }
  }

  const order = topicIsNarrowerThanSubject(spec) ? [encyclopedia, trivia] : [trivia, encyclopedia]
  const questions = []
  const labels = []
  for (const source of order) {
    if (questions.length >= want) break
    const { questions: found, label } = await source(want - questions.length)
    if (found.length) {
      questions.push(...found)
      labels.push(label)
    }
  }
  return { questions: questions.slice(0, want), labels }
}

// AI and relevant web questions are gathered together; local templates only
// fill any shortfall after both sources have contributed.
async function runGenerateRound(spec, want) {
  const t0 = Date.now()
  const mode = normalizeQuestionType(spec?.type)
  const webWant = mode === 'theory' ? 0 : Math.min(10, Math.max(1, Math.ceil(want / 4)))

  const aiTask = (async () => {
    try {
      return want >= 20
        ? await splitGenerate(env, (chunk) => generateMessagesFor(spec, chunk), want, {
            prefer: spec.model || null,
            temperature: 0.5,
            maxTokens: Math.min(12000, 260 * want + 800),
            timeoutMs: 90000,
          })
        : await callWithFailover(env, generateMessagesFor(spec, want), {
            prefer: spec.model || null,
            temperature: 0.5,
            maxTokens: Math.min(8000, 260 * want + 800),
            timeoutMs: 75000,
            seed: Math.floor(Math.random() * 1e6),
          })
    } catch (err) {
      console.warn('[ai] question generation failed; using concurrent web/local sources:', err?.message || err)
      return null
    }
  })()
  const webTask = webWant
    ? collectWebQuestions(spec, webWant).catch((err) => {
        console.warn('[fallback] web question generation failed:', err?.message || err)
        return { questions: [], labels: [] }
      })
    : Promise.resolve({ questions: [], labels: [] })
  const [initialResult, web] = await Promise.all([aiTask, webTask])
  const aiResults = initialResult ? [initialResult] : []
  const aiQuestions = []
  const seenAi = new Set()
  const addAiQuestions = (result) => {
    const rawJson = result?.json
    const parsed = mode === 'theory'
      ? (Array.isArray(rawJson) ? rawJson : [])
      : (Array.isArray(rawJson) ? toBankQuestions(JSON.stringify(rawJson)) : toBankQuestions(result?.text || ''))
    for (const question of parsed) {
      const key = String(question?.prompt || question?.question || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      if (key && seenAi.has(key)) continue
      if (key) seenAi.add(key)
      aiQuestions.push(question)
      if (aiQuestions.length >= want) break
    }
  }
  addAiQuestions(initialResult)

  // Models sometimes truncate a requested batch. Ask AI for only the missing
  // questions before web/local sources complete the round.
  for (let attempt = 0; initialResult && aiQuestions.length < want && attempt < 2; attempt += 1) {
    const missing = want - aiQuestions.length
    let retryResult = null
    try {
      retryResult = missing >= 20
        ? await splitGenerate(env, (chunk) => generateMessagesFor(spec, chunk), missing, {
            prefer: spec.model || null,
            temperature: 0.5,
            maxTokens: Math.min(12000, 260 * missing + 800),
            timeoutMs: 90000,
          })
        : await callWithFailover(env, generateMessagesFor(spec, missing), {
            prefer: spec.model || null,
            temperature: 0.5,
            maxTokens: Math.min(8000, 260 * missing + 800),
            timeoutMs: 75000,
            seed: Math.floor(Math.random() * 1e6),
          })
    } catch (err) {
      console.warn(`[ai] continuation for ${missing} remaining questions failed:`, err?.message || err)
    }
    if (!retryResult) break
    aiResults.push(retryResult)
    const before = aiQuestions.length
    addAiQuestions(retryResult)
    if (aiQuestions.length === before) break
  }
  const engines = aiResults.flatMap((result) => Array.isArray(result?.engines)
    ? result.engines.map((e) => ({ label: e.label, model: e.model, provider: e.provider, latencyMs: e.latencyMs, ok: e.ok, count: e.ok && Array.isArray(e.json) ? e.json.length : 0 }))
    : [])

  const questions = []
  const seen = new Set()
  const appendUnique = (items) => {
    for (const question of items) {
      const key = String(question?.prompt || question?.question || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      questions.push(question)
      if (questions.length >= want) break
    }
  }
  const webCount = Math.min(web.questions.length, webWant)
  appendUnique(aiQuestions.slice(0, Math.max(0, want - webCount)))
  appendUnique(web.questions)
  appendUnique(aiQuestions)

  let localQuestions = []
  if (questions.length < want) {
    localQuestions = generateLocalQuestionSet(spec, want - questions.length)
    questions.push(...localQuestions.slice(0, want - questions.length))
  }
  const sources = [...new Set([
    ...aiResults.map((result) => result?.model?.model),
    ...web.labels,
    ...(localQuestions.length ? ['local-template'] : []),
  ].filter(Boolean))]

  return {
    questions: questions.slice(0, want),
    model: sources.join(' + ') || null,
    engines,
    totalMs: Date.now() - t0,
    raw: aiResults.map((result) => result?.text || '').filter(Boolean).join('\n') || null,
    fallback: web.questions.length > 0 || localQuestions.length > 0,
    // How much of a round honestly came from published web questions (they all
    // carry a sourceUrl), so the thinking drawer can say so out loud.
    webCount: questions.slice(0, want).filter((q) => q.sourceUrl).length,
    webLabels: web.labels,
  }
}

/* Shared question-generator engine, used by /ai/generate (one synchronous
   response) and /ai/generate/stream (a live SSE feed for the AI Lab's thinking
   drawer). `onStep` streams what the engines are actually doing — the plan, each
   round's yield, and which questions came from published web sources. */
async function generateQuestionsPayload(req, spec, n, { onStep, shouldStop } = {}) {
  /* Keep going until the teacher has the number of questions they asked for.
     One round is not one round of output: the engines are credit-limited, time
     out at 40s and return a truncated batch, so a single pass turned "give me
     20 questions" into a paper of 9 with a note asking the teacher to press the
     button again. Rounds are small (so one slow chunk cannot sink the request)
     and stop as soon as a round adds nothing, which is the signal that the
     engines are exhausted rather than merely slow. */
  const roundStart = Date.now()
  const collected = []
  const engines = []
  let out = null
  let stalls = 0

  const typeLabel = normalizeQuestionType(spec?.type) === 'theory'
    ? (spec?.type === 'essay' ? 'essay' : 'theory')
    : 'multiple-choice'
  if (onStep) {
    onStep({
      phase: 'plan',
      message: `Plan: exactly ${n} ${typeLabel} question${n === 1 ? '' : 's'}${spec.subject ? ` on ${spec.subject}` : ''}${spec.topic ? ` — ${spec.topic}` : ''}`,
      lines: [
        `Fill order: AI engines first, then published web questions (Open Trivia / Wikipedia), then local templates — the requested count is the target.`,
        spec.topic ? `Searching the web for real questions under "${spec.topic}".` : 'No topic given — the engines pick from the syllabus.',
      ].filter(Boolean),
    })
  }

  for (let round = 0; round < SYNC_MAX_ROUNDS && collected.length < n; round += 1) {
    if (shouldStop && shouldStop()) break
    const want = Math.min(SYNC_ROUND_SIZE, n - collected.length)
    if (onStep) onStep({ phase: 'begin', message: `Round ${round + 1}: asking the engines for up to ${want} fresh ${typeLabel} question${want === 1 ? '' : 's'}` })
    out = await runGenerateRound({ ...spec, type: normalizeQuestionType(spec?.type) === 'theory' ? spec.type : 'multiple-choice' }, want)
    engines.push(...out.engines)
    const before = collected.length
    for (const q of out.questions) {
      if (collected.length >= n) break
      collected.push(q)
    }
    const gained = collected.length - before
    if (onStep && gained > 0) {
      onStep({ phase: 'progress', done: collected.length, count: n, message: `Round ${round + 1}: ${gained} question${gained === 1 ? '' : 's'} written — ${collected.length} of ${n} so far` })
      if ((out.webCount ?? 0) > 0) {
        const webNote = out.webCount
        onStep({ phase: 'web', message: `${webNote} question${webNote === 1 ? '' : 's'} in this round came from ${out.webLabels?.filter(Boolean).join(' and ') || 'the web'} — published questions, each with its source link` })
      }
    }
    if (gained === 0) {
      stalls += 1
      if (stalls >= 2) break
    } else {
      stalls = 0
    }
  }
  out = { ...out, questions: collected, engines, totalMs: Date.now() - roundStart }
  recordAi(req, 'generate', {
    model: out.model,
    provider: null,
    count: out.questions.length,
    requested: n,
    latencyMs: out.totalMs,
    ok: out.questions.length > 0,
    raw: out.raw,
    extra: `engines=${out.engines.length}`,
  })

  // Pictures are a separate, budgeted phase so a slow diagram engine cannot
  // hold up the questions themselves. `figures` is the count the teacher asked
  // for; `added` is what actually got drawn, and both come back so the UI can
  // say "10 of 10 drawn" instead of implying all 30 have pictures.
  const figs = await attachFigures(req, out.questions, { subject: spec.subject, ...spec, source: figureSourceMode(spec.figureSource), onStep, shouldStop })
  const internetQuestions = collected.filter((question) => question.sourceUrl).length
  const localQuestions = collected.filter((question) => question.source === 'local-template-fallback').length
  /* Named per source rather than assumed: the internet tier can be Open Trivia,
     Wikipedia, or both, and each carries its own licence. */
  const webNotes = [...new Set(collected
    .filter((question) => question.sourceUrl)
    .map((question) => `${question.source || 'the internet'}${question.sourceLicense ? ` (${question.sourceLicense})` : ''}`))]
  const webFigures = out.questions.filter((question) => question.figureCredit?.sourceUrl).length

  const payload = {
    success: out.questions.length > 0,
    count: out.questions.length,
    requested: n,
    model: out.model,
    engines: out.engines,
    totalMs: out.totalMs,
    questions: out.questions,
    raw: out.raw ? out.raw.slice(0, 300) : null,
    figures: figs.added,
    figuresWanted: figs.want,
    figuresSkipped: figs.skipped,
    note: [
      out.questions.length < n ? `Generation returned ${out.questions.length} valid questions of ${n} requested. Click Generate again for more.` : null,
      internetQuestions ? `Generation included ${internetQuestions} question${internetQuestions === 1 ? '' : 's'} from ${webNotes.join(' and ') || 'the internet'}, alongside AI-generated questions.` : null,
      localQuestions ? `${localQuestions} question${localQuestions === 1 ? '' : 's'} used local templates to complete the batch.` : null,
      figs.added > 0 ? `${figs.added} question${figs.added === 1 ? '' : 's'} now carry${figs.added === 1 ? 's' : ''} a labelled diagram.` : null,
      webFigures ? `${webFigures} diagram${webFigures === 1 ? '' : 's'} reused a freely licensed illustration from Wikimedia Commons or Openverse; credits are attached to each question.` : null,
      figs.want > 0 && figs.added === 0 ? 'No diagrams could be drawn this time — the picture engine did not answer.' : null,
      figs.skipped > 0 && figs.added > 0 ? `${figs.skipped} diagram${figs.skipped === 1 ? '' : 's'} skipped to stay responsive.` : null,
    ].filter(Boolean).join(' ') || null,
  }
  if (onStep) onStep({ phase: 'done', message: `${out.questions.length} question${out.questions.length === 1 ? '' : 's'} ready — ${(out.questions.length < n ? 'fewer than requested' : 'the exact count requested')}${figs.added ? `, ${figs.added} illustrated` : ''}` })
  return payload
}

teacherRouter.post('/ai/generate', mustBeTeacher, wrap(async (req, res) => {
  const { count } = req.body || {}
  const n = Math.max(1, Math.min(9000, parseInt(count) || 10))
  if (!assertAiBudget(res, req.user.id, n)) return

  const spec = req.body || {}
  if (n > SYNC_GENERATE_MAX) {
    // Too big to answer inside one request — hand back a job id instead.
    const job = createJob(req.user.id, { ...spec, count: n })
    res.status(202).json({ jobId: job.id, requested: n, status: 'running' })
    void runJob(job)
    return
  }
  res.json(await generateQuestionsPayload(req, spec, n))
}))

// Streaming question generation. Same engine as /ai/generate, but each real
// unit of work (a plan, a round, a web fill, a figure) is delivered the moment
// the server has it, so the AI Lab shows the AI working instead of one opaque
// spinner. Cancellation and heartbeats work exactly like /ai/paper/stream.
teacherRouter.post('/ai/generate/stream', mustBeTeacher, wrap(async (req, res) => {
  const { count } = req.body || {}
  const n = Math.max(1, Math.min(SYNC_GENERATE_MAX, parseInt(count) || 10))
  if (!assertAiBudget(res, req.user.id, n)) return
  if (n > SYNC_GENERATE_MAX) {
    return res.status(400).json({ error: `A batch of ${n} is too large for a live stream — use a background job instead.` })
  }
  const spec = req.body || {}

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()

  let closed = false
  res.on('close', () => { closed = true })

  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n')
  }, 15000)

  const end = () => {
    clearInterval(heartbeat)
    if (!closed) {
      closed = true
      res.end()
    }
  }
  const send = (event, data) => {
    if (closed) return
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  const emit = (step) => send('step', { ...step, at: Date.now() })

  try {
    const payload = await generateQuestionsPayload(req, spec, n, { onStep: emit, shouldStop: () => closed })
    if (closed) { end(); return }
    send('done', payload)
    end()
  } catch (err) {
    console.error('Generate stream failed:', err?.message || err)
    send('error', { error: err?.message || 'Generation failed' })
    end()
  }
}))

// Start a background generation. Returns immediately; poll /ai/jobs/:id.
teacherRouter.post('/ai/jobs', mustBeTeacher, wrap(async (req, res) => {
  const n = Math.max(1, Math.min(9000, parseInt(req.body?.count) || 10))
  if (!assertAiBudget(res, req.user.id, n)) return
  const job = createJob(req.user.id, { ...req.body, count: n })
  res.status(202).json({ jobId: job.id, requested: n, status: 'running' })
  void runJob(job)
}))

teacherRouter.get('/ai/jobs/:id', mustBeTeacher, wrap(async (req, res) => {
  const job = getJob(req.params.id, req.user.id)
  if (!job) return res.status(404).json({ error: 'Job not found or expired' })
  res.json(jobView(job, { withQuestions: true }))
}))

// The runner for a job: repeated bounded rounds rather than one enormous
// request, so progress is real and a single slow engine cannot sink the run.
const JOB_PREVIEW_INTERVAL_MS = 18_000

async function runGenerateRoundWithPreviews(job, spec, want, collected) {
  const pendingRound = runGenerateRound(spec, want).then(
    (out) => ({ out }),
    (error) => ({ error }),
  )

  while (true) {
    if (!isRunning(job.id)) return null
    let timer
    const result = await Promise.race([
      pendingRound,
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), JOB_PREVIEW_INTERVAL_MS) }),
    ])
    clearTimeout(timer)

    if (result) {
      if (result.error) throw result.error
      return result.out
    }
    if (!isRunning(job.id)) return null
    if (collected.length >= job.requested) return null

    const preview = generateLocalQuestionSet(spec, 1)[0]
    if (!preview) continue
    collected.push(preview)
    const remaining = Math.max(0, job.requested - collected.length)
    updateJob(job.id, {
      done: collected.length,
      questions: collected.slice(0, job.requested),
      note: `A preview is ready. AI is continuing in the background with ${remaining} question${remaining === 1 ? '' : 's'} remaining.`,
    })
    if (remaining === 0) return null
  }
}

async function runJob(job) {
  const spec = job.payload
  const target = job.requested
  const collected = []
  try {
    for (let round = 0; round < JOB_MAX_ROUNDS && collected.length < target; round += 1) {
      if (!isRunning(job.id)) return
      const want = Math.min(JOB_ROUND_SIZE, target - collected.length)
      const out = await runGenerateRoundWithPreviews(job, spec, want, collected)
      if (!out) {
        if (!isRunning(job.id)) return
        if (collected.length >= target) break
        continue
      }
      collected.push(...out.questions.slice(0, target - collected.length))
      updateJob(job.id, {
        done: Math.min(collected.length, target),
        questions: collected.slice(0, target),
        engines: [...job.engines, ...out.engines],
        rounds: round + 1,
        model: out.model,
        note: collected.length < target
          ? `${collected.length} of ${target} questions ready. AI is continuing in the background with ${target - collected.length} remaining.`
          : null,
      })
      if (out.questions.length === 0 && round > 0) break
    }
    const questions = collected.slice(0, target)
    const internetQuestions = questions.filter((question) => question.sourceUrl).length
    const localQuestions = questions.filter((question) => question.source === 'local-template-fallback').length
    const webSources = [...new Set(questions
      .filter((question) => question.sourceUrl)
      .map((question) => `${question.source || 'the internet'}${question.sourceLicense ? ` (${question.sourceLicense})` : ''}`))]
    finishJob(job.id, {
      questions,
      note: [
        questions.length < target ? `Collected ${questions.length} of ${target} after ${job.rounds} rounds. Run it again for the rest.` : null,
        internetQuestions ? `Generation included ${internetQuestions} question${internetQuestions === 1 ? '' : 's'} from ${webSources.join(' and ') || 'the internet'}, alongside AI-generated questions.` : null,
        localQuestions ? `${localQuestions} question${localQuestions === 1 ? '' : 's'} used local templates to complete the batch.` : null,
      ].filter(Boolean).join(' ') || null,
    })
    logAiUsage({ userId: job.userId, action: 'generate-job', model: null, provider: null, count: questions.length, latencyMs: Date.now() - job.startedAt, ok: questions.length > 0 })
    console.log(`[ai] generate-job ${job.id} done: ${questions.length}/${target} in ${Math.round((Date.now() - job.startedAt) / 1000)}s`)
  } catch (err) {
    failJob(job.id, err?.message || String(err))
  }
}

// ── Teacher subjects → question bank preparation ──
const BANK_ROUNDS = 3

// One subject's worth of questions: a few small generate rounds, exact-prompt
// dedupe against everything the teacher can see, then a single transactional
// insert tagged with subject AND level so the status query can tell phases
// apart. Runs on the bank-prep queue, one subject at a time.
async function generateSubjectBank({ userId, subject, level }) {
  const want = bankTarget()
  const budget = budgetOk(userId, want)
  if (!budget.ok) {
    console.warn(`[bank-prep] ${subject} (${level}) skipped: ${budget.used}/${budget.limit} questions used today`)
    return
  }
  // A subject the teacher removed while this task sat in the queue should not
  // build a bank nobody configured: generation stops being worth it.
  const stillTeaching = getTeacherSubjects(userId).some((s) => s.subject === subject && s.level === level)
  if (!stillTeaching) {
    console.warn(`[bank-prep] ${subject} (${level}) skipped: no longer taught`)
    return
  }
  const spec = {
    subject,
    classLevel: level,
    topic: subject,
    type: 'multiple-choice',
    difficulty: 'mixed',
    count: want,
  }
  const t0 = Date.now()
  const engines = []
  let model = null
  const collected = []
  for (let round = 0; round < BANK_ROUNDS && collected.length < want; round += 1) {
    const out = await runGenerateRound(spec, want - collected.length)
    engines.push(...out.engines)
    model = out.model || model
    const before = collected.length
    collected.push(...out.questions)
    if (collected.length === before) break
  }
  if (collected.length === 0) {
    logAiUsage({ userId, action: 'bank-prep', count: 0, latencyMs: Date.now() - t0, ok: false, model })
    throw new Error(`no questions generated for ${subject} (${level})`)
  }
  const fresh = []
  const seen = new Set()
  for (const q of collected) {
    const k = String(q?.prompt || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!k || seen.has(k)) continue
    seen.add(k)
    // Exact-prompt guard: a question the teacher already owns — from any phase —
    // is not re-added. The model is the same author as the teacher's past bank,
    // so duplicates are more likely than the web tier's.
    if (findDuplicateQuestion(q.prompt, userId)) continue
    fresh.push({ ...q, class_level: level })
  }
  let saved = []
  if (fresh.length) saved = insertQuestionsBulk(fresh, userId)
  logAiUsage({ userId, action: 'bank-prep', count: saved.length, latencyMs: Date.now() - t0, ok: saved.length > 0, model })
  console.log(`[bank-prep] ${subject} (${level}): ${saved.length} new of ${want} wanted (${engines.length} engine calls)`)
}

// The queue runs one subject at a time so a slow model cannot interleave two
// banks; the generate helper is injected to keep all AI code inside index.js.
setBankGenerateTask(generateSubjectBank)

const bankStatus = (userId, subjects, counts) => {
  const byKey = new Map(counts.map((c) => [`${c.level}::${c.subject}`, c.n]))
  return subjects.map((s) => {
    const count = byKey.get(`${s.level}::${s.subject}`) || 0
    const target = bankTarget()
    const pending = isBankQueued({ userId, subject: s.subject, level: s.level })
    const status = count >= target ? 'ready' : count > 0 ? 'partial' : pending ? 'generating' : 'pending'
    return { subject: s.subject, level: s.level, count, target, status }
  })
}

// What a teacher teaches, and how ready each bank is. Doubles as a self-heal:
// after a restart the queue forgets what it was doing, so any subject still
// short of a full bank is re-queued here — a teacher who simply opens the app
// gets their generation back.
teacherRouter.get('/my/subjects', mustBeTeacher, wrap(async (req, res) => {
  const userId = req.user.id
  const subjects = getTeacherSubjects(userId)
  const counts = bankCounts(userId)
  const wants = subjects.filter((s) => {
    const have = counts.find((c) => c.level === s.level && c.subject === s.subject)?.n || 0
    return have < bankTarget() && !isBankQueued({ userId, subject: s.subject, level: s.level })
  })
  if (wants.length) enqueueBankPrep(wants.map((s) => ({ userId, subject: s.subject, level: s.level })))
  res.json({ subjects: bankStatus(userId, subjects, counts), queue: bankQueueSize(), target: bankTarget() })
}))

// Full replace in one transaction; responds immediately so the UI never blocks
// on question generation. The generated bank catches up in the background.
teacherRouter.put('/my/subjects', mustBeTeacher, rateLimit({ max: 60, message: 'Too many saves, slow down.' }), wrap(async (req, res) => {
  const list = Array.isArray(req.body?.subjects) ? req.body.subjects : []
  if (list.length === 0) return res.status(400).json({ error: 'Choose at least one subject' })
  if (list.length > 40) return res.status(400).json({ error: 'Choose at most 40 subjects' })

  const validated = []
  for (const item of list) {
    const level = item?.level
    const subject = String(item?.subject || '').trim()
    if (!SCHOOL_LEVELS.includes(level)) return res.status(400).json({ error: `Unknown level: ${level}` })
    if (!(SUBJECT_CATALOGUE[level] || []).includes(subject)) {
      return res.status(400).json({ error: `"${subject}" is not on the ${level} subject list` })
    }
    validated.push({ subject, level })
  }

  replaceTeacherSubjects(req.user.id, validated)
  const queued = enqueueBankPrep(validated.map((s) => ({ userId: req.user.id, subject: s.subject, level: s.level })))
  res.status(200).json({ saved: validated.length, queued, target: bankTarget() })
}))

teacherRouter.post('/ai/variants', mustBeTeacher, wrap(async (req, res) => {
  const { question, count, model } = req.body || {}
  const n = Math.max(2, Math.min(9000, parseInt(count) || 5))
  if (!question || !question.trim()) return res.status(400).json({ error: 'A question is required' })

  const questions = []
  const seen = new Set()
  let result = null
  for (let attempt = 0; attempt < 3 && questions.length < n; attempt += 1) {
    const missing = n - questions.length
    const alreadyGenerated = questions.length
      ? `\nDo not repeat or lightly reword these existing variants:\n${questions.slice(-20).map((q) => q.prompt).join('\n')}`
      : ''
    const messages = [
      { role: 'system', content: MCQ_SYSTEM },
      { role: 'user', content: `Here is an existing multiple-choice question:\n${question}\n\nCreate exactly ${missing} DIFFERENT versions of this question. All versions test the SAME concept and have the SAME correct answer concept, but change:\n- numbers, values, names, examples, units or scenarios (where possible)\n- the wording of the stem\n- the order of the 4 options (correct answer position must vary)\nKeep the difficulty level the same.${alreadyGenerated}\nReturn ONLY a JSON array of exactly ${missing} question objects (same shape as before).` },
    ]

    try {
      result = await callWithFailover(env, messages, { prefer: model || null, temperature: 0.7, maxTokens: Math.min(8000, 260 * missing + 800), timeoutMs: 75000 })
    } catch (err) {
      console.warn(`[ai] variants continuation for ${missing} questions failed:`, err?.message || err)
      continue
    }
    const before = questions.length
    for (const generated of toBankQuestions(result?.text)) {
      const key = generated.prompt.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (seen.has(key)) continue
      seen.add(key)
      questions.push(generated)
      if (questions.length >= n) break
    }
    if (questions.length === before) break
  }
  recordAi(req, 'variants', {
    model: result?.model?.model || null,
    provider: result?.model?.provider || null,
    count: questions.length,
    requested: n,
    latencyMs: result?.latencyMs,
    ok: questions.length > 0,
  })
  res.json({
    success: questions.length > 0,
    count: questions.length,
    requested: n,
    model: result?.model?.model || null,
    note: questions.length < n ? `Generated ${questions.length} of ${n} requested variants after continuation attempts.` : null,
    questions,
  })
}))

teacherRouter.post('/ai/convert', mustBeTeacher, wrap(async (req, res) => {
  const { text, type, model, figures, figureStyle } = req.body || {}
  if (!text || !text.trim()) return res.status(400).json({ error: 'Paste some question text' })

  const messages = [
    { role: 'system', content: MCQ_SYSTEM },
    { role: 'user', content: `Convert this messy past-exam text into clean, structured questions.\n- Split it into individual questions\n- Fix typos and grammar\n- Reconstruct the 4 options (A-D) if options are present\n- If an option is missing or text is a statement, add plausible distractors\n- Mark the correct answer based on the material\n- Remove numbering and meta text (e.g. "Section B", "Total: 40 marks")\n\nEXAM TEXT:\n${text.slice(0, 9000)}\n\nReturn ONLY a JSON array of question objects.` },
  ]

  const questions_estimate = Math.max(5, Math.ceil(text.length / 220))
  const result = await callWithFailover(env, messages, { prefer: model || null, temperature: 0.3, maxTokens: Math.min(8000, 260 * questions_estimate + 800), timeoutMs: 75000 })
  const questions = toBankQuestions(result?.text)
  recordAi(req, 'convert', {
    model: result?.model?.model || null,
    provider: result?.model?.provider || null,
    count: questions.length,
    requested: questions_estimate,
    latencyMs: result?.latencyMs,
    ok: questions.length > 0,
  })
  // Converted past-paper questions can want diagrams too — "the diagram shows…"
  // survives the cleanup. Same budgeted phase as /ai/generate.
  const figs = await attachFigures(req, questions, { subject: req.body?.subject, figures, figureStyle })
  res.json({
    success: true,
    count: questions.length,
    model: result?.model?.model || null,
    questions,
    figures: figs.added,
    figuresWanted: figs.want,
    figuresSkipped: figs.skipped,
  })
}))

teacherRouter.post('/ai/rewrite', mustBeTeacher, wrap(async (req, res) => {
  const { question, difficulty, model } = req.body || {}
  if (!question || !question.trim()) return res.status(400).json({ error: 'A question is required' })

  const messages = [
    { role: 'system', content: MCQ_SYSTEM },
    { role: 'user', content: `Rewriter job:\n- Rephrase the question stem so it reads fresh (no identical wording)\n- Set difficulty to: ${difficulty || 'same as original'}\n- Keep the same concept and correct answer\n- Improve weak distractors (make them plausible but wrong)\n- Keep 4 options (A-D)\nReturn ONLY a JSON array containing the ONE rewritten question object.\n\nORIGINAL:\n${question}` },
  ]

  const result = await callWithFailover(env, messages, { prefer: model || null, temperature: 0.7, maxTokens: 2600, timeoutMs: 75000 })
  const rewritten = toBankQuestions(result?.text)
  const questions = rewritten.slice(0, 1)
  recordAi(req, 'rewrite', {
    model: result?.model?.model || null,
    provider: result?.model?.provider || null,
    count: questions.length,
    requested: 1,
    latencyMs: result?.latencyMs,
    ok: questions.length > 0,
  })
  res.json({ success: questions.length > 0, count: questions.length, model: result?.model?.model || null, questions })
}))

teacherRouter.post('/ai/blueprint', mustBeTeacher, wrap(async (req, res) => {
  const { prompt, model } = req.body || {}
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Describe the exam you want to build' })

  const { BLUEPRINT_SYSTEM } = await import('./config/ai.js')
  const messages = [
    { role: 'system', content: BLUEPRINT_SYSTEM },
    { role: 'user', content: prompt },
  ]

  const result = await callWithFailover(env, messages, { prefer: model || null, temperature: 0.3 })
  let blueprint = null
  try {
    blueprint = JSON.parse(cleanJson(result.text))
  } catch (err) {
    console.error('Failed to parse AI blueprint:', err)
    return res.status(500).json({ error: 'Failed to generate blueprint' })
  }

  recordAi(req, 'blueprint', {
    model: result?.model?.model || null,
    provider: result?.model?.provider || null,
    ok: true,
  })
  res.json({ success: true, blueprint })
}))

teacherRouter.post('/ai/chat', wrap(async (req, res) => {
  const { messages: history, context, language, model } = req.body || {}
  if (!Array.isArray(history) || history.length === 0) return res.status(400).json({ error: 'No messages provided' })

  const { CHATS_SYSTEM } = await import('./config/ai.js')
  const langPrompt = language && language !== 'English' ? `\nIMPORTANT: Respond in the ${language} language, while keeping technical concepts clear.` : ''
  const messages = [
    { role: 'system', content: CHATS_SYSTEM + langPrompt },
    { role: 'system', content: `Current Screen Context: ${JSON.stringify(context || {})}` },
    ...history.slice(-10) // Keep last 10 messages for context
  ]

  const result = await callWithFailover(env, messages, { prefer: model || null, temperature: 0.7 })
  recordAi(req, 'chat', {
    model: result?.model?.model || null,
    provider: result?.model?.provider || null,
    ok: true,
  })
  res.json({ success: true, text: result.text })
}))

studentRouter.post('/ai/explain', mustBeStudent, wrap(async (req, res) => {
  const { question, answer, topic, language, model } = req.body || {}
  if (!question) return res.status(400).json({ error: 'Question is required' })

  const { CHATS_SYSTEM } = await import('./config/ai.js')
  const langPrompt = language && language !== 'English' ? ` Please explain in the ${language} language.` : ''
  const messages = [
    { role: 'system', content: CHATS_SYSTEM },
    { role: 'user', content: `Please explain this question and why the correct answer is what it is.${langPrompt}\n\nQuestion: ${question}\nCorrect Answer: ${answer}\nTopic: ${topic || 'General'}` }
  ]

  const result = await callWithFailover(env, messages, { prefer: model || null, temperature: 0.5 })
  recordAi(req, 'explain', {
    model: result?.model?.model || null,
    provider: result?.model?.provider || null,
    ok: true,
  })
  res.json({ success: true, explanation: result.text })
}))

studentRouter.get('/my/recommendations', mustBeStudent, wrap(async (req, res) => {
  const { listAssignedExamsWithResults } = await import('./db.js')
  const history = listAssignedExamsWithResults(req.user.id)
  
  if (!history.length) {
    return res.json({ summary: 'Start taking exams to get personalized recommendations!', recommendations: [] })
  }

  const { CHATS_SYSTEM } = await import('./config/ai.js')
  const messages = [
    { role: 'system', content: CHATS_SYSTEM },
    { role: 'user', content: `Here is my exam history:\n${JSON.stringify(history.slice(0, 10))}\n\nBased on my performance, what should I study next? Provide 3 specific topics and a brief summary of my progress. Return ONLY a JSON object with keys: "summary" (string), "recommendations" (array of strings).` }
  ]

  const result = await callWithFailover(env, messages, { temperature: 0.4 })
  let data = { summary: 'Keep practicing!', recommendations: [] }
  try {
    data = JSON.parse(cleanJson(result.text))
  } catch (err) {
    console.error('Failed to parse AI recommendations:', err)
  }

  res.json(data)
}))

// Shared paper generator, used by the synchronous /ai/paper endpoint and the
// streaming /ai/paper/stream endpoint (which feeds the Exam Sheet's "thinking"
// drawer while a big paper is being written). `onStep` receives a live,
// human-readable step every time something real happens; `shouldStop` lets the
// streaming caller cut the run short when the teacher cancels or the browser
// goes away — an in-flight provider call finishes, then the run stops.
async function runPaperGeneration(req, { onStep, shouldStop } = {}) {
  const { subject, classLevel, sections: legacySections, model, withFigures, blueprint, type } = req.body || {}
  if (!subject) return { error: 'Subject is required' }
  const questionType = normalizeQuestionType(type)

  // Diagram settings are accepted in two places, and the exam-sheet tool sends
  // them inside `blueprint` while the AI Lab sends them at the top level. Only
  // reading the top level meant the exam sheet's figure count and its
  // Pencil/Clean choice were silently discarded and fell back to "a third".
  const figureSpec = { ...(blueprint && typeof blueprint === 'object' ? blueprint : {}), ...req.body }

  // An exact `figures` wins; otherwise `figureRatio` is a share of the paper;
  // otherwise attachFigures() falls back to a third, capped at 20.
  const figureCount = Number.isFinite(Number(req.body?.figures)) && req.body?.figures !== null && req.body?.figures !== undefined
    ? Number(req.body.figures)
    : (figureSpec.figures !== undefined && figureSpec.figures !== null && Number.isFinite(Number(figureSpec.figures))
        ? Number(figureSpec.figures)
        : undefined)
  const figureRatioVal = Number.isFinite(Number(req.body?.figureRatio)) && Number(req.body.figureRatio) > 0
    ? Number(req.body.figureRatio)
    : (Number.isFinite(Number(figureSpec.figureRatio)) && Number(figureSpec.figureRatio) > 0
        ? Number(figureSpec.figureRatio)
        : undefined)
  const figureStyle = req.body?.figureStyle ?? figureSpec.figureStyle
  /* `source` is per-request: 'auto' (AI draw, then the web when it fails),
     'ai' (drawn only), or 'web' (real licensed diagrams from the web only). */
  const figureSource = figureSourceMode(req.body?.figureSource ?? figureSpec.figureSource)

  // A blueprint (compulsory + optional) is the normal path. The legacy
  // per-topic `sections` array is still accepted so older clients and the
  // exam-sheet tool keep working; it is normalised into compulsory sections.
  const specs = blueprint
    ? buildPaperSections(blueprint, subject, questionType)
    : (Array.isArray(legacySections) && legacySections.length
        ? normaliseLegacySections(legacySections)
        : buildPaperSections({ compulsory: 20 }, subject, questionType))

  const total = specs.reduce((a, s) => a + s.count, 0)

  // A section spec always carries its generation plan. Legacy specs arrive
  // without one, so it is derived here. `mix` is a list of {type, qtype, count}
  // groups — one format per section is a single group; a mixed request ("5 MCQ +
  // 1 essay") is several, and each group is filled to its OWN count, never by
  // borrowing across formats. That is the strict rule the teacher asked for.
  const groupsFor = (s) =>
    Array.isArray(s.mix) && s.mix.length
      ? s.mix
      : [{ type: s.type || 'multiple-choice', qtype: s.type ? theoryQType(s.type) : 'theory', count: s.count }]
  const groupLabel = (g) => (g.type === 'theory' ? `${g.qtype === 'essay' ? 'essay' : 'theory'}` : 'multiple-choice')

  if (onStep) {
    onStep({ phase: 'begin', message: `Starting the ${subject} paper — ${total} question${total === 1 ? '' : 's'} across ${specs.length} section${specs.length === 1 ? '' : 's'}` })
    if (blueprint && typeof blueprint === 'object') {
      const lines = specs.map((s) => {
        const groups = groupsFor(s)
        const mix = groups.length > 1 ? sectionFormatLabel(groups) : `${s.count} ${groupLabel(groups[0])}${s.count === 1 ? '' : 's'}`
        return `${s.title}: ${mix} · ${s.marks} mark${s.marks === 1 ? '' : 's'} each${s.kind === 'optional' ? ` — candidate answers any ${s.answerAny} of the ${s.count}` : ''}`
      })
      onStep({
        phase: 'plan',
        message: `Plan: ${subject}${classLevel ? `, ${classLevel}` : ''} — every count below is exact`,
        lines,
      })
    }
    specs.forEach((s) => {
      const groups = groupsFor(s)
      const about = groups.length === 1
        ? `${groups[0].count} ${groupLabel(groups[0])} question${groups[0].count === 1 ? '' : 's'}`
        : sectionFormatLabel(groups)
      onStep({ phase: 'section', section: s.title, kind: s.kind, type: s.type, count: s.count, message: `Writing ${s.title}: ${about}` })
    })
  }

  // Each section is generated independently and in parallel with its own prompt,
  // so one weak section never sinks the whole sheet and sections keep their
  // topic grouping (the exam sheet relies on clean per-section question arrays).
  // `groupType` is the concrete format for the group being written.
  const messagesForSection = (s, groupType, count, existingQuestions = []) => {
    const theory = sectionIsTheory(groupType)
    const stem = theory
      ? `${theoryQType(groupType) === 'essay' ? 'essay' : 'theory/essay'} questions`
      : 'multiple-choice questions'
    const accepted = theory
      ? `Use a clear question, the marks it carries and a marking guide for each item. Return ONLY a JSON array of exactly ${count} question objects with the shape {"question":"...","mark":"5","markingGuide":"..."}.\n`
      : 'Return ONLY a JSON array of exactly ' + `${count}` + ' question objects.'
    return [
      { role: 'system', content: MCQ_SYSTEM },
      {
        role: 'user',
        content: `Write exactly ${count} DIFFERENT ${stem} for a ${classLevel || 'Senior Secondary'} ${subject} ${theory ? '' : 'objective '}exam.\n`
          + `Section: ${s.title} (${s.kind}). ${s.instruction}\n`
          + `Coverage — ${s.topicHint}.\n`
          + `Spread the ${count} questions across that coverage so no two are near-duplicates.\n`
          + (existingQuestions.length ? `Do not repeat these already generated questions: ${existingQuestions.join(' | ')}\n` : '')
          + (s.hasSiblings ? 'This paper has another section: do NOT write a question that would also fit the other section, and do not repeat anything it would ask.\n' : '')
          + accepted,
      },
    ]
  }

  // A web search topic from the teacher's coverage hint: the descriptive prose
  // is reduced to a short searchable phrase so Open Trivia/Wikipedia can find
  // real questions on the same subject.
  const hintToTopic = (hint) =>
    String(hint || '')
      .toLowerCase()
      .replace(/^only (these )?topics?:\s*/, '')
      .replace(/^only this topic:\s*/, '')
      .replace(/\s*syllabus.*$/i, '')
      .replace(/^(core topics|remaining topics):\s*/i, '')
      .split(/[\n;,]+/)[0]
      .trim()

  const promptKey = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const seen = new Set()
  const acceptedPrompts = []
  let nearRepeats = 0
  const accept = (q, { similar = true } = {}) => {
    const key = promptKey(q?.prompt)
    if (!key || seen.has(key)) return false
    if (similar && acceptedPrompts.some((p) => tooSimilar(p, q.prompt))) {
      nearRepeats += 1
      return false
    }
    seen.add(key)
    acceptedPrompts.push(q.prompt)
    return true
  }

  const jobs = specs.map(async (s) => {
    const started = Date.now()
    const questions = []
    let result = null
    let error = null
    const groups = groupsFor(s)
    const shortGroups = []

    for (const group of groups) {
      if (shouldStop && shouldStop()) break
      const theory = sectionIsTheory(group.type)
      const groupGot = []
      const parsedCount = () => questions.length + groupGot.length

      let emptyRounds = 0
      for (let attempt = 0; attempt < 5 && groupGot.length < group.count; attempt += 1) {
        if (shouldStop && shouldStop()) break
        const missing = group.count - groupGot.length
        const opts = { prefer: model || null, engines: 3, temperature: attempt === 0 ? 0.4 : 0.7, maxTokens: Math.min(12000, 260 * missing + 800), timeoutMs: 90000 }
        const existing = acceptedPrompts.slice(-60).map((p) => String(p).slice(0, 90))
        try {
          result = missing >= 20
            ? await splitGenerate(env, (chunk) => messagesForSection(s, group.type, chunk, existing), missing, opts)
            : await callWithFailover(env, messagesForSection(s, group.type, missing, existing), opts)
        } catch (err) {
          error = err?.message || String(err)
          if (onStep) onStep({ phase: 'warn', section: s.title, message: `${s.title}: ${error} — retrying` })
          continue
        }

        // Theory/essay groups parse as prose questions (stem + marks + guide),
        // not as four-option MCQs. Feeding them through toBankQuestions would
        // drop every item for having no options and leave the group empty.
        const parsed = theory ? toTheoryQuestions(result?.text) : toBankQuestions(result?.text)
        const before = groupGot.length
        for (const generated of parsed) {
          if (!accept(generated)) continue
          // Every question in the group is the group's own format; a mixed
          // section never borrows an essay to fill an MCQ slot or vice versa.
          if (theory) generated.qtype = group.qtype || theoryQType(group.type)
          groupGot.push(generated)
          if (groupGot.length >= group.count) break
        }
        if (groupGot.length > before && onStep) {
          onStep({ phase: 'progress', section: s.title, done: parsedCount(), count: s.count, message: `${s.title}: ${parsedCount()} of ${s.count} question${s.count === 1 ? '' : 's'} ready` })
        }
        if (groupGot.length === before) {
          emptyRounds += 1
          if (emptyRounds >= 2) break
        } else {
          emptyRounds = 0
        }
      }

      // The strict rule: an MCQ group is filled to its exact count. When the AI
      // cannot finish, real web questions (Open Trivia/Wikipedia, attributed)
      // and then local templates complete the group BEFORE the paper is handed
      // back — a section never silently comes up short.
      if (!theory && groupGot.length < group.count && !(shouldStop && shouldStop())) {
        const missing = group.count - groupGot.length
        const webSpec = { subject, classLevel, topic: hintToTopic(s.topicHint), type: 'multiple-choice', difficulty: 'medium' }
        try {
          if (onStep) onStep({ phase: 'web', section: s.title, message: `${s.title}: AI wrote ${groupGot.length} of ${group.count} — searching the web for the other ${missing}` })
          const web = await collectWebQuestions(webSpec, Math.min(200, missing * 2)).catch((err) => {
            if (onStep) onStep({ phase: 'warn', section: s.title, message: `${s.title}: web search failed — ${err?.message || 'no result'}` })
            return { questions: [], labels: [] }
          })
          const webAdded = []
          for (const q of web.questions) {
            if (!accept(q)) continue
            webAdded.push(q)
            if (groupGot.length + webAdded.length >= group.count) break
          }
          if (webAdded.length && onStep) {
            onStep({ phase: 'web', section: s.title, message: `${s.title}: ${webAdded.length} missing question${webAdded.length === 1 ? '' : 's'} filled from the web (${web.labels.filter(Boolean).join(' and ') || 'real published questions'}) — each carries its source credit` })
          }
          groupGot.push(...webAdded)
        } catch { /* collectWebQuestions is already guarded; kept for safety */ }
        if (groupGot.length < group.count) {
          const localAdd = []
          for (let round = 0; round < 4 && groupGot.length + localAdd.length < group.count; round += 1) {
            const need = group.count - groupGot.length - localAdd.length
            for (const q of generateLocalQuestionSet(webSpec, Math.min(200, need * 3))) {
              if (!accept(q, { similar: false })) continue
              localAdd.push(q)
              if (groupGot.length + localAdd.length >= group.count) break
            }
          }
          if (localAdd.length && onStep) {
            onStep({ phase: 'warn', section: s.title, message: `${s.title}: ${localAdd.length} question${localAdd.length === 1 ? '' : 's'} completed from local templates to honour the exact count` })
          }
          groupGot.push(...localAdd)
        }
        if (groupGot.length) {
          if (onStep) onStep({ phase: 'progress', section: s.title, done: parsedCount(), count: s.count, message: `${s.title}: ${parsedCount()} of ${s.count} question${s.count === 1 ? '' : 's'} ready` })
        }
      }

      if (groupGot.length < group.count) shortGroups.push({ group, got: groupGot.length })
      questions.push(...groupGot)
    }

    recordAi(req, 'paper', {
      model: result?.model?.model || null,
      provider: result?.model?.provider || null,
      count: questions.length,
      requested: s.count,
      latencyMs: Date.now() - started,
      ok: questions.length > 0,
      extra: `section=${s.title} type=${s.type || 'multiple-choice'}`,
    })
    return { ...s, questions, ok: questions.length > 0, error, shortGroups }
  })
  const results = await Promise.all(jobs)

  // Diagrams. The teacher sets how many (an exact count, or a share of the
  // paper); attachFigures() picks the questions that actually want one — a
  // question that says "in the diagram below" is worth a diagram, a recall
  // question is not — and spreads the picks across sections so every topic on
  // the paper gets illustrated.
  //
  // Figures are best-effort, so the phase runs on one wall-clock budget. Without
  // it a 20-figure paper with a slow diagram engine could keep the request open
  // for many minutes; instead we draw as many as the budget allows and hand the
  // paper back, saying how many were skipped.
  const totalQuestions = results.reduce((a, r) => a + r.questions.length, 0)
  // A flat view of every question. These are the *same objects* the sections
  // hold, so attachFigures() writing `q.figure` here writes it into the paper.
  const flat = results.flatMap((r) => r.questions)
  const figs = await attachFigures(req, flat, {
    subject,
    withFigures: withFigures === false ? false : undefined,
    figures: figureCount,
    figureRatio: figureRatioVal,
    style: figureStyle,
    source: figureSource,
    onStep,
    shouldStop,
  })

  const filled = results.filter((r) => r.questions.length > 0)
  // One continuous sheet: sections are kept (they carry the compulsory/optional
  // rules) but the questions are a single unbroken run numbered 1..N by the
  // client, exactly as the paper is printed.
  const paper = filled.length > 0
    ? {
        paperTitle: `${subject} ${classLevel || ''} — Generated Paper`.trim(),
        instructions: paperInstructions(filled, subject, classLevel),
        maxScore: paperMaxScore(filled),
        sections: filled.map((r) => ({
          title: r.title,
          kind: r.kind,
          answerAny: r.answerAny ?? null,
          type: normaliseSectionType(r.type),
          marks: r.marks,
          instruction: r.instruction,
          requested: r.count,
          count: r.questions.length,
          questions: r.questions,
        })),
      }
    : null
  const notes = []
  const shortSections = results.filter((r) => r.questions.length < r.count)
  if (paper && shortSections.length > 0) {
    // Honest about which part of a mixed section fell short — the teacher asked
    // for an exact split (e.g. 5 MCQ + 1 essay), and the note names the group
    // that could not be completed rather than hiding behind a section total.
    notes.push(shortSections.map((r) => {
      const planned = sectionFormatLabel(r.mix || [{ type: r.type || 'multiple-choice', qtype: r.type ? theoryQType(r.type) : 'theory', count: r.count }])
      const misses = (r.shortGroups || []).map(({ group, got }) => `${group.count - got} ${groupLabel(group)} short`).join(', ')
      return `${r.title}: ${r.questions.length}/${r.count} of ${planned} — ${misses} after AI retries, web search and local template attempts`
    }).join('; '))
  }
  if (nearRepeats > 0) {
    notes.push(`${nearRepeats} near-duplicate question${nearRepeats === 1 ? ' was' : 's were'} rejected and replaced so nothing is printed twice.`)
  }
  if (figs.added > 0) {
    notes.push(`${figs.added} of ${totalQuestions} question${totalQuestions === 1 ? '' : 's'} now carr${totalQuestions === 1 ? 'ies' : 'y'} a labelled diagram.`)
  }
  if (figs.want > 0 && figs.added === 0) {
    notes.push('No diagrams could be drawn — the picture engine did not answer.')
  }
  if (figs.skipped > 0 && figs.added > 0) {
    notes.push(`${figs.skipped} diagram${figs.skipped === 1 ? '' : 's'} skipped to keep the paper responsive — draw the rest individually if needed.`)
  }
  if (onStep) onStep({ phase: 'done', message: `Paper ready — ${paper ? paper.sections.reduce((a, s) => a + s.questions.length, 0) : 0} questions${figs.added ? `, ${figs.added} illustrated` : ''}` })

  return {
    success: Boolean(paper),
    model: null,
    paper,
    note: notes.length ? notes.join(' ') : null,
    total,
    cap: MAX_PAPER_QUESTIONS,
    figures: figs.added,
    figuresWanted: figs.want,
    figuresSkipped: figs.skipped,
  }
}

// Synchronous paper generation: one request, the full paper back in the body.
// The Exam Sheet uses the streaming twin below; this stays for callers that
// want no live feed (the AI Lab's paper panel).
teacherRouter.post('/ai/paper', mustBeTeacher, wrap(async (req, res) => {
  const result = await runPaperGeneration(req)
  if (result.error) return res.status(400).json({ error: result.error })
  res.json(result)
}))

// Streaming paper generation. Opens a Server-Sent Events channel, emits one
// `step` event per real unit of work, and closes with a `done` event carrying
// the same payload /ai/paper returns. Heartbeats every 15s keep the connection
// alive through the dev proxy, which is exactly the transport-level drop that
// used to kill one huge blocking request. The teacher can also cancel mid-run:
// the browser drops the connection, the server stops after the current call.
teacherRouter.post('/ai/paper/stream', mustBeTeacher, wrap(async (req, res) => {
  const { subject } = req.body || {}
  if (!subject) return res.status(400).json({ error: 'Subject is required' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()

  let closed = false
  res.on('close', () => { closed = true })

  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n')
  }, 15000)

  const end = () => {
    clearInterval(heartbeat)
    if (!closed) {
      closed = true
      res.end()
    }
  }
  const send = (event, data) => {
    if (closed) return
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  const emit = (step) => send('step', { ...step, at: Date.now() })

  try {
    const payload = await runPaperGeneration(req, { onStep: emit, shouldStop: () => closed })
    if (closed) { end(); return }
    if (payload.error) {
      send('error', { error: payload.error })
      end()
      return
    }
    send('done', payload)
    end()
  } catch (err) {
    console.error('Paper stream failed:', err?.message || err)
    send('error', { error: err?.message || 'Generation failed' })
    end()
  }
}))

// Embeds a snippet and searches the bank for near matches. This is what the
// AI Lab's Embeddings panel calls, so the panel reports real similarity
// results instead of only a vector size.
teacherRouter.post('/ai/embed', mustBeTeacher, wrap(async (req, res) => {
  const { text } = req.body || {}
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Missing text' })
  const key = env[EMBED_MODEL.key]
  if (!key || key.length < 20) return res.status(400).json({ error: 'Missing text or NV_EMBEDDER_KEY not configured' })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const r = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL.model, input: [String(text).slice(0, 2000)], input_type: 'query' }),
      signal: controller.signal,
    })
    if (!r.ok) throw new Error(`Embedding HTTP ${r.status}`)
    const data = await r.json()
    const vector = data?.data?.[0]?.embedding
    const dims = Array.isArray(vector) ? vector.length : 0

    // Rank the bank against the fresh vector. cosineSimilarity is reused rather
    // than reimplemented here.
    const bank = questionFingerprints(req.user.id)
    const { cosineSimilarity } = await import('./dedupe.js')
    const top = bank
      .map((row) => ({
        id: row.id,
        prompt: row.prompt,
        subject: row.subject ?? null,
        similarity: Array.isArray(row.embedding) && row.embedding.length === dims ? cosineSimilarity(vector, row.embedding) : null,
        comparable: Array.isArray(row.embedding) && row.embedding.length === dims,
      }))
      .filter((row) => row.similarity != null)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5)

    recordAi(req, 'embed', {
      model: EMBED_MODEL.model,
      provider: 'nvidia',
      count: dims ? 1 : 0,
      ok: true,
      extra: `dims=${dims || '?'} matches=${top.length}`,
    })
    res.json({ success: true, dims, model: EMBED_MODEL.model, matches: top, threshold: DUP_SIMILARITY })
  } finally {
    clearTimeout(timer)
  }
}))

teacherRouter.post('/ai/image', mustBeTeacher, rateLimit({ max: 5000, message: 'Too many image requests, slow down.' }), wrap(async (req, res) => {
  const { prompt, model, size, count, source: sourceReq } = req.body || {}
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'A picture prompt is required' })
  const n = Math.max(1, Math.min(100, parseInt(count) || 1))
  // Per-request picture source. 'web' skips the AI arms entirely; 'ai' skips
  // the web search; 'auto' (default) draws and mixes in web images.
  const mode = figureSourceMode(sourceReq)
  // Size presets as aspect strings; mapped to concrete pixel sizes by route. NIM
  // models that only take an aspect ratio (SD3) use the left-hand value; the
  // OpenAI-style and width/height NIMs get the concrete WxH.
  const SIZE_MAP = {
    '1:1': '1024x1024',
    '16:9': '1344x768',
    '9:16': '768x1344',
    '5:4': '1280x1024',
    '4:5': '1024x1280',
    '3:2': '1152x768',
    '2:3': '768x1152',
  }
  const aspect = SIZE_MAP[size] ? size : '1:1'
  const pixSize = SIZE_MAP[aspect]
  const started = Date.now()

  /* Two ways to draw this, started at the same time, first answer wins.
     Every hosted NVIDIA image NIM in IMAGE_MODELS is currently either 404 or
     times out after a minute, so running them first and *then* asking a text
     engine for SVG meant every picture cost 90 seconds and usually still came
     back empty — the exact failure teachers kept seeing. Racing them means a
     picture arrives in the time the drawing actually takes. */
  /* A chain that produced nothing must REJECT rather than resolve.
     Promise.any settles on the first promise that fulfills, so a fulfilled
     `{ images: [] }` counted as a win and the studio returned "0 images" even
     when the drawing beside it had already succeeded. */
  // 'web' mode runs neither arm; they reject instantly and the web search below
  // is the whole request.
  const runAiArms = mode !== 'web'
  const raster = runAiArms
    ? genImageWithFailover(env, prompt.trim(), {
        prefer: model || null,
        n,
        size: pixSize,
        aspect,
        timeoutMs: 45000,
        // Whole chain, not per model: three slow engines must not turn one
        // picture request into a 135s wait.
        totalBudgetMs: 90000,
      })
        .then((r) => {
          const images = r?.images?.map((img) => (img.b64 ? `data:${r.mime};base64,${img.b64}` : img.url)).filter(Boolean) || []
          if (!images.length) throw new Error('image engines returned no pictures')
          return { result: r, images, fig: null }
        })
        .catch((err) => {
          console.warn('[ai] image engines failed:', err?.message || err)
          throw err
        })
    : Promise.reject(new Error('web-only mode'))

  // A diagram engine draws the same request as a clean SVG — a real renderable
  // image with no extra dependency, and today the only one that answers.
  const svgFig = runAiArms
    ? generateFigure(env, { subject: null, prompt: prompt.trim() }, {
        // Same generous budget as /ai/figure. This used to be 45s/60s while every
        // raster engine was timing out at 45s, so the drawing arm started already
        // half-spent and lost the race it was entered to win.
        timeoutMs: 90000,
        totalBudgetMs: 200000,
        style: req.body?.style,
      })
        .then((f) => {
          if (!f) throw new Error('diagram engines returned nothing')
          return { result: null, images: [f.image], fig: f }
        })
        .catch((err) => {
          console.warn('[ai] diagram fallback failed:', err?.message || err)
          throw err
        })
    : Promise.reject(new Error('web-only mode'))

  const webTask = mode === 'ai' ? Promise.resolve([]) : searchCommonsImages(prompt.trim(), { count: Math.max(10, n), timeoutMs: 8000 })
  const [first, webImages] = await Promise.all([
    Promise.any([raster, svgFig]).catch(() => ({ result: null, images: [], fig: null })),
    webTask,
  ])

  const result = first.result || null
  const aiImages = first.fig ? [first.fig.image] : (first.images || [])
  const images = []
  const imageSources = []

  const appendAi = (sourceImages) => {
    for (const image of sourceImages) {
      if (images.length >= n) break
      images.push(image)
      imageSources.push(null)
    }
  }
  const appendWeb = (sourceImages) => {
    for (const sourceImage of sourceImages) {
      if (images.length >= n) break
      if (images.includes(sourceImage.url)) continue
      images.push(sourceImage.url)
      imageSources.push(sourceImage)
    }
  }

  // AI Chairman: Fill as many slots as possible with AI first.
  appendAi(aiImages)

  // Fallback: If we still need images and aren't in 'ai-only' mode, fill with web.
  if (images.length < n && mode !== 'ai') {
    appendWeb(webImages)
  }

  // Final check: if still empty and we can use web, try one last search.
  if (images.length === 0 && mode !== 'ai') {
    const lastResort = await searchCommonsImages(prompt.trim(), { count: n, timeoutMs: 8000 }).catch(() => [])
    appendWeb(lastResort)
  }
  const source = [
    aiImages.length ? (first.fig ? 'AI diagrams' : 'AI image models') : null,
    imageSources.some(Boolean) ? 'Wikimedia Commons' : null,
  ].filter(Boolean).join(' + ') || null
  const latencyMs = Date.now() - started
  recordAi(req, 'image', {
    model: first.fig?.model || result?.model?.model || null,
    provider: first.fig?.provider || result?.model?.provider || null,
    count: images.length,
    requested: n,
    latencyMs,
    ok: images.length > 0,
    extra: `${source || 'no image source'} size=${aspect}`,
  })
  res.json({
    success: images.length > 0,
    count: images.length,
    requested: n,
    model: first.fig?.model || result?.model?.model || null,
    mime: first.fig ? 'image/svg+xml' : (result?.mime || null),
    latencyMs,
    aspect,
    svgFallback: Boolean(first.fig),
    source,
    imageSources,
    prompt: prompt.trim(),
    images,
  })
}))

// Draw a single diagram/figure (SVG) for one exam question. `style` is
// 'pencil' (the default — hand-drawn look, paper grain) or 'clean'.
teacherRouter.post('/ai/figure', mustBeTeacher, rateLimit({ max: 5000, message: 'Too many diagram requests, slow down.' }), wrap(async (req, res) => {
  const { prompt, subject, extra } = req.body || {}
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'A question prompt is required' })
  const fig = await generateFigure(env, { subject: subject || null, prompt: prompt.trim(), extra }, {
    /* A labelled diagram is a long answer, and the engines that actually draw
       them take 25–45s. The old 45s ceiling sat exactly on the edge of that:
       the first engine timed out, burned the budget, and the request reported a
       failure moments before a later engine could have answered. */
    timeoutMs: 90000,
    totalBudgetMs: 200000,
    style: req.body?.style,
  })
  recordAi(req, 'figure', {
    model: fig?.model || null,
    provider: fig?.provider || null,
    count: fig ? 1 : 0,
    requested: 1,
    ok: Boolean(fig),
    extra: `style=${req.body?.style === 'clean' ? 'clean' : 'pencil'}`,
  })
  if (!fig) return res.status(502).json({ error: 'Could not draw a diagram right now. Every diagram engine was rate-limited or timed out — wait a minute and try again.' })
  res.json({ success: true, svg: fig.svg, image: fig.image, model: fig.model })
}))

// Draw a batch of diagrams in one request. The exam sheet and the AI Lab both
// use this to fill in a whole paper's worth of pictures: one round trip instead
// of one request per question, with the concurrency cap and wall-clock budget
// applied server-side so a 20-question batch cannot hang the tab.
teacherRouter.post('/ai/figures', mustBeTeacher, rateLimit({ max: 5000, message: 'Too many diagram batches, slow down.' }), wrap(async (req, res) => {
  const items = Array.isArray(req.body?.questions) ? req.body.questions : []
  if (!items.length) return res.status(400).json({ error: 'A questions array is required' })
  const subject = req.body?.subject || null
  const style = req.body?.style
  const mode = figureSourceMode(req.body?.source)
  // The whole batch, not a slice of it: the caller already decided how many
  // pictures this paper needs.
  const limit = items.length
  const results = new Array(limit).fill(null)
  const started = Date.now()
  const perFigureMs = resolveTimeoutMs(env.AI_FIGURE_TIMEOUT_MS, 90000)
  /* Same rule as attachFigures: the wall-clock allowance scales with the batch
     size, so asking for a hundred drawings is slow rather than truncated. */
  const derivedMs = Math.ceil(limit / 4) * perFigureMs
  const configured = req.body?.budgetMs ?? env.AI_FIGURE_BUDGET_MS
  const budgetMs = configured ? resolveTimeoutMs(configured, 120000) : derivedMs

  await mapLimit(Array.from({ length: limit }, (_, i) => i), 4, async (i) => {
    if (Date.now() - started > budgetMs) return
    const q = items[i] || {}
    const prompt = typeof q === 'string' ? q : q.prompt
    if (!prompt || !String(prompt).trim()) return
    try {
      // 'web' mode asks for real licensed drawings from the web, with the local
      // SVG as the fallback — the same tiering attachFigures() uses, so "Draw
      // all" honours the sheet's Picture source toggle instead of always calling
      // the image engines.
      if (mode === 'web') {
        const web = await findWebImage(imageQueryFor({ subject, prompt: String(prompt).trim() }))
        if (web?.image) {
          results[i] = {
            ok: true,
            image: web.image,
            model: 'wikimedia-commons',
            source: 'web',
            credit: { title: web.title, credit: web.credit, license: web.license, sourceUrl: web.sourceUrl },
          }
        } else {
          results[i] = { ok: true, image: generateLocalSvgFigure({ subject, prompt: String(prompt).trim(), style: style || 'pencil' }), model: 'local-svg', source: 'local' }
        }
        return
      }
      const fig = await generateFigure(env, { subject, prompt: String(prompt).trim() }, {
        timeoutMs: perFigureMs,
        totalBudgetMs: perFigureMs * 2,
        style,
      })
      results[i] = fig ? { ok: true, image: fig.image, model: fig.model } : { ok: false }
    } catch (err) {
      results[i] = { ok: false, error: err?.message || String(err) }
      console.warn('[ai] figure batch item failed:', err?.message || err)
    }
  })

  const figures = results.filter((r) => r?.ok)
  recordAi(req, 'figures', {
    count: figures.length,
    requested: limit,
    latencyMs: Date.now() - started,
    ok: figures.length > 0,
    extra: `style=${style === 'clean' ? 'clean' : 'pencil'}`,
  })
  res.json({
    success: figures.length > 0,
    count: figures.length,
    requested: limit,
    // Positional, so the client can put each image back on its own question.
    results,
    elapsedMs: Date.now() - started,
  })
}))

// ── Student: my exams ──
// One review row per question on the sheet, tagged with the section it belongs
// to and whether it actually counted toward the score. An optional question
// outside the candidate's quota is still shown (so the candidate can see what
// they answered) but flagged as not marked.
//
// A theory/essay question is `manual`: the candidate's free-text answer is
// recorded but there is no right/wrong — the teacher marks it separately.
function buildExamReview(exam, answers = {}, counted = []) {
  const ranges = examSectionRanges(exam)
  const sectionFor = (i) => ranges.find((s) => i >= s.start && i < s.end) || ranges[0] || { title: 'SECTION A', kind: 'compulsory' }
  return exam.questions.map((q, i) => {
    const sec = sectionFor(i)
    const manual = isManualQuestion(exam, i)
    return {
      idx: i,
      prompt: q.prompt,
      options: q.options,
      topic: q.topic,
      qtype: q.qtype || (manual ? 'theory' : null),
      mark: q.mark ?? null,
      markingGuide: q.markingGuide ?? null,
      manual,
      explanation: q.explanation ?? null,
      figure: q.figure || null,
      chosen: answers?.[i] ?? null,
      correct: q.answer,
      section: sec.title,
      optional: sec.kind === 'optional',
      counted: sec.kind === 'optional' ? Boolean(counted[i]) : true,
    }
  })
}

studentRouter.get('/my/exams', mustBeStudent, wrap(async (req, res) => {
  res.json({ exams: listAssignedExamsWithResults(req.user.id) })
}))

studentRouter.get('/my/exams/:id', mustBeStudent, wrap(async (req, res) => {
  const examId = Number(req.params.id)
  if (!isAssigned(examId, req.user.id)) return res.status(403).json({ error: 'This exam is not assigned to you' })
  const existing = getResult(examId, req.user.id)
  if (existing) return res.status(409).json({ error: 'You have already submitted this exam' })
  const exam = getExam(examId)
  res.json({
    exam: {
      id: exam.id,
      title: exam.title,
      subject: exam.subject,
      class_level: exam.class_level,
      duration_minutes: exam.duration_minutes,
      // One continuous paper: `questions` is numbered 1..N and `sections`
      // says how that run is split (compulsory / optional) and marked.
      sections: examSectionRanges(exam),
      maxScore: examMaxScore(exam),
      questions: exam.questions.map((q, i) => ({
        idx: i,
        prompt: q.prompt,
        options: q.options,
        topic: q.topic,
        figure: q.figure || null,
        qtype: q.qtype || null,
        mark: q.mark ?? null,
      })),
    },
  })
}))

studentRouter.post('/my/exams/:id/submit', mustBeStudent, rateLimit({ max: 20 }), wrap(async (req, res) => {
  const examId = Number(req.params.id)
  if (!isAssigned(examId, req.user.id)) return res.status(403).json({ error: 'This exam is not assigned to you' })
  const exam = getExam(examId)
  const { answers = {}, marked = 0, tabLeaves = 0 } = req.body || {}
  if (typeof answers !== 'object' || answers === null) return res.status(400).json({ error: 'Invalid answers payload' })

  const existing = getResult(examId, req.user.id)
  if (existing) return res.status(409).json({ error: 'Exam already submitted' })

  let score = 0
  let total = 0
  let counted = []
  ;({ score, total, counted } = gradeExam(exam, answers))
  const result = {
    examId,
    studentId: req.user.id,
    answers,
    score,
    total,
    marked: Number(marked) || 0,
    tabLeaves: Number(tabLeaves) || 0,
  }
  saveResult(result)

  const review = buildExamReview(exam, answers, counted)
  res.status(201).json({ score, total, marked: result.marked, review })
}))

studentRouter.get('/my/results/:examId', mustBeStudent, wrap(async (req, res) => {
  const examId = Number(req.params.examId)
  const result = getResult(examId, req.user.id)
  if (!result) return res.status(404).json({ error: 'No result found' })
  const exam = getExam(examId)
  const storedAnswers = result.answers ? JSON.parse(result.answers) : {}
  // Re-derive what counted so an old result still reads correctly against a
  // paper that now carries an optional section.
  const { counted } = gradeExam(exam, storedAnswers)
  const review = buildExamReview(exam, storedAnswers, counted)
  res.json({ title: exam.title, subject: exam.subject, score: result.score, total: result.total, marked: result.marked, tabLeaves: result.tab_leaves, submittedAt: result.submitted_at, review })
}))

app.use('/api', authRouter)
app.use('/api', teacherRouter)
app.use('/api', studentRouter)

app.get('/api/health', (req, res) => res.json({ status: 'ok', t: Date.now() }))

// ── Serve the built frontend (single process, one port) ──
const distDir = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
  console.log('   Serving UI from dist/')
} else {
  console.log('   (No dist/ build found — frontend not served. Run: npm run build)')
}

// ── Global error handler ──
// Registered after every route. The full error is logged server-side; the
// client only ever sees a generic message, so SQL text, file paths and provider
// responses can never leak through an unexpected 500.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err?.stack || err)
  if (res.headersSent) return next(err)
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message })
})

// Unmatched API paths get JSON, not the SPA's index.html.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))

const server = app.listen(PORT, () => {
  console.log(`🤖 CBT AI Question Lab server → http://localhost:${PORT}`)
  const usable = getUsableModels(env)
  console.log(`   AI models ready: ${usable.length ? usable.map((m) => m.model).join(', ') : 'NONE (check keys)'}`)
})

/* Node hangs up on any request still waiting after requestTimeout — 5 minutes by
   default. Several AI routes are legitimately slower than that: /ai/figures
   budgets limit/4 × 90s, so drawing a 40-question paper's worth of diagrams runs
   for fifteen minutes, and /ai/generate loops up to twelve 75s rounds.

   The 5-minute default silently killed those requests. The connection closed
   with no response body, so the browser saw "Failed to fetch" and reported the
   backend as unreachable — which sent people looking for a server that was
   running perfectly. The route's own budgetMs is the real deadline and it is
   enforced where the work happens; this transport-level cap has no business
   being shorter than it.

   0 means no limit. The per-route budgets above are what actually bound the
   work, and each of them can already return without answering. */
server.requestTimeout = 0
server.headersTimeout = 0
// Without this, a client that takes its socket idle for >5s between packets also
// gets dropped, which a long provider wait can trigger.
server.keepAliveTimeout = 72_000

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE' && process.argv.includes('--dev')) {
    console.warn(`   API already running on port ${PORT}; reusing the existing server.`)
    server.close()
    return
  }
  throw err
})

export default app