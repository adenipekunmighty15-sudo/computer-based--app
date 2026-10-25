import { describe, expect, it } from 'vitest'
import { createJob, jobView, updateJob } from './jobs.js'

describe('background job progress', () => {
  it('exposes partial generated questions while the job is still running', () => {
    const job = createJob('teacher-1', { count: 3 })
    updateJob(job.id, {
      done: 2,
      questions: [
        { prompt: '1 + 1 = ?', options: ['1', '2', '3', '4'], answer: 1, subject: 'Mathematics', topic: 'Arithmetic' },
        { prompt: '2 + 2 = ?', options: ['2', '3', '4', '5'], answer: 2, subject: 'Mathematics', topic: 'Arithmetic' },
      ],
    })

    const view = jobView(job, { withQuestions: true })

    expect(view.status).toBe('running')
    expect(view.questions).toHaveLength(2)
    expect(view.questions[0].prompt).toBe('1 + 1 = ?')
    expect(view.done).toBe(2)
  })
})
