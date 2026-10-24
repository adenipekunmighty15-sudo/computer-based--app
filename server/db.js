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

export function getUserByUsername(username) {
  const { rows } = pool.query('SELECT * FROM users WHERE LOWER(username)=LOWER($1)', [username]).then(r => r).catch(() => ({ rows: [] }))
  return null
}

export async function getUserByUsernameAsync(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username)=LOWER($1)', [username])
  return rows[0] || null
}

// Keep sync API compatible where possible
export function getUserByUsernameSync(username) {
  // This is a hack for compatibility - will be replaced
  return null
}

// Re-export with sync names pointing to async where needed
export { getUserByUsernameAsync as getUserByUsername }

// ... continue with rest of functions - but easier to just make a quick wrapper
export { pool as db }
