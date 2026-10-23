import { describe, it, expect } from 'vitest'
import { generateLocalQuestionSet, generateLocalSvgFigure } from './local-fallback.js'

describe('local fallbacks', () => {
  it('creates a valid batch of MCQs when AI is unavailable', () => {
    const questions = generateLocalQuestionSet({ subject: 'Mathematics', topic: 'Algebra', classLevel: 'JSS 2', difficulty: 'medium' }, 3)

    expect(questions).toHaveLength(3)
    questions.forEach((q) => {
      expect(q.prompt).toBeTruthy()
      expect(Array.isArray(q.options)).toBe(true)
      expect(q.options).toHaveLength(4)
      expect(Number.isInteger(q.answer)).toBe(true)
      expect(q.answer).toBeGreaterThanOrEqual(0)
      expect(q.answer).toBeLessThan(q.options.length)
      expect(q.subject).toMatch(/mathematics|algebra|general/i)
    })
  })

  it('creates a local SVG figure data URI for diagrams', () => {
    const src = generateLocalSvgFigure({ subject: 'Mathematics', prompt: 'Solve the linear graph question' })
    const decoded = decodeURIComponent(src.split(',')[1] || '')

    expect(src.startsWith('data:image/svg+xml')).toBe(true)
    expect(decoded.includes('<svg')).toBe(true)
  })
})
