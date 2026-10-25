import { describe, expect, it } from 'vitest'
import { SUBJECT_CATALOGUE as SERVER_CATALOGUE, SCHOOL_LEVELS as SERVER_LEVELS } from '../../../backend/server/school-catalogue.js'
import { SUBJECT_CATALOGUE as CLIENT_CATALOGUE, SCHOOL_LEVELS as CLIENT_LEVELS } from './school'

/* The picker and the server's allow-list must name the same subjects: the
   client builds the UI, the server accepts selection into AI prompts. If they
   diverge, a subject a teacher can click gets rejected on save. */

describe('subject catalogue', () => {
  it('covers the three phases of the Nigerian school system', () => {
    expect(CLIENT_LEVELS).toEqual(['Primary', 'JSS', 'SSS'])
  })

  it('keeps the server allow-list identical to the client picker', () => {
    expect(SERVER_LEVELS).toEqual([...CLIENT_LEVELS])
    for (const level of CLIENT_LEVELS) {
      expect(SERVER_CATALOGUE[level]).toEqual([...CLIENT_CATALOGUE[level]])
    }
  })

  it('has no duplicate subject within a phase', () => {
    for (const level of CLIENT_LEVELS) {
      const list = CLIENT_CATALOGUE[level]
      expect(new Set(list).size).toBe(list.length)
    }
  })

  it('lists every phase with a non-empty set of subjects', () => {
    for (const level of CLIENT_LEVELS) {
      expect(CLIENT_CATALOGUE[level].length).toBeGreaterThan(0)
    }
  })
})