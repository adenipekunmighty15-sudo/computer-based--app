import { describe, expect, it } from 'vitest'
import {
  buildPaperSections,
  normaliseLegacySections,
  normaliseSectionType,
  sectionFormatGroups,
  sectionFormatLabel,
  sectionPrimaryType,
  theoryQType,
  toTheoryQuestions,
} from './ai.js'

describe('section type helpers', () => {
  it('normalises prose variants to a single theory type', () => {
    expect(normaliseSectionType('theory')).toBe('theory')
    expect(normaliseSectionType('essay')).toBe('theory')
    expect(normaliseSectionType('structured')).toBe('theory')
    expect(normaliseSectionType('multiple-choice')).toBe('multiple-choice')
    expect(normaliseSectionType('mcq')).toBe('multiple-choice')
    expect(normaliseSectionType()).toBe('multiple-choice')
  })

  it('labels generated theory questions essay vs theory by the section prompt', () => {
    expect(theoryQType('essay')).toBe('essay')
    expect(theoryQType('theory')).toBe('theory')
    expect(theoryQType('structured')).toBe('theory')
  })
})

describe('section format groups (the strict mix rule)', () => {
  it('turns one type into a single group covering the whole section', () => {
    const groups = sectionFormatGroups('essay', 6)
    expect(groups).toEqual([{ type: 'theory', qtype: 'essay', count: 6 }])
  })

  it('honours an exact mixed request: 5 multiple-choice + 1 essay', () => {
    const groups = sectionFormatGroups({ 'multiple-choice': 5, essay: 1 }, 6)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toEqual({ type: 'multiple-choice', qtype: 'multiple-choice', count: 5 })
    expect(groups[1]).toEqual({ type: 'theory', qtype: 'essay', count: 1 })
  })

  it('pads a mix that sums below the section count onto the dominant group', () => {
    const groups = sectionFormatGroups({ 'multiple-choice': 4, essay: 1 }, 6)
    expect(groups.reduce((a, g) => a + g.count, 0)).toBe(6)
    expect(groups.find((g) => g.type === 'multiple-choice').count).toBe(5)
  })

  it('trims a mix that overshoots so the paper is never over the agreed count', () => {
    const groups = sectionFormatGroups({ 'multiple-choice': 8, essay: 2 }, 6)
    expect(groups.reduce((a, g) => a + g.count, 0)).toBe(6)
    for (const g of groups) expect(g.count).toBeGreaterThan(0)
  })

  it('exposes the dominant primary type and a human label', () => {
    const groups = sectionFormatGroups({ 'multiple-choice': 5, essay: 1 }, 6)
    expect(sectionPrimaryType(groups)).toBe('multiple-choice')
    expect(sectionFormatLabel(groups)).toBe('5 multiple-choice + 1 essay')
    expect(sectionPrimaryType([{ type: 'theory', qtype: 'essay', count: 6 }])).toBe('theory')
    expect(sectionFormatLabel([{ type: 'theory', qtype: 'essay', count: 6 }])).toBe('6 essay')
  })
})

describe('buildPaperSections', () => {
  it('carries a per-section type from the blueprint (A theory, B essay)', () => {
    const sections = buildPaperSections(
      { compulsory: 2, optional: 3, answerAny: 1, sectionTypes: { A: 'theory', B: 'essay' } },
      'Biology',
    )
    expect(sections).toHaveLength(2)
    expect(sections[0]).toMatchObject({ key: 'A', kind: 'compulsory', count: 2, type: 'theory' })
    expect(sections[1]).toMatchObject({ key: 'B', kind: 'optional', answerAny: 1, count: 3, type: 'theory' })
  })

  it('builds a strict 5 MCQ + 1 essay mix inside Section A from sectionFormats', () => {
    const sections = buildPaperSections(
      { compulsory: 6, optional: 0, sectionFormats: { A: { 'multiple-choice': 5, essay: 1 } } },
      'Biology',
    )
    expect(sections).toHaveLength(1)
    expect(sections[0].type).toBe('multiple-choice')
    expect(sections[0].mix).toEqual([
      { type: 'multiple-choice', qtype: 'multiple-choice', count: 5 },
      { type: 'theory', qtype: 'essay', count: 1 },
    ])
  })

  it('falls back to the paper-wide default when a section has no override', () => {
    const sections = buildPaperSections({ compulsory: 2, optional: 3, answerAny: 1 }, 'Biology')
    expect(sections[0].type).toBe('multiple-choice')
    expect(sections[1].type).toBe('multiple-choice')
  })
})

describe('toTheoryQuestions', () => {
  it('parses prose questions with marks and a marking guide, dropping nothing optioned', () => {
    const raw = `{
      "questions": [
        { "question": "Explain photosynthesis in one paragraph", "mark": 4, "markingGuide": "mention carbon dioxide and light", "topic": "Nutrition" },
        { "question": "State two uses of water", "mark": "2", "guide": "any two of drinking, cleaning, farming" }
      ]
    }`
    const parsed = toTheoryQuestions(raw)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      prompt: 'Explain photosynthesis in one paragraph',
      options: [],
      answer: 0,
      qtype: 'theory',
      mark: 4,
      markingGuide: 'mention carbon dioxide and light',
    })
    expect(parsed[1].markingGuide).toBe('any two of drinking, cleaning, farming')
  })

  it('keeps the essay label when the model says so, and clamps excessive marks', () => {
    const parsed = toTheoryQuestions(`[ { "question": "Write an essay on democracy", "qtype": "essay", "mark": 50 } ]`)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].qtype).toBe('essay')
    expect(parsed[0].mark).toBe(25)
  })

  it('drops blank prompts and exposes the guide via explanation', () => {
    const parsed = toTheoryQuestions(`{ "questions": [ { "question": "" }, { "question": "A real question", "explanation": "guide here" } ] }`)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].prompt).toBe('A real question')
    expect(parsed[0].markingGuide).toBe('guide here')
  })
})

describe('normaliseLegacySections', () => {
  it('keeps a section type through normalisation', () => {
    const sections = normaliseLegacySections([{ title: 'Section A', count: 10, type: 'essay', topic: 'Nutrition' }], 'Biology')
    expect(sections).toHaveLength(1)
    expect(sections[0].type).toBe('theory')
    expect(sections[0]).toMatchObject({ kind: 'compulsory', count: 10, topicHint: 'Nutrition' })
  })
})