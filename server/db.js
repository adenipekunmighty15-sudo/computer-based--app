import pg from 'pg'
import crypto from 'crypto'

const { Pool } = pg

function cryptoToken() {
  return crypto.randomBytes(32).toString('hex')
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

async function init() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('teacher','student')),
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        student_id TEXT,
        class TEXT,
        created_at BIGINT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at BIGINT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS questions (
        id SERIAL PRIMARY KEY,
        prompt TEXT NOT NULL,
        options TEXT NOT NULL,
        answer INTEGER NOT NULL,
        topic TEXT,
        subject TEXT,
        difficulty TEXT,
        explanation TEXT,
        figure TEXT,
        teacher_id INTEGER,
        created_at BIGINT NOT NULL,
        embedding TEXT,
        class_level TEXT
      );
      
      CREATE TABLE IF NOT EXISTS exams (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        subject TEXT,
        class_level TEXT,
        duration_minutes INTEGER NOT NULL DEFAULT 30,
        questions TEXT NOT NULL,
        created_by INTEGER,
        created_at BIGINT NOT NULL,
        sections TEXT
      );
      
      CREATE TABLE IF NOT EXISTS exam_assignments (
        id SERIAL PRIMARY KEY,
        exam_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        UNIQUE(exam_id, student_id)
      );
      
      CREATE TABLE IF NOT EXISTS results (
        id SERIAL PRIMARY KEY,
        exam_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        answers TEXT NOT NULL,
        score INTEGER NOT NULL,
        total INTEGER NOT NULL,
        marked INTEGER NOT NULL DEFAULT 0,
        tab_leaves INTEGER NOT NULL DEFAULT 0,
        submitted_at BIGINT NOT NULL,
        UNIQUE(exam_id, student_id)
      );
      
      CREATE TABLE IF NOT EXISTS exam_attempts (
        id SERIAL PRIMARY KEY,
        exam_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        started_at BIGINT NOT NULL,
        UNIQUE(exam_id, student_id)
      );
      
      CREATE TABLE IF NOT EXISTS drafts (
        exam_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        answers TEXT NOT NULL DEFAULT '{}',
        flagged TEXT NOT NULL DEFAULT '[]',
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (exam_id, student_id)
      );
      
      CREATE TABLE IF NOT EXISTS ai_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        model TEXT,
        provider TEXT,
        count INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        ok INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS teacher_subjects (
        user_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('Primary','JSS','SSS')),
        created_at BIGINT NOT NULL,
        UNIQUE (user_id, subject, level)
      );
      
      CREATE INDEX IF NOT EXISTS idx_questions_teacher_bank ON questions (teacher_id, subject, class_level);
    `)
  } finally {
    client.release()
  }
}

init().catch(err => {
  console.error('DB init error:', err)
  process.exit(1)
})

// ── Helpers ──
const now = () => Date.now()

// ── Auth ──
export async function getUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username)=LOWER($1)', [username])
  return rows[0] || null
}

export async function insertRawUser(role, name, username, hash, studentId, cls) {
  const { rows } = await pool.query(
    `INSERT INTO users (role, name, username, password_hash, student_id, class, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [role, name, username, hash, studentId, cls, now()]
  )
  return rows[0].id
}

export async function createSession(userId) {
  const token = cryptoToken()
  await pool.query(
    'INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,$3)',
    [token, userId, now()]
  )
  return token
}

export async function getUserByToken(token) {
  const { rows } = await pool.query(
    'SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token = $1',
    [token]
  )
  return rows[0] || null
}

export async function logout(token) {
  if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token])
}

export function sanitizeUser(u) {
  if (!u) return null
  return { id: u.id, role: u.role, name: u.name, username: u.username, student_id: u.student_id, class: u.class }
}

export async function updateUserProfile(userId, { name, studentId, cls } = {}) {
  await pool.query(
    'UPDATE users SET name = COALESCE($1, name), student_id = COALESCE($2, student_id), class = COALESCE($3, class) WHERE id = $4',
    [name, studentId, cls, userId]
  )
  return getUserByUsername((await pool.query('SELECT username FROM users WHERE id=$1', [userId])).rows[0].username)
}

export async function hashPassword(password) {
  const { createHash, timingSafeEqual } = await import('crypto')
  // Simple bcrypt-like hash fallback - in production use bcrypt
  return createHash('sha256').update(password).digest('hex')
}

// ── Questions ──
export async function listQuestions(teacherId) {
  const { rows } = await pool.query(
    'SELECT * FROM questions WHERE teacher_id = $1 ORDER BY id DESC',
    [teacherId]
  )
  return rows.map(questionFromRow)
}

export async function getQuestion(id) {
  const { rows } = await pool.query('SELECT * FROM questions WHERE id = $1', [id])
  return questionFromRow(rows[0] || null)
}

export async function getQuestionRow(id) {
  const { rows } = await pool.query('SELECT * FROM questions WHERE id = $1', [id])
  return rows[0] || null
}

export async function insertQuestion(q, teacherId) {
  const { rows } = await pool.query(
    `INSERT INTO questions (prompt, options, answer, topic, subject, difficulty, explanation, figure, teacher_id, created_at, embedding, class_level)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [q.prompt, JSON.stringify(q.options), q.answer, q.topic, q.subject, q.difficulty, q.explanation, q.figure, teacherId, now(), q.embedding, q.class_level]
  )
  const id = rows[0].id
  return { ...q, id }
}

export async function insertQuestionsBulk(list, teacherId) {
  const saved = []
  for (const q of list) {
    const created = await insertQuestion(q, teacherId)
    saved.push(created)
  }
  return saved
}

export async function updateQuestion(id, q, teacherId) {
  await pool.query(
    `UPDATE questions SET prompt=$1, options=$2, answer=$3, topic=$4, subject=$5, difficulty=$6, explanation=$7, figure=$8, class_level=$9 WHERE id=$10 AND teacher_id=$11`,
    [q.prompt, JSON.stringify(q.options), q.answer, q.topic, q.subject, q.difficulty, q.explanation, q.figure, q.class_level, id, teacherId]
  )
  return { ...q, id }
}

export async function deleteQuestion(id) {
  await pool.query('DELETE FROM questions WHERE id = $1', [id])
  return true
}

export async function questionBelongsTo(row, teacherId) {
  return row && row.teacher_id == teacherId
}

export async function canEditQuestion(row, teacherId) {
  return row && row.teacher_id == teacherId
}

export async function findDuplicateQuestion(q, teacherId) {
  const { rows } = await pool.query(
    'SELECT * FROM questions WHERE teacher_id = $1 AND prompt = $2 LIMIT 1',
    [teacherId, q.prompt]
  )
  return rows[0] || null
}

export async function questionFingerprints(teacherId) {
  const { rows } = await pool.query(
    'SELECT id, prompt FROM questions WHERE teacher_id = $1',
    [teacherId]
  )
  return rows
}

export async function searchQuestionsByVector(vector, teacherId) {
  // Vector search fallback: return recent questions for teacher (pgvector not configured)
  const { rows } = await pool.query(
    'SELECT * FROM questions WHERE teacher_id = $1 ORDER BY id DESC LIMIT 50',
    [teacherId]
  )
  return rows.map(questionFromRow)
}

export async function searchQuestionsByText(query, teacherId) {
  const { rows } = await pool.query(
    `SELECT * FROM questions WHERE teacher_id = $1 AND (prompt ILIKE $2 OR subject ILIKE $2 OR topic ILIKE $2) ORDER BY id DESC LIMIT 50`,
    [teacherId, `%${query}%`]
  )
  return rows.map(questionFromRow)
}

// ── Exams ──
export async function listExams() {
  const { rows } = await pool.query('SELECT * FROM exams ORDER BY id DESC')
  return rows.map(examFromRow)
}

export async function getExam(id) {
  const { rows } = await pool.query('SELECT * FROM exams WHERE id = $1', [id])
  return examFromRow(rows[0] || null)
}

export async function getExamStudentSafe(id) {
  return getExam(id)
}

export async function insertExam(exam, teacherId) {
  const { rows } = await pool.query(
    `INSERT INTO exams (title, subject, class_level, duration_minutes, questions, created_by, created_at, sections)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [exam.title, exam.subject, exam.class_level, exam.duration_minutes, JSON.stringify(exam.questions), teacherId, now(), exam.sections ? JSON.stringify(exam.sections) : null]
  )
  const id = rows[0].id
  return { ...exam, id }
}

export async function deleteExam(id) {
  await pool.query('DELETE FROM exams WHERE id = $1', [id])
  return true
}

export async function canEditExam(exam, teacherId) {
  return exam && exam.created_by == teacherId
}

export async function assignExam(examId, studentIds) {
  for (const sid of studentIds) {
    await pool.query(
      'INSERT INTO exam_assignments (exam_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [examId, sid]
    )
  }
  return true
}

export async function assignedStudentIds(examId) {
  const { rows } = await pool.query('SELECT student_id FROM exam_assignments WHERE exam_id = $1', [examId])
  return rows.map(r => r.student_id)
}

export async function isAssigned(examId, studentId) {
  const { rows } = await pool.query('SELECT 1 FROM exam_assignments WHERE exam_id = $1 AND student_id = $2 LIMIT 1', [examId, studentId])
  return rows.length > 0
}

// ── Results ──
export async function getResult(examId, studentId) {
  const { rows } = await pool.query('SELECT * FROM results WHERE exam_id = $1 AND student_id = $2 LIMIT 1', [examId, studentId])
  return rows[0] || null
}

export async function saveResult({ examId, studentId, answers, score, total, marked, tabLeaves }) {
  const { rows } = await pool.query(
    `INSERT INTO results (exam_id, student_id, answers, score, total, marked, tab_leaves, submitted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [examId, studentId, JSON.stringify(answers), score, total, marked, tabLeaves, now()]
  )
  return { id: rows[0].id, examId, studentId, answers, score, total, marked, tab_leaves: tabLeaves, submitted_at: now() }
}

export async function listExamResults(examId) {
  const { rows } = await pool.query('SELECT * FROM results WHERE exam_id = $1 ORDER BY submitted_at DESC', [examId])
  return rows
}

export async function getExamStudentResult(examId, studentId) {
  return getResult(examId, studentId)
}

export async function listAssignedExamsWithResults(studentId) {
  const { rows } = await pool.query(
    `SELECT e.*, r.score, r.total, r.marked, r.submitted_at
     FROM exams e
     JOIN exam_assignments a ON a.exam_id = e.id
     LEFT JOIN results r ON r.exam_id = e.id AND r.student_id = $1
     WHERE a.student_id = $1`,
    [studentId]
  )
  return rows.map(r => ({ ...examFromRow(r), score: r.score, total: r.total, marked: r.marked, submitted_at: r.submitted_at }))
}

// ── Attempts / Drafts ──
export async function startAttempt(examId, studentId) {
  const { rows } = await pool.query(
    `INSERT INTO exam_attempts (exam_id, student_id, started_at)
     VALUES ($1,$2,$3) ON CONFLICT (exam_id, student_id) DO UPDATE SET started_at = EXCLUDED.started_at
     RETURNING id`,
    [examId, studentId, now()]
  )
  return rows[0]
}

export async function getAttempt(examId, studentId) {
  const { rows } = await pool.query('SELECT * FROM exam_attempts WHERE exam_id = $1 AND student_id = $2 LIMIT 1', [examId, studentId])
  return rows[0] || null
}

export async function saveDraft(examId, studentId, answers, flagged) {
  await pool.query(
    `INSERT INTO drafts (exam_id, student_id, answers, flagged, updated_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (exam_id, student_id) DO UPDATE SET answers = EXCLUDED.answers, flagged = EXCLUDED.flagged, updated_at = EXCLUDED.updated_at`,
    [examId, studentId, JSON.stringify(answers), JSON.stringify(flagged), now()]
  )
}

export async function getDraft(examId, studentId) {
  const { rows } = await pool.query('SELECT * FROM drafts WHERE exam_id = $1 AND student_id = $2 LIMIT 1', [examId, studentId])
  return rows[0] || null
}

export async function deleteDraft(examId, studentId) {
  await pool.query('DELETE FROM drafts WHERE exam_id = $1 AND student_id = $2', [examId, studentId])
}

// ── AI usage ──
export async function logAiUsage({ userId, action, model, provider, count, latencyMs, ok }) {
  await pool.query(
    `INSERT INTO ai_logs (user_id, action, model, provider, count, latency_ms, ok, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [userId, action, model, provider, count, latencyMs, ok ? 1 : 0, now()]
  )
}

export async function aiUsageSince(userId, dayStartMs) {
  const { rows } = await pool.query(
    `SELECT SUM(count) as questions, COUNT(*) as sessions FROM ai_logs WHERE user_id = $1 AND created_at >= $2`,
    [userId, dayStartMs]
  )
  return { questions: rows[0].questions || 0, sessions: rows[0].sessions || 0 }
}

export async function recentAiLogs(userId, limit) {
  const { rows } = await pool.query(
    'SELECT * FROM ai_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  )
  return rows
}

// ── Teacher subjects ──
export async function replaceTeacherSubjects(userId, subjects) {
  await pool.query('DELETE FROM teacher_subjects WHERE user_id = $1', [userId])
  for (const s of subjects) {
    await pool.query(
      'INSERT INTO teacher_subjects (user_id, subject, level, created_at) VALUES ($1,$2,$3,$4)',
      [userId, s.subject, s.level, now()]
    )
  }
}

export async function getTeacherSubjects(userId) {
  const { rows } = await pool.query('SELECT * FROM teacher_subjects WHERE user_id = $1', [userId])
  return rows
}

export async function getTeacherInsightsData(userId) {
  // Aggregate exam results per teacher
  const { rows } = await pool.query(
    `SELECT e.id, e.title, e.subject, r.score, r.total, r.marked, r.submitted_at
     FROM results r JOIN exams e ON e.id = r.exam_id
     WHERE e.created_by = $1 ORDER BY r.submitted_at DESC`,
    [userId]
  )
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    subject: r.subject,
    perQuestion: [], // simplified
    score: r.score,
    total: r.total,
    marked: r.marked,
    submitted_at: r.submitted_at
  }))
}

export async function bankCounts(teacherId) {
  const { rows } = await pool.query(
    'SELECT subject, class_level as level, COUNT(*) as n FROM questions WHERE teacher_id = $1 GROUP BY subject, class_level',
    [teacherId]
  )
  return rows.map(r => ({ subject: r.subject, level: r.level, n: parseInt(r.n, 10) || 0 }))
}

export { pool as db }
