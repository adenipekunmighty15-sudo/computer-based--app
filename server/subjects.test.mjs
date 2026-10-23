import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

// db.js opens its database at import time, reading CBT_DB from the environment,
// so the temp path must be in place *before* the module is imported. A dynamic
// import in beforeAll is the only way to sequence that. Each test file runs in
// its own worker, so this env var does not leak into the other suites.
const tmpDb = path.join(os.tmpdir(), `cbt-subjects-${crypto.randomUUID()}.db`)
process.env.CBT_DB = tmpDb

let db

const plain = (rows) => rows.map((r) => ({ subject: r.subject, level: r.level }))

beforeAll(async () => {
  db = await import('./db.js')
})

afterAll(() => {
  try {
    db?.db.close()
  } catch {
    // already closed
  }
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) fs.rmSync(f, { force: true })
})

describe('teacher subjects', () => {
  it('replaces the whole list on each save, ordered by level then subject', () => {
    db.replaceTeacherSubjects(1, [
      { subject: 'Physics', level: 'SSS' },
      { subject: 'Mathematics', level: 'JSS' },
    ])
    expect(plain(db.getTeacherSubjects(1))).toEqual([
      { subject: 'Mathematics', level: 'JSS' },
      { subject: 'Physics', level: 'SSS' },
    ])

    db.replaceTeacherSubjects(1, [{ subject: 'English', level: 'SSS' }])
    expect(plain(db.getTeacherSubjects(1))).toEqual([{ subject: 'English', level: 'SSS' }])
  })

  it('is all-or-nothing: a rejected row leaves the previous list intact', () => {
    db.replaceTeacherSubjects(2, [{ subject: 'Physics', level: 'SSS' }])

    expect(() =>
      db.replaceTeacherSubjects(2, [
        { subject: 'Biology', level: 'SSS' },
        // 'University' violates the level CHECK constraint.
        { subject: 'Chemistry', level: 'University' },
      ]),
    ).toThrow()

    expect(plain(db.getTeacherSubjects(2))).toEqual([{ subject: 'Physics', level: 'SSS' }])
  })

  it('keeps each teacher’s subjects separate', () => {
    db.replaceTeacherSubjects(10, [{ subject: 'Biology', level: 'SSS' }])
    db.replaceTeacherSubjects(11, [{ subject: 'Biology', level: 'JSS' }])

    expect(plain(db.getTeacherSubjects(10))).toEqual([{ subject: 'Biology', level: 'SSS' }])
    expect(plain(db.getTeacherSubjects(11))).toEqual([{ subject: 'Biology', level: 'JSS' }])
  })
})

describe('bank counts', () => {
  it('groups questions by subject and level, ignoring untagged rows', () => {
    db.insertQuestionsBulk(
      [
        { prompt: 'm-jss-1', options: ['a', 'b'], answer: 'a', subject: 'Mathematics', class_level: 'JSS' },
        { prompt: 'm-jss-2', options: ['a', 'b'], answer: 'a', subject: 'Mathematics', class_level: 'JSS' },
        { prompt: 'm-sss-1', options: ['a', 'b'], answer: 'a', subject: 'Mathematics', class_level: 'SSS' },
        { prompt: 'p-sss-1', options: ['a', 'b'], answer: 'a', subject: 'Physics', class_level: 'SSS' },
        // Hand-typed question: no class_level, must not count towards a bank.
        { prompt: 'untagged', options: ['a', 'b'], answer: 'a', subject: 'Mathematics' },
      ],
      3,
    )

    const counts = Object.fromEntries(db.bankCounts(3).map((r) => [`${r.level}::${r.subject}`, r.n]))
    expect(counts['JSS::Mathematics']).toBe(2)
    expect(counts['SSS::Mathematics']).toBe(1)
    expect(counts['SSS::Physics']).toBe(1)
    expect(db.bankCounts(3)).toHaveLength(3)
  })

  it('never reports another teacher’s bank', () => {
    expect(db.bankCounts(999)).toEqual([])
  })
})

describe('class_level round-trip', () => {
  it('persists through insertQuestionsBulk and comes back on the row', () => {
    const [saved] = db.insertQuestionsBulk(
      [{ prompt: 'round-trip', options: ['a', 'b', 'c', 'd'], answer: 'b', subject: 'Chemistry', class_level: 'SSS' }],
      4,
    )
    expect(saved.class_level).toBe('SSS')
    expect(db.getQuestion(saved.id).class_level).toBe('SSS')
  })

  it('stores null for hand-typed questions that carry no level', () => {
    const [saved] = db.insertQuestionsBulk(
      [{ prompt: 'no-level', options: ['a', 'b'], answer: 'a', subject: 'Commerce' }],
      4,
    )
    expect(saved.class_level).toBeNull()
  })
})
