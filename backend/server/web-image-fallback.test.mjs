import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchCommonsImages } from './web-image-fallback.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Wikimedia Commons image fallback', () => {
  it('returns image URLs with cleaned attribution and license metadata', async () => {
    const fetchMock = vi.fn(async (url) => {
      expect(String(url)).toContain('gsrsearch=plant+cell')
      return new Response(JSON.stringify({
        query: { pages: [{
          title: 'File:Plant cell.jpg',
          imageinfo: [{
            thumburl: 'https://upload.wikimedia.org/thumb.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Plant_cell.jpg',
            extmetadata: {
              ObjectName: { value: 'Plant &amp; cell' },
              LicenseShortName: { value: '<a>CC BY-SA 4.0</a>' },
              Artist: { value: 'A. Student' },
            },
          }],
        }] },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const images = await searchCommonsImages('plant cell', { count: 2 })

    expect(images).toEqual([{
      url: 'https://upload.wikimedia.org/thumb.jpg',
      title: 'Plant & cell',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Plant_cell.jpg',
      license: 'CC BY-SA 4.0',
      artist: 'A. Student',
    }])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('ignores non-Wikimedia URLs and degrades to no results on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: { pages: [{ imageinfo: [{ url: 'https://example.com/image.jpg' }] }] } }), { status: 200 }))
      .mockRejectedValueOnce(new Error('offline')))

    await expect(searchCommonsImages('cell diagram')).resolves.toEqual([])
    await expect(searchCommonsImages('cell diagram')).resolves.toEqual([])
  })

  it('keeps attribution links on Wikimedia Commons', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      query: { pages: [{
        title: 'File:Cell diagram.png',
        imageinfo: [{ url: 'https://upload.wikimedia.org/cell.png', descriptionurl: 'https://example.com/redirect' }],
      }] },
    }), { status: 200 })))

    const [image] = await searchCommonsImages('cell diagram')

    expect(image.sourceUrl).toBe('https://commons.wikimedia.org/wiki/File%3ACell%20diagram.png')
  })
})