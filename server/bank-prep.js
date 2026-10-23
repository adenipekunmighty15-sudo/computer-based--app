// Background bank preparation queue.
//
// One bank at a time (CONCURRENCY = 1): this is deliberately not jobs.js,
// which is capped at 4 jobs per teacher and evicts the oldest when a teacher
// starts a fifth. A teacher who picks up eight subjects would silently lose
// five of them there. This queue runs them all in order.
//
// The work itself is injected, so the queue knows nothing about models or the
// database — index.js owns the AI helpers and hands over a `generateTask` that
// generates, inserts and audits one subject's questions. Keeping the AI code in
// index.js also avoids an import cycle.

const BANK_TARGET = 20
const CONCURRENCY = 1

const queue = []
const attempted = new Set()
let running = 0
let generateTask = null

function key({ userId, subject, level } = {}) {
  return `${userId}::${level || ''}::${subject || ''}`
}

export function setBankGenerateTask(fn) {
  generateTask = fn
}

// Add subjects to prepare. Already-attempted ones are skipped so a second save
// (or a refresh raking the queue) never rebuilds a subject that is mid-way or
// finished. Returns how many tasks were newly queued.
export function enqueueBankPrep(tasks) {
  let added = 0
  for (const task of tasks) {
    const k = key(task)
    if (attempted.has(k)) continue
    queue.push({ key: k, ...task })
    attempted.add(k)
    added += 1
  }
  pump()
  return added
}

export function isBankQueued(task) {
  return attempted.has(key(task))
}

// Forget a finished, failed or budget-skipped subject so its status can fall
// back to "pending" and a later read can re-queue it.
export function forgetBankPrep(task) {
  attempted.delete(key(task))
}

export function bankQueueSize() {
  return queue.length + running
}

export function bankTarget() {
  return BANK_TARGET
}

// Forget every queued and running task. Used by the test suite between cases,
// where the in-process queue would otherwise leak state across assertions.
export function resetBankPrep() {
  queue.length = 0
  attempted.clear()
  running = 0
}

function pump() {
  while (running < CONCURRENCY && queue.length > 0) {
    const task = queue.shift()
    running += 1
    const t0 = Date.now()
    void (async () => {
      try {
        if (!generateTask) {
          console.warn('[bank-prep] skipped: no generate task configured')
          return
        }
        await generateTask(task)
        console.log(`[bank-prep] ${task.subject} (${task.level}) ready in ${Math.round((Date.now() - t0) / 1000)}s`)
      } catch (err) {
        console.warn(`[bank-prep] ${task.subject} (${task.level}) failed:`, err?.message || err)
      } finally {
        running -= 1
        forgetBankPrep(task)
        pump()
      }
    })()
  }
}