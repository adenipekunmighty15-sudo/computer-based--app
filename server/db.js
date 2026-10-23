import { DatabaseSync } from 'node:sqlite'
import crypto from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'

function cryptoToken() {
  return crypto.randomBytes(32).toString('hex')
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.CBT_DB || path.join(__dirname, 'cbt.db')

export const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL;')
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('teacher','student')),
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  student_id TEXT,
  class TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT NOT NULL,
  options TEXT NOT NULL,
  answer INTEGER NOT NULL,
  topic TEXT,
  subject TEXT,
  difficulty TEXT,
  explanation TEXT,
  figure TEXT,
  teacher_id INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subject TEXT,
  class_level TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  questions TEXT NOT NULL,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exam_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  UNIQUE(exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  answers TEXT NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  marked INTEGER NOT NULL DEFAULT 0,
  tab_leaves INTEGER NOT NULL DEFAULT 0,
  submitted_at INTEGER NOT NULL,
  UNIQUE(exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS exam_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  UNIQUE(exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS drafts (
  exam_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  answers TEXT NOT NULL DEFAULT '{}',
  flagged TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  count INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS teacher_subjects (
  user_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('Primary','JSS','SSS')),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, subject, level)
);
`)

// ── Lightweight migrations for databases created before a column existed ──
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}
ensureColumn('questions', 'figure', 'TEXT')
// Question vector for near-duplicate detection. NULL when no embedder was
// configured at save time; dedupe.js falls back to text similarity for those.
ensureColumn('questions', 'embedding', 'TEXT')
// The paper is stored as one continuous question list; `sections` only records
// how that list is split and marked (Section A compulsory, Section B optional).
ensureColumn('exams', 'sections', 'TEXT')
// Which phase of school a question belongs to (Primary / JSS / SSS). NULL on
// every row that predates teacher subject onboarding, and on every question a
// teacher types by hand - only bank preparation fills it in today.
ensureColumn('questions', 'class_level', 'TEXT')
// The status query behind "is my bank ready?" groups by teacher, subject and
// level - the first real index in this schema.
db.exec(`CREATE INDEX IF NOT EXISTS idx_questions_teacher_bank
         ON questions (teacher_id, subject, class_level)`)

// Keep only what grading needs: title, kind, how many questions, and — for an
// optional section — how many of them the candidate is allowed to choose.
function examSectionsSnapshot(sections, questionCount) {
  if (!Array.isArray(sections) || sections.length === 0) return null
  const out = []
  let used = 0
  for (const s of sections) {
    const count = Math.max(0, parseInt(s?.count, 10) || 0)
    if (count === 0) continue
    const kind = s.kind === 'optional' ? 'optional' : 'compulsory'
    out.push({
      title: s.title || `Section ${String.fromCharCode(65 + out.length)}`,
      kind,
      count,
      answerAny: kind === 'optional' ? Math.max(0, parseInt(s.answerAny, 10) || 0) : null,
      type: s.type || null,
    })
    used += count
    if (used >= questionCount) break
  }
  return out.length ? out : null
}

// ── Row → object helpers ──
export function questionFromRow(r) {
  if (!r) return null
  return {
    id: r.id,
    prompt: r.prompt,
    options: JSON.parse(r.options),
    answer: r.answer,
    topic: r.topic,
    subject: r.subject,
    class_level: r.class_level || null,
    difficulty: r.difficulty,
    explanation: r.explanation,
    figure: r.figure || null,
  }
}

export function examFromRow(r, { withAnswers = true } = {}) {
  if (!r) return null
  const questions = JSON.parse(r.questions)
  let sections = null
  try {
    sections = r.sections ? JSON.parse(r.sections) : null
  } catch {
    sections = null
  }
  return {
    id: r.id,
    title: r.title,
    subject: r.subject,
    class_level: r.class_level,
    duration_minutes: r.duration_minutes,
    created_by: r.created_by,
    created_at: r.created_at,
    sections,
    questions: withAnswers ? questions : questions.map((q) => {
      const { answer, explanation, ...rest } = q
      return rest
    }),
  }
}

export function sanitizeUser(u) {
  if (!u) return null
  return { id: u.id, role: u.role, name: u.name, username: u.username, student_id: u.student_id, class: u.class }
}

// ── Queries ──
export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null
}
export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null
}
// ── Sessions (HttpOnly-cookie backed, with absolute expiry) ──
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function deleteExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - SESSION_TTL_MS)
}

export function getUserByToken(token) {
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token)
  if (!s) return null
  if (s.created_at + SESSION_TTL_MS < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return null
  }
  return sanitizeUser(getUserById(s.user_id))
}
export function createSession(userId) {
  deleteExpiredSessions()
  const token = cryptoToken()
  const now = Date.now()
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, now)
  return token
}
export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function listStudents() {
  return db.prepare('SELECT * FROM users WHERE role = ? ORDER BY name').all('student').map(sanitizeUser)
}

/* Only the columns a person may change about themselves. Username and role are
   absent by design: the username is the login identity a school's register
   already knows, and the role is the whole security boundary. */
export function updateUserProfile(id, { name, studentId, cls }) {
  const current = getUserById(id)
  if (!current) return null
  const next = {
    name: (name ?? current.name).trim(),
    student_id: current.role === 'student' ? (studentId === undefined ? current.student_id : studentId || null) : current.student_id,
    class: current.role === 'student' ? (cls === undefined ? current.class : cls || null) : current.class,
  }
  db.prepare('UPDATE users SET name = ?, student_id = ?, class = ? WHERE id = ?')
    .run(next.name, next.student_id, next.class, id)
  return sanitizeUser(getUserById(id))
}

export function updateUserPassword(id, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id)
}

/* Called after a password change so a stolen cookie on a shared lab machine
   stops working. The device making the change keeps its token. */
export function deleteSessionsForUser(userId, keepToken = null) {
  if (keepToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(userId, keepToken)
    return
  }
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

// ── Questions bank ──
export function listQuestions(teacherId = null) {
  const rows = teacherId
    ? db.prepare('SELECT * FROM questions WHERE teacher_id = ? OR teacher_id IS NULL ORDER BY created_at DESC').all(teacherId)
    : db.prepare('SELECT * FROM questions ORDER BY created_at DESC').all()
  return rows.map(questionFromRow)
}
export function getQuestion(id) {
  return questionFromRow(db.prepare('SELECT * FROM questions WHERE id = ?').get(id))
}
// Raw row (includes teacher_id) so the routes can enforce ownership.
export function getQuestionRow(id) {
  return db.prepare('SELECT * FROM questions WHERE id = ?').get(id) || null
}
// A question may be edited by its owning teacher, or by any teacher when it is
// a shared/system question (teacher_id IS NULL) — editing adopts ownership.
export function canEditQuestion(row, teacherId) {
  return Boolean(row) && (row.teacher_id == null || row.teacher_id === teacherId)
}
export function questionBelongsTo(row, teacherId) {
  return Boolean(row) && row.teacher_id != null && row.teacher_id === teacherId
}
export function insertQuestion(q, teacherId) {
  const info = db.prepare(
    'INSERT INTO questions (prompt, options, answer, topic, subject, class_level, difficulty, explanation, figure, embedding, teacher_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    q.prompt,
    JSON.stringify(q.options),
    q.answer,
    q.topic || null,
    q.subject || null,
    q.class_level || null,
    q.difficulty || null,
    q.explanation || null,
    q.figure || null,
    q.embedding ? JSON.stringify(q.embedding) : null,
    teacherId,
    Date.now(),
  )
  return getQuestion(Number(info.lastInsertRowid))
}
export function updateQuestion(id, q, teacherId = null) {
  db.prepare(
    'UPDATE questions SET prompt = ?, options = ?, answer = ?, topic = ?, subject = ?, difficulty = ?, explanation = ?, figure = ?, embedding = COALESCE(?, embedding), teacher_id = COALESCE(?, teacher_id) WHERE id = ?',
  ).run(
    q.prompt,
    JSON.stringify(q.options),
    q.answer,
    q.topic || null,
    q.subject || null,
    q.difficulty || null,
    q.explanation || null,
    q.figure || null,
    q.embedding ? JSON.stringify(q.embedding) : null,
    teacherId,
    id,
  )
  return getQuestion(id)
}
export function deleteQuestion(id) {
  db.prepare('DELETE FROM questions WHERE id = ?').run(id)
}
export function findDuplicateQuestion(prompt, teacherId) {
  return db.prepare('SELECT id FROM questions WHERE prompt = ? AND (teacher_id = ? OR teacher_id IS NULL)').get(prompt, teacherId) || null
}

// ── Semantic Search ──

/**
 * Ranks questions by similarity to a query vector.
 * @param {number[]} vector - The query embedding.
 * @param {number} teacherId - Scope search to this teacher's bank.
 * @param {number} limit - Max results.
 */
export function searchQuestionsByVector(vector, teacherId, limit = 50) {
  const bank = questionFingerprints(teacherId)
  const { cosineSimilarity } = Object.assign({}, { cosineSimilarity: (a, b) => {
    if (!a || !b || a.length !== b.length) return 0
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      na += a[i] * a[i]
      nb += b[i] * b[i]
    }
    return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
  }})
  
  const results = bank
    .filter(r => Array.isArray(r.embedding))
    .map(r => ({
      id: r.id,
      similarity: cosineSimilarity(vector, r.embedding)
    }))
    .filter(r => r.similarity > 0.3) // Loose floor for relevance
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)

  if (!results.length) return []
  const ids = results.map(r => r.id)
  const place = ids.map(() => '?').join(',')
  const rows = db.prepare(`SELECT * FROM questions WHERE id IN (${place})`).all(...ids)
  
  // Restore rank order (SQLite IN doesn't guarantee it)
  const rowMap = new Map(rows.map(r => [r.id, r]))
  return results.map(r => questionFromRow(rowMap.get(r.id))).filter(Boolean)
}

/**
 * Simple keyword search fallback.
 */
export function searchQuestionsByText(query, teacherId, limit = 50) {
  const q = `%${query}%`
  const rows = db.prepare(`
    SELECT * FROM questions 
    WHERE (teacher_id = ? OR teacher_id IS NULL) 
    AND (prompt LIKE ? OR topic LIKE ? OR subject LIKE ?)
    ORDER BY created_at DESC LIMIT ?
  `).all(teacherId, q, q, q, limit)
  return rows.map(questionFromRow)
}

// Rows needed for a near-duplicate check: the text a human reads plus the
// vector, if one was stored. Restricted to what this teacher can see so a
// shared question still counts as a duplicate.
export function questionFingerprints(teacherId = null) {
  const rows = teacherId
    ? db.prepare('SELECT id, prompt, subject, topic, options, answer, embedding FROM questions WHERE teacher_id = ? OR teacher_id IS NULL').all(teacherId)
    : db.prepare('SELECT id, prompt, subject, topic, options, answer, embedding FROM questions').all()
  return rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    subject: r.subject,
    topic: r.topic,
    embedding: r.embedding ? JSON.parse(r.embedding) : null,
  }))
}

// One transaction for the whole batch: a 200-question "Save all" either lands
// completely or not at all, so a retry can never double-save the half that
// succeeded on a previous attempt.
export function insertQuestionsBulk(list, teacherId) {
  const stmt = db.prepare(
    'INSERT INTO questions (prompt, options, answer, topic, subject, class_level, difficulty, explanation, figure, embedding, teacher_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const now = Date.now()
  const ids = []
  db.exec('BEGIN')
  try {
    for (const q of list) {
      const info = stmt.run(
        q.prompt,
        JSON.stringify(q.options),
        q.answer,
        q.topic || null,
        q.subject || null,
        q.class_level || null,
        q.difficulty || null,
        q.explanation || null,
        q.figure || null,
        q.embedding ? JSON.stringify(q.embedding) : null,
        teacherId,
        now,
      )
      ids.push(Number(info.lastInsertRowid))
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return ids.map((id) => getQuestion(id))
}

// ── Exams ──
export function listExams(teacherId = null) {
  const rows = teacherId
    ? db.prepare('SELECT * FROM exams WHERE created_by = ? OR created_by IS NULL ORDER BY created_at DESC').all(teacherId)
    : db.prepare('SELECT * FROM exams ORDER BY created_at DESC').all()
  return rows.map((r) => examFromRow(r, { withAnswers: false }))
}
export function getExam(id) {
  return examFromRow(db.prepare('SELECT * FROM exams WHERE id = ?').get(id))
}
export function getExamStudentSafe(id) {
  return examFromRow(db.prepare('SELECT * FROM exams WHERE id = ?').get(id), { withAnswers: false })
}
// Exams are owned by their creator; shared/system exams (created_by NULL) are
// visible-read by everyone but mutable by nobody.
export function canEditExam(exam, teacherId) {
  return Boolean(exam) && exam.created_by != null && exam.created_by === teacherId
}
export function insertExam(exam, createdBy) {
  const snapshot = exam.questions.map((q) => ({
    qid: q.id || null,
    prompt: q.prompt,
    options: q.options,
    answer: q.answer,
    topic: q.topic || null,
    subject: q.subject || null,
    difficulty: q.difficulty || null,
    explanation: q.explanation || null,
    figure: q.figure || null,
    // Where a web-sourced figure came from (Wikimedia Commons/Openverse), so
    // the published paper keeps the licence and credit the licence requires.
    figureCredit: q.figureCredit || null,
    // Theory/essay questions carry these instead of options; without them the
    // published paper would lose the marks and marking guide the AI wrote.
    qtype: q.qtype || null,
    mark: q.mark || null,
    markingGuide: q.markingGuide || null,
  }))
  const sections = examSectionsSnapshot(exam.sections, snapshot.length)
  const info = db.prepare(
    'INSERT INTO exams (title, subject, class_level, duration_minutes, questions, sections, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(exam.title, exam.subject || null, exam.class_level || null, exam.duration_minutes || 30, JSON.stringify(snapshot), sections ? JSON.stringify(sections) : null, createdBy, Date.now())
  return getExam(Number(info.lastInsertRowid))
}
export function deleteExam(id) {
  db.prepare('DELETE FROM exams WHERE id = ?').run(id)
  db.prepare('DELETE FROM exam_assignments WHERE exam_id = ?').run(id)
  db.prepare('DELETE FROM results WHERE exam_id = ?').run(id)
}

export function assignExam(examId, studentIds) {
  const ins = db.prepare('INSERT OR IGNORE INTO exam_assignments (exam_id, student_id) VALUES (?, ?)')
  for (const sid of studentIds) ins.run(examId, sid)
}
export function assignedStudentIds(examId) {
  return db.prepare('SELECT student_id AS sid FROM exam_assignments WHERE exam_id = ?').all(examId).map((r) => r.sid)
}
export function isAssigned(examId, studentId) {
  return Boolean(db.prepare('SELECT id FROM exam_assignments WHERE exam_id = ? AND student_id = ?').get(examId, studentId))
}

// ── Exam attempts (server-trusted timing) ──
export function startAttempt(examId, studentId) {
  db.prepare('INSERT OR IGNORE INTO exam_attempts (exam_id, student_id, started_at) VALUES (?, ?, ?)').run(examId, studentId, Date.now())
  return db.prepare('SELECT * FROM exam_attempts WHERE exam_id = ? AND student_id = ?').get(examId, studentId)
}
export function getAttempt(examId, studentId) {
  return db.prepare('SELECT * FROM exam_attempts WHERE exam_id = ? AND student_id = ?').get(examId, studentId) || null
}

// ── Exam drafts (autosave/resume) ──
export function saveDraft(examId, studentId, { answers = {}, flagged = [] }) {
  db.prepare(
    'INSERT OR REPLACE INTO drafts (exam_id, student_id, answers, flagged, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(examId, studentId, JSON.stringify(answers), JSON.stringify(flagged), Date.now())
}
export function getDraft(examId, studentId) {
  const r = db.prepare('SELECT * FROM drafts WHERE exam_id = ? AND student_id = ?').get(examId, studentId)
  if (!r) return null
  return { answers: JSON.parse(r.answers || '{}'), flagged: JSON.parse(r.flagged || '[]'), updatedAt: r.updated_at }
}
export function deleteDraft(examId, studentId) {
  db.prepare('DELETE FROM drafts WHERE exam_id = ? AND student_id = ?').run(examId, studentId)
}

// ── AI usage audit log ──
export function logAiUsage({ userId, action, model = null, provider = null, count = 0, latencyMs = 0, ok = false }) {
  db.prepare(
    'INSERT INTO ai_logs (user_id, action, model, provider, count, latency_ms, ok, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(userId, action, model, provider, count || 0, latencyMs || 0, ok ? 1 : 0, Date.now())
}
export function aiUsageSince(userId, fromMs) {
  const row = db.prepare(
    'SELECT COUNT(*) AS requests, COALESCE(SUM(count), 0) AS questions FROM ai_logs WHERE user_id = ? AND created_at >= ?',
  ).get(userId, fromMs)
  return { requests: row.requests, questions: row.questions }
}
export function recentAiLogs(userId, limit = 30) {
  return db.prepare(
    'SELECT action, model, provider, count, latency_ms AS latencyMs, ok, created_at FROM ai_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
  ).all(userId, limit)
}

// ── Teacher subjects (bank preparation targets) ──
// Every save replaces the whole list in one transaction: the picker on the
// client submits what the teacher wants now, and whatever was removed stops
// being prepared immediately.
export function replaceTeacherSubjects(userId, subjects) {
  const now = Date.now()
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM teacher_subjects WHERE user_id = ?').run(userId)
    const ins = db.prepare('INSERT INTO teacher_subjects (user_id, subject, level, created_at) VALUES (?, ?, ?, ?)')
    for (const s of subjects) ins.run(userId, s.subject, s.level, now)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
export function getTeacherSubjects(userId) {
  return db.prepare('SELECT subject, level FROM teacher_subjects WHERE user_id = ? ORDER BY level, subject').all(userId)
}

// How many banked questions this teacher already has per (subject, level).
// NULL class_level (hand-typed questions) never counts — only questions tagged
// with a phase by preparation. Shared/system questions are excluded too, so a
// teacher never sees progress on questions they do not own.
export function bankCounts(userId) {
  return db.prepare(
    `SELECT subject, class_level AS level, COUNT(*) AS n
     FROM questions
     WHERE teacher_id = ? AND class_level IS NOT NULL
     GROUP BY subject, class_level`,
  ).all(userId)
}

// ── Teacher Insights ──

/**
 * Aggregates performance data across all exams created by a teacher.
 */
export function getTeacherInsightsData(teacherId) {
  const exams = db.prepare('SELECT id, title, subject, class_level FROM exams WHERE created_by = ?').all(teacherId)
  const stats = []

  for (const exam of exams) {
    const results = db.prepare('SELECT answers, score, total FROM results WHERE exam_id = ?').all(exam.id)
    if (!results.length) continue

    const questions = JSON.parse(db.prepare('SELECT questions FROM exams WHERE id = ?').get(exam.id).questions)
    
    const perQuestion = questions.map((q, idx) => {
      let total = 0
      let correct = 0
      for (const r of results) {
        const answers = JSON.parse(r.answers || '{}')
        if (answers[idx] !== undefined) {
          total += 1
          if (answers[idx] === q.answer) correct += 1
        }
      }
      return { 
        prompt: q.prompt, 
        topic: q.topic || 'General', 
        subject: q.subject || exam.subject,
        total, 
        correct,
        pct: total ? (correct / total) : 0
      }
    })

    stats.push({
      examId: exam.id,
      title: exam.title,
      subject: exam.subject,
      classLevel: exam.class_level,
      avgScore: results.reduce((a, b) => a + b.score, 0) / results.length,
      avgTotal: results.reduce((a, b) => a + b.total, 0) / results.length,
      resultsCount: results.length,
      perQuestion
    })
  }

  return stats
}

// ── Results ──
export function getResult(examId, studentId) {
  return db.prepare('SELECT * FROM results WHERE exam_id = ? AND student_id = ?').get(examId, studentId) || null
}
export function saveResult({ examId, studentId, answers, score, total, marked, tabLeaves }) {
  db.prepare(
    'INSERT OR REPLACE INTO results (exam_id, student_id, answers, score, total, marked, tab_leaves, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(examId, studentId, JSON.stringify(answers), score, total, marked, tabLeaves, Date.now())
}
export function listExamResults(examId) {
  return db.prepare(
    `SELECT r.*, u.name AS student_name, u.student_id AS student_code, u.class AS student_class
     FROM results r JOIN users u ON u.id = r.student_id
     WHERE r.exam_id = ? ORDER BY r.score DESC, r.submitted_at ASC`,
  ).all(examId)
}
export function getExamStudentResult(examId, studentId) {
  return db.prepare(
    `SELECT r.*, u.name AS student_name, u.student_id AS student_code, u.class AS student_class
     FROM results r JOIN users u ON u.id = r.student_id
     WHERE r.exam_id = ? AND r.student_id = ?`,
  ).get(examId, studentId) || null
}
export function listAssignedExamsWithResults(studentId) {
  return db.prepare(
    `SELECT e.id, e.title, e.subject, e.class_level, e.duration_minutes, e.created_at,
            r.score, r.total, r.submitted_at,
            (r.id IS NOT NULL) AS completed
     FROM exam_assignments a
     JOIN exams e ON e.id = a.exam_id
     LEFT JOIN results r ON r.exam_id = e.id AND r.student_id = a.student_id
     WHERE a.student_id = ? ORDER BY e.created_at DESC`,
  ).all(studentId)
}

// ── Seed demo accounts + practice exam (OPT-IN) ──
// Set CBT_AUTO_SEED=1 on first run to create demo teacher/student accounts.
// Default is off so production deployments never ship with known credentials.
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
if (userCount === 0 && process.env.CBT_AUTO_SEED === '1') {
  const scrypt = await import('node:crypto').then((m) => m.scrypt)
  const hashPw = async (password) => {
    const salt = crypto.randomBytes(16).toString('hex')
    const buf = await new Promise((resolve, reject) => scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key)))
    return `${salt}:${Buffer.from(buf).toString('hex')}`
  }
  const pw = await hashPw('teacher123')
  const teacher = insertRawUser('teacher', 'Mrs. D. Okafor', 'teacher', pw)
  const pw2 = await hashPw('student123')
  const student = insertRawUser('student', 'Aisha Bello', 'student', pw2, 'TGB-2026-0142', 'SS3')

  const seedQuestions = [
    { prompt: 'What is the value of 1/2 + 1/4?', options: ['1/8', '2/6', '3/4', '1/6'], answer: 2, topic: 'Fractions', subject: 'Mathematics', difficulty: 'easy', explanation: '1/2 = 2/4, so 2/4 + 1/4 = 3/4.' },
    { prompt: 'Which organ pumps blood around the body?', options: ['Lungs', 'Heart', 'Kidney', 'Stomach'], answer: 1, topic: 'Basic Science', subject: 'Basic Science', difficulty: 'easy', explanation: 'The heart is the pump of the circulatory system.' },
    { prompt: 'Choose the sentence with correct verb agreement.', options: ['The boys goes to school.', 'The boys go to school.', 'The boy go to school.', 'The boys going to school.'], answer: 1, topic: 'English Grammar', subject: 'English', difficulty: 'easy', explanation: 'Plural subject \u201cthe boys\u201d takes the plural verb \u201cgo.\u201d' },
    { prompt: 'Solve for x: 3x + 5 = 20.', options: ['3', '4', '5', '7'], answer: 2, topic: 'Algebra', subject: 'Mathematics', difficulty: 'medium', explanation: '3x = 15, so x = 5.' },
    { prompt: 'Which is a civic responsibility?', options: ['Keeping public property safe', 'Breaking traffic rules', 'Avoiding school work', 'Refusing to vote'], answer: 0, topic: 'Civic Education', subject: 'Civic Education', difficulty: 'easy', explanation: 'Looking after public property is a civic responsibility.' },
    { prompt: 'Which gas do green plants release during photosynthesis?', options: ['Carbon dioxide', 'Nitrogen', 'Oxygen', 'Hydrogen'], answer: 2, topic: 'Biology', subject: 'Basic Science', difficulty: 'easy', explanation: 'Plants release oxygen as a by-product of photosynthesis.' },
    { prompt: 'What is 15% of 200?', options: ['15', '20', '30', '45'], answer: 2, topic: 'Percentages', subject: 'Mathematics', difficulty: 'medium', explanation: '0.15 \u00d7 200 = 30.' },
    { prompt: 'The opposite of \u201cancient\u201d is:', options: ['Old', 'Modern', 'Historic', 'Early'], answer: 1, topic: 'Vocabulary', subject: 'English', difficulty: 'easy', explanation: 'Ancient means very old; modern is its opposite.' },
  ]
  const insQ = db.prepare('INSERT INTO questions (prompt, options, answer, topic, subject, difficulty, explanation, teacher_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const q of seedQuestions) {
    insQ.run(q.prompt, JSON.stringify(q.options), q.answer, q.topic, q.subject, q.difficulty, q.explanation, teacher, Date.now())
  }
  const exam = insertExam(
    { title: 'SS3 Mathematics Practice Assessment', subject: 'Mathematics', class_level: 'SS3', duration_minutes: 45, questions: seedQuestions.map((q, i) => ({ id: i + 1, ...q })) },
    teacher,
  )
  assignExam(exam.id, [student])
  console.log('   [seed] Created demo accounts: teacher/teacher123, student/student123 (CBT_AUTO_SEED=1)')
}

export function insertRawUser(role, name, username, passwordHash, studentId = null, cls = null) {
  const info = db.prepare('INSERT INTO users (role, name, username, password_hash, student_id, class, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(role, name, username, passwordHash, studentId, cls, Date.now())
  return Number(info.lastInsertRowid)
}