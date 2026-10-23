import { describe, expect, it } from 'vitest'
import {
  examMaxScore,
  examSectionRanges,
  gradeExam,
  isManualQuestion,
} from './scoring.js'

const mcq = (answer) => ({ prompt: 'pick one', options: ['a', 'b', 'c'], qtype: 'multiple-choice', answer })
const essay = (extra = {}) => ({ prompt: 'write a paragraph', options: [], answer: 0, qtype: 'essay', ...extra })

describe('examSectionRanges', () => {
  it('maps stored sections to absolute index ranges and normalises type', () => {
    const exam = {
      questions: [mcq(0), mcq(0), essay()],
      sections: [
        { title: 'SECTION A', kind: 'compulsory', count: 2, type: 'multiple-choice' },
        { title: 'SECTION B', kind: 'compulsory', count: 1, type: 'essay' },
      ],
    }
    const ranges = examSectionRanges(exam)
    expect(ranges).toHaveLength(2)
    expect(ranges[0]).toMatchObject({ title: 'SECTION A', kind: 'compulsory', start: 0, end: 2, type: 'multiple-choice' })
    expect(ranges[1]).toMatchObject({ title: 'SECTION B', start: 2, end: 3, type: 'theory' })
  })

  it('falls back to a single compulsory run for unsectioned exams', () => {
    const ranges = examSectionRanges({ questions: [mcq(0)] })
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toMatchObject({ title: 'SECTION A', kind: 'compulsory', start: 0, end: 1, type: 'multiple-choice' })
  })
})

describe('isManualQuestion', () => {
  it('flags a question whose section is theory, even without a qtype', () => {
    const exam = {
      questions: [mcq(0), essay()],
      sections: [{ title: 'SECTION A', kind: 'compulsory', count: 1, type: 'multiple-choice' }, { title: 'SECTION B', kind: 'compulsory', count: 1, type: 'theory' }],
    }
    expect(isManualQuestion(exam, 0)).toBe(false)
    expect(isManualQuestion(exam, 1)).toBe(true)
  })

  it('flags a question with an essay qtype even inside an objective section', () => {
    const exam = { questions: [mcq(0), essay()], sections: [{ title: 'SECTION A', kind: 'compulsory', count: 2, type: 'multiple-choice' }] }
    expect(isManualQuestion(exam, 0)).toBe(false)
    expect(isManualQuestion(exam, 1)).toBe(true)
  })
})

describe('examMaxScore', () => {
  it('excludes theory/essay questions from the auto-marked total', () => {
    const exam = {
      questions: [mcq(0), mcq(0), essay(), essay()],
      sections: [
        { title: 'SECTION A', kind: 'compulsory', count: 2, type: 'multiple-choice' },
        { title: 'SECTION B', kind: 'compulsory', count: 2, type: 'theory' },
      ],
    }
    expect(examMaxScore(exam)).toBe(2)
  })
})

describe('gradeExam', () => {
  it('scores objective questions, records essay answers, and reports the auto total', () => {
    const exam = {
      questions: [mcq(0), mcq(1), essay({ mark: 4, markingGuide: 'mention light' })],
      sections: [
        { title: 'SECTION A', kind: 'compulsory', count: 2, type: 'multiple-choice' },
        { title: 'SECTION B', kind: 'compulsory', count: 1, type: 'theory' },
      ],
    }
    const { score, total, counted } = gradeExam(exam, { 0: 0, 1: 0, 2: 'Algae capture light.' })
    expect(score).toBe(1)
    expect(total).toBe(2)
    expect(counted).toEqual([true, true, true])
  })

  it('treats an essay inside an objective section the same way', () => {
    const exam = { questions: [mcq(0), essay()], sections: [{ title: 'SECTION A', kind: 'compulsory', count: 2, type: 'multiple-choice' }] }
    const { score, total, counted } = gradeExam(exam, { 0: 0, 1: 'Answered with prose.' })
    expect(score).toBe(1)
    expect(total).toBe(1)
    expect(counted).toEqual([true, true])
  })

  it('only marks the first `answerAny` answered questions in an optional section', () => {
    const exam = {
      questions: [mcq(0), mcq(0), mcq(0), mcq(0)],
      sections: [
        { title: 'SECTION A', kind: 'compulsory', count: 2, type: 'multiple-choice' },
        { title: 'SECTION B', kind: 'optional', answerAny: 1, count: 2, type: 'multiple-choice' },
      ],
    }
    const all = gradeExam(exam, { 0: 0, 1: 0, 2: 0, 3: 0 })
    expect(all.score).toBe(3)
    expect(all.total).toBe(3)
    expect(all.counted).toEqual([true, true, true, false])

    const partial = gradeExam(exam, { 0: 0, 2: 0 })
    expect(partial.score).toBe(2)
    expect(partial.counted).toEqual([true, false, true, false])
  })

  it('reports a total of zero when a paper is entirely theory', () => {
    const exam = {
      questions: [essay(), essay()],
      sections: [{ title: 'SECTION A', kind: 'compulsory', count: 2, type: 'theory' }],
    }
    const { score, total, counted } = gradeExam(exam, { 0: 'One', 1: 'Two' })
    expect(score).toBe(0)
    expect(total).toBe(0)
    expect(counted).toEqual([true, true])
  })
})