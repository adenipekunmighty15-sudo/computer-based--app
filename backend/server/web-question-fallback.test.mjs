import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchInternetQuestions } from './web-question-fallback.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('internet question fallback', () => {
  it('maps a subject category, filters by topic, and preserves the answer and attribution', async () => {
    const fetchMock = vi.fn(async (url) => {
      const requestUrl = new URL(url)
      expect(requestUrl.searchParams.get('category')).toBe('19')
      expect(requestUrl.searchParams.get('type')).toBe('multiple')
      return new Response(JSON.stringify({
        response_code: 0,
        results: [
          {
            category: 'Science: Mathematics',
            difficulty: 'easy',
            question: 'Solve%20the%20algebra%20equation%20x%20%3D%202',
            correct_answer: '2',
            incorrect_answers: ['1', '3', '4'],
          },
          {
            category: 'Science: Mathematics',
            difficulty: 'easy',
            question: 'What%20is%20the%20capital%20of%20France%3F',
            correct_answer: 'Paris',
            incorrect_answers: ['Rome', 'Madrid', 'Lisbon'],
          },
        ],
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const questions = await fetchInternetQuestions({ subject: 'Mathematics', topic: 'Algebra', difficulty: 'easy' }, 2, { rateLimitMs: 0 })

    expect(questions).toHaveLength(1)
    expect(questions[0].prompt).toBe('Solve the algebra equation x = 2')
    expect(questions[0].options).toHaveLength(4)
    expect(questions[0].options[questions[0].answer]).toBe('2')
    expect(questions[0].sourceUrl).toBe('https://opentdb.com/')
    expect(questions[0].sourceLicense).toBe('CC BY-SA 4.0')
    expect(questions[0].explanation).toContain('https://opentdb.com/')
  })

  it('returns no questions when the subject has no category or the service is unavailable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchInternetQuestions({ subject: 'English', topic: 'Poetry' }, 5, { rateLimitMs: 0 })).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(fetchInternetQuestions({ subject: 'Mathematics', topic: 'Algebra' }, 5, { rateLimitMs: 0 })).resolves.toEqual([])
  })

  it('rejects unrelated questions even when they arrive in the requested broad category', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      response_code: 0,
      results: [
        { category: 'Science: Mathematics', difficulty: 'easy', question: 'What is 2 + 2?', correct_answer: '4', incorrect_answers: ['1', '2', '3'] },
        { category: 'Science: Mathematics', difficulty: 'easy', question: 'What is the capital of France?', correct_answer: 'Paris', incorrect_answers: ['Rome', 'Madrid', 'Lisbon'] },
      ],
    }), { status: 200 })))

    const questions = await fetchInternetQuestions({ subject: 'Mathematics', topic: 'Mathematics' }, 2, { rateLimitMs: 0 })

    expect(questions).toHaveLength(1)
    expect(questions[0].prompt).toBe('What is 2 + 2?')
  })

  it('caps an online request at 50 and leaves larger batches for the local fallback', async () => {
    const fetchMock = vi.fn(async (url) => {
      expect(new URL(url).searchParams.get('amount')).toBe('50')
      return new Response(JSON.stringify({
        response_code: 0,
        results: Array.from({ length: 50 }, () => ({
          category: 'Science: Mathematics',
          difficulty: 'easy',
          question: 'What is 2 + 2?',
          correct_answer: '4',
          incorrect_answers: ['1', '2', '3'],
        })),
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const questions = await fetchInternetQuestions({ subject: 'Mathematics', topic: 'Mathematics' }, 60, { rateLimitMs: 0 })

    expect(questions).toHaveLength(50)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

})