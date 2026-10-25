import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: 'server/.env' })

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL in server/.env or your shell, e.g.')
  console.error('DATABASE_URL="postgresql://..." node push-schema.js')
  process.exit(1)
}

const { Pool } = pg
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } })

async function main() {
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
    console.log('✅ All tables pushed to Supabase')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('❌ Push failed:', err.message)
  process.exit(1)
})
