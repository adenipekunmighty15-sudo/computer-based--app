import crypto from 'crypto'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { CHAT_MODELS, callWithFailover, parseQuestions } from '../config/ai.js'

dotenv.config({ path: 'server/.env' })

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to run the queue worker')
}

const supabase = createClient(supabaseUrl, serviceRoleKey)
const workerId = `worker-${process.pid}-${crypto.randomBytes(3).toString('hex')}`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const systemPrompt = 'You are a Nigerian secondary-school CBT question writer. Return only a JSON array of distinct MCQs with exactly four options, a correct answer letter, topic, and short explanation.'

async function processJob(job) {
  const result = await callWithFailover(process.env, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Generate exactly ${job.job_count} ${job.job_type} questions for ${job.job_subject}, topic ${job.job_topic || 'General'}, class ${job.job_class_level}, difficulty ${job.job_difficulty}.` },
  ], { temperature: 0.5, maxTokens: Math.min(8000, 260 * job.job_count + 800), timeoutMs: 60000 })
  const questions = parseQuestions(result?.text)
  if (!questions.length) throw new Error('AI returned no valid questions')
  return { success: true, requested: job.job_count, count: questions.length, model: result?.model?.model || null, questions }
}

async function claim() {
  const { data, error } = await supabase.rpc('claim_next_job', { p_worker_id: workerId })
  if (error) throw error
  return data?.[0] || null
}

async function runWorker() {
  console.log(`[STARTED] ${workerId} listening for generation jobs`)
  while (true) {
    try {
      const job = await claim()
      if (!job) { await sleep(3000); continue }
      console.log(`[${workerId}] claimed ${job.job_id}: ${job.job_subject} -> ${job.job_topic}`)
      try {
        const result = await processJob(job)
        const { error } = await supabase.rpc('complete_job', { p_job_id: job.job_id, p_worker_id: workerId, p_result: result })
        if (error) throw error
        console.log(`[${workerId}] completed ${job.job_id}`)
      } catch (error) {
        console.error(`[${workerId}] failed ${job.job_id}:`, error.message)
        await supabase.rpc('fail_job', { p_job_id: job.job_id, p_worker_id: workerId, p_error: error.message })
      }
    } catch (error) {
      console.error(`[${workerId}] queue error:`, error.message)
      await sleep(5000)
    }
  }
}

runWorker().catch((error) => { console.error(error); process.exitCode = 1 })
