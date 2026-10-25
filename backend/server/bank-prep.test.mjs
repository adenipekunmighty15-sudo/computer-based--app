import { describe, expect, it, beforeEach } from 'vitest'
import { setBankGenerateTask, enqueueBankPrep, isBankQueued, forgetBankPrep, resetBankPrep, bankTarget, bankQueueSize } from './bank-prep.js'

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe('bank preparation queue', () => {
  beforeEach(() => {
    resetBankPrep()
    setBankGenerateTask(async () => {})
  })

  it('prepares 20 questions per subject', () => {
    expect(bankTarget()).toBe(20)
  })

  it('runs subjects one at a time, in queue order', async () => {
    const order = []
    let active = 0
    let maxActive = 0
    let release
    const hold = new Promise((resolve) => {
      release = resolve
    })
    setBankGenerateTask(async (task) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      order.push(task.subject)
      if (task.subject === 'Mathematics') await hold
      active -= 1
    })

    enqueueBankPrep([
      { userId: 1, subject: 'Mathematics', level: 'JSS' },
      { userId: 1, subject: 'English', level: 'SSS' },
    ])
    await settle()
    // The second subject cannot start while the first is held open.
    expect(order).toEqual(['Mathematics'])
    expect(maxActive).toBe(1)
    // English is still queued; Mathematics is running.
    expect(bankQueueSize()).toBe(2)

    release()
    await settle()
    expect(order).toEqual(['Mathematics', 'English'])
    expect(bankQueueSize()).toBe(0)
  })

  it('never enqueues the same subject twice', () => {
    setBankGenerateTask(async () => {})
    const added = enqueueBankPrep([
      { userId: 1, subject: 'Mathematics', level: 'SSS' },
      { userId: 1, subject: 'Mathematics', level: 'SSS' },
    ])
    expect(added).toBe(1)
    expect(isBankQueued({ userId: 1, subject: 'Mathematics', level: 'SSS' })).toBe(true)
  })

  it('distinguishes the same subject across phases and teachers', () => {
    setBankGenerateTask(async () => {})
    enqueueBankPrep([{ userId: 1, subject: 'Mathematics', level: 'Primary' }])
    expect(isBankQueued({ userId: 1, subject: 'Mathematics', level: 'Primary' })).toBe(true)
    expect(isBankQueued({ userId: 1, subject: 'Mathematics', level: 'SSS' })).toBe(false)
    expect(isBankQueued({ userId: 7, subject: 'Mathematics', level: 'Primary' })).toBe(false)
  })

  it('can forget a finished subject so a later read re-queues it', () => {
    setBankGenerateTask(async () => {})
    const task = { userId: 1, subject: 'Biology', level: 'SSS' }
    enqueueBankPrep([task])
    expect(isBankQueued(task)).toBe(true)
    forgetBankPrep(task)
    expect(isBankQueued(task)).toBe(false)
    expect(enqueueBankPrep([task])).toBe(1)
  })
})