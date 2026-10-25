import { describe, expect, it } from 'vitest'
import { cleanJson, parseQuestions, toBankQuestions } from './ai.js'

// Routes that ask for ONE question — the exam sheet's rewriter above all — get one
// JSON object back rather than an array. parseQuestions used to require an array,
// so every rewrite returned an empty list and the button looked simply broken.

const OBJ = '{"question":"How many degrees do the interior angles of a triangle add up to?","options":["A. 90","B. 180","C. 270","D. 360"],"correct":"B","explanation":"Always 180.","topic":"Geometry","difficulty":"easy"}'

describe('parseQuestions', () => {
  it('accepts a JSON array', () => {
    expect(parseQuestions(`[${OBJ}]`)).toHaveLength(1)
  })

  it('accepts a single object, as returned by the rewrite route', () => {
    const parsed = parseQuestions(OBJ)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].question).toMatch(/interior angles/)
  })

  it('unwraps an array nested under a wrapper key', () => {
    expect(parseQuestions(`{"questions":[${OBJ}]}`)).toHaveLength(1)
  })

  it('tolerates prose around the payload', () => {
    expect(parseQuestions(`Here is the rewritten question:\n${OBJ}\nHope that helps!`)).toHaveLength(1)
  })

  it('rejects payloads with no question text', () => {
    expect(parseQuestions('[]')).toEqual([])
    expect(parseQuestions('{"options":["a","b"]}')).toEqual([])
    expect(parseQuestions('not json at all')).toEqual([])
    expect(parseQuestions('')).toEqual([])
  })

  it('drops array items that are not question-shaped', () => {
    expect(parseQuestions(`[${OBJ},{"foo":1},"string"]`)).toHaveLength(1)
  })
})

describe('cleanJson', () => {
  it('reads through markdown fences', () => {
    expect(cleanJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
})

describe('toBankQuestions with a single object', () => {
  it('normalises it to a bank question', () => {
    const [q] = toBankQuestions(OBJ)
    expect(q.prompt).toMatch(/interior angles/)
    expect(q.options).toEqual(['90', '180', '270', '360'])
    expect(q.answer).toBe(1)
    expect(q.topic).toBe('Geometry')
  })
})
