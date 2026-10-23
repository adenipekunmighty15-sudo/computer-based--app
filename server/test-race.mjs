import fs from 'fs'
import dotenv from 'dotenv'
import { callWithFailover } from './config/ai.js'

const fallback = 'C:/Users/mighty/Desktop/mcpherson-attendance/backend/.env'
const env = { ...process.env }
for (const p of ['C:/Users/mighty/Desktop/cbt app for t gold brighter tomorrow model school/server/.env.example', fallback]) {
  if (fs.existsSync(p)) Object.assign(env, dotenv.parse(fs.readFileSync(p, 'utf8')))
}

const sys = `You write exam multiple-choice questions. Return ONLY a JSON array, no extra text. Item shape: {"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"correct":"A","explanation":"short","topic":"...","difficulty":"easy"}`

const t0 = Date.now()
const result = await callWithFailover(env, [
  { role: 'system', content: sys },
  { role: 'user', content: 'Generate exactly 3 DIFFERENT questions on Fractions for SS3 Mathematics.' },
], { maxTokens: 1200, temperature: 0.5, timeoutMs: 60000 })

const ms = Date.now() - t0
if (result) {
  console.log(`Winner: ${result.model.model} in ${result.latencyMs}ms (total ${ms}ms) | questions: ${Array.isArray(result.json) ? result.json.length : 0}`)
} else {
  console.log('NO RESULT after', ms, 'ms')
}