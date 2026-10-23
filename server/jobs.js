// Background generation jobs.
//
// The "Full bank (9000)" button used to hold one HTTP request open while the
// engines produced thousands of tokens. Vite's dev proxy, the browser and any
// upstream proxy all give up well before that finishes, so the teacher saw a
// network error after several minutes of waiting and the questions were lost.
// A job here returns immediately with an id; the client polls for progress.
//
// Jobs are in-memory and deliberately short-lived: this is a single-school
// deployment and a job that is never collected is dropped after JOB_TTL_MS.

import crypto from 'node:crypto'

const JOB_TTL_MS = 30 * 60 * 1000
const MAX_JOBS_PER_USER = 4

/** @type {Map<string, any>} */
const jobs = new Map()

// A finished job still holds every generated question in memory; two of those
// is plenty for one teacher, so the oldest is evicted as a new one starts.
function evictFor(userId) {
  const mine = [...jobs.values()].filter((j) => j.userId === userId)
  while (mine.length >= MAX_JOBS_PER_USER) {
    const oldest = mine.sort((a, b) => a.createdAt - b.createdAt)[0]
    jobs.delete(oldest.id)
    mine.splice(mine.indexOf(oldest), 1)
  }
}

export function createJob(userId, payload) {
  evictFor(userId)
  const id = `job_${crypto.randomBytes(8).toString('hex')}`
  const job = {
    id,
    userId,
    payload,
    status: 'running',
    requested: payload.count,
    done: 0,
    questions: [],
    engines: [],
    rounds: 0,
    error: null,
    note: null,
    createdAt: Date.now(),
    startedAt: Date.now(),
    finishedAt: null,
  }
  jobs.set(id, job)
  return job
}

export function getJob(id, userId) {
  const job = jobs.get(id)
  if (!job) return null
  // Jobs are per-teacher: a guessed id must not expose another user's output.
  if (job.userId !== userId) return null
  return job
}

export function updateJob(id, patch) {
  const job = jobs.get(id)
  if (!job) return null
  Object.assign(job, patch)
  return job
}

export function failJob(id, message) {
  return updateJob(id, { status: 'error', error: message, finishedAt: Date.now() })
}

export function finishJob(id, patch = {}) {
  return updateJob(id, { status: 'done', finishedAt: Date.now(), ...patch })
}

export function isRunning(id) {
  const job = jobs.get(id)
  return Boolean(job && job.status === 'running')
}

// The client polls every couple of seconds and can render each round as soon as
// it lands, so partial results are kept small and show up while the job is still running.
export function jobView(job, { withQuestions = true } = {}) {
  return {
    id: job.id,
    status: job.status,
    requested: job.requested,
    done: job.done,
    rounds: job.rounds,
    engines: job.engines.slice(-12),
    error: job.error,
    note: job.note,
    elapsedMs: (job.finishedAt || Date.now()) - job.startedAt,
    questions: withQuestions ? job.questions : undefined,
  }
}

export function sweepJobs() {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id)
  }
}

setInterval(sweepJobs, 5 * 60 * 1000).unref?.()
