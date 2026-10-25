import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_MODELS,
  FIGURE_MODELS,
  IMAGE_MODELS,
  callChatCompletions,
  callImageGen,
  engineCooldownMs,
  usableImageModels,
} from './ai.js'

// These pin the two failure modes that made AI paths unreliable in practice:
//
//  1. A credit-limited key answers HTTP 402 before it reads the prompt, so an
//     over-generous max_tokens costs the entire request rather than truncating it.
//  2. Image NIMs share a small capacity pool, so a 429/503 on the first attempt is
//     routine — a single-shot client turns a blip into a failed picture.
//
// No network is touched: fetch is stubbed per test.

const openrouter = CHAT_MODELS.find((m) => m.provider === 'openrouter')
const env = { [openrouter.key]: 'x'.repeat(40), NVIDIA_ULTRA_KEY: 'x'.repeat(40) }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubFetch(handler) {
  const fn = vi.fn(handler)
  vi.stubGlobal('fetch', fn)
  return fn
}

const okChat = () => new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), { status: 200 })

describe('max_tokens ceilings', () => {
  it('caps a credit-limited key at the value it can actually afford', async () => {
    // Observed live: 4096 → HTTP 200, 8192 → HTTP 402 "requires more credits".
    const sent = []
    stubFetch(async (_url, init) => {
      sent.push(JSON.parse(init.body).max_tokens)
      return okChat()
    })

    await callChatCompletions(env, openrouter, [{ role: 'user', content: 'draw a triangle' }], { maxTokens: 16384 })

    expect(sent).toEqual([openrouter.maxTokensCap])
    expect(sent[0]).toBeLessThanOrEqual(4096)
  })

  it('never raises a ceiling above what the caller asked for', async () => {
    const sent = []
    stubFetch(async (_url, init) => {
      sent.push(JSON.parse(init.body).max_tokens)
      return okChat()
    })

    await callChatCompletions(env, openrouter, [{ role: 'user', content: 'hi' }], { maxTokens: 512 })

    expect(sent).toEqual([512])
  })

  it('leaves an uncapped engine alone', async () => {
    // Match on a key this test actually provides. callChatCompletions returns null
    // before fetching when the key is missing, so picking the first uncapped row
    // regardless of its key asserted nothing at all — it passed or failed on
    // roster ordering rather than on the max_tokens behaviour under test.
    const nvidia = CHAT_MODELS.find((m) => m.provider === 'nvidia' && !m.maxTokensCap && env[m.key])
    expect(nvidia).toBeDefined()
    const sent = []
    stubFetch(async (_url, init) => {
      sent.push(JSON.parse(init.body).max_tokens)
      return okChat()
    })

    await callChatCompletions(env, nvidia, [{ role: 'user', content: 'hi' }], { maxTokens: 16384 })

    expect(sent).toEqual([16384])
  })

  it('gives the diagram engines room for a detailed drawing', () => {
    for (const m of FIGURE_MODELS) expect(m.maxTokensCap).toBeGreaterThanOrEqual(16384)
  })
})

describe('callImageGen retries', () => {
  const model = {
    model: 'flux-test',
    key: 'NVIDIA_ULTRA_KEY',
    label: 'test',
    provider: 'nvidia',
    route: 'nim',
    mime: 'image/jpeg',
    endpoint: 'https://example.test/genai',
    buildBody: (prompt, o) => ({ prompt, seed: o.seed ?? 0, width: o.width, height: o.height }),
  }
  const body = () => JSON.stringify({ artifacts: [{ base64: 'AAA' }] })
  const opts = { size: '1024x1024', timeoutMs: 20000 }

  it('rides out a transient 503 instead of failing the picture', async () => {
    const fn = stubFetch(async () => {
      if (fn.mock.calls.length === 1) return new Response('busy', { status: 503 })
      return new Response(body(), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const result = await callImageGen(env, model, 'a triangle', opts)

    expect(result.images).toHaveLength(1)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries a 429 the same way', async () => {
    const fn = stubFetch(async () => {
      if (fn.mock.calls.length <= 2) return new Response('slow down', { status: 429 })
      return new Response(body(), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    await expect(callImageGen(env, model, 'a triangle', opts)).resolves.toBeTruthy()
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry a dead endpoint', async () => {
    const fn = stubFetch(async () => new Response('gone', { status: 404 }))

    await expect(callImageGen(env, model, 'a triangle', opts)).rejects.toThrow(/HTTP 404/)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('gives up after the attempt limit and reports the last error', async () => {
    const fn = stubFetch(async () => new Response('busy', { status: 503 }))

    await expect(callImageGen(env, model, 'a triangle', { ...opts, attempts: 2 })).rejects.toThrow(/503/)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('never spends past the caller timeout', async () => {
    const fn = stubFetch(async () => new Response('busy', { status: 503 }))
    const t0 = Date.now()

    await expect(callImageGen(env, model, 'a triangle', { ...opts, attempts: 5, timeoutMs: 5000 })).rejects.toThrow()
    // 3 backoffs of 400/800/1600ms plus requests must still fit the budget.
    expect(Date.now() - t0).toBeLessThan(9000)
    expect(fn.mock.calls.length).toBeLessThan(5)
  })
})

describe('image engine roster', () => {
  it('keeps unresponsive endpoints out of rotation', () => {
    // flux.1-schnell measured >150s with no image; leaving it in meant every
    // picture request that fell through burned a full timeout and then failed.
    const schnell = IMAGE_MODELS.find((m) => m.model.includes('flux.1-schnell'))
    expect(schnell.disabled).toBe(true)
    expect(schnell.disabledReason).toBeTruthy()

    const usable = usableImageModels(env).map((m) => m.model)
    expect(usable).not.toContain(schnell.model)
  })

  it('cools 429 and 503 briefly but retires 404 outright', () => {
    expect(engineCooldownMs(new Error('HTTP 429')).ms).toBeLessThan(engineCooldownMs(new Error('HTTP 404')).ms)
    expect(engineCooldownMs(new Error('HTTP 503')).backoff).toBe(true)
    expect(engineCooldownMs(new Error('HTTP 404')).backoff).toBe(false)
  })
})
