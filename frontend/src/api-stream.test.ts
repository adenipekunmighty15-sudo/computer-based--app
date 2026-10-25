import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaperStep } from './api'
import { api, ApiError } from './api'

// The Exam Sheet's "thinking" drawer reads /api/ai/paper/stream, an SSE feed.
// These tests pin the exact framing the parser understands: `event:` lines,
// single-line `data:` JSON, `\n\n` between blocks, a terminal `done`/`error`,
// and what happens when the server is not there or the run is cancelled.

const encoder = new TextEncoder()

function sseResponse(...blocks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(blocks.join('\n\n')))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

function stubFetch(impl: () => Promise<Response>) {
  const fn = vi.fn(() => impl())
  vi.stubGlobal('fetch', fn as unknown as typeof fetch)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const payload = {
  success: true,
  paper: { paperTitle: 'SS3 Mathematics Assessment', sections: [] },
  total: 0,
  figures: 0,
}

describe('api.aiPaperStream', () => {
  it('delivers each step as it arrives and resolves with the done payload', async () => {
    stubFetch(() =>
      Promise.resolve(
        sseResponse(
          'event: step\ndata: {"phase":"begin","message":"Starting the exam","at":1}',
          'event: step\ndata: {"phase":"progress","section":"SECTION A","done":5,"count":10,"message":"SECTION A: 5 of 10","at":2}',
          `event: done\ndata: ${JSON.stringify(payload)}`,
        ),
      ),
    )

    const steps: PaperStep[] = []
    const result = await api.aiPaperStream({ subject: 'Mathematics' }, { onStep: (s) => steps.push(s) })

    expect(result.paper?.paperTitle).toBe('SS3 Mathematics Assessment')
    expect(steps).toHaveLength(2)
    expect(steps[0]).toMatchObject({ phase: 'begin', message: 'Starting the exam' })
    expect(steps[1]).toMatchObject({ phase: 'progress', done: 5, count: 10 })
    expect(fetch).toBeCalledWith('/api/ai/paper/stream', expect.objectContaining({ method: 'POST' }))
  })

  it('rejects with the server message on an error event', async () => {
    stubFetch(() => Promise.resolve(sseResponse('event: error\ndata: {"error":"The picture engine did not answer"}')))

    await expect(api.aiPaperStream({ subject: 'Biology' }, { onStep: () => {} })).rejects.toMatchObject({
      name: 'ApiError',
      message: 'The picture engine did not answer',
    })
  })

  it('rejects with the plain JSON error body when the endpoint answers non-OK', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'Subject is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(api.aiPaperStream({} as never, { onStep: () => {} })).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Subject is required',
    })
  })

  it('reports a cancelled run as ApiError("Generation cancelled")', async () => {
    stubFetch(() =>
      Promise.reject(new DOMException('The user aborted a request.', 'AbortError')),
    )

    const controller = new AbortController()
    controller.abort()
    await expect(api.aiPaperStream({ subject: 'Physics' }, { onStep: () => {}, signal: controller.signal })).rejects.toBeInstanceOf(ApiError)
    await expect(api.aiPaperStream({ subject: 'Physics' }, { onStep: () => {}, signal: controller.signal })).rejects.toMatchObject({
      message: 'Generation cancelled',
    })
  })
})