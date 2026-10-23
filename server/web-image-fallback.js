const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

function metadataText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}

function commonsSourceUrl(info, page) {
  try {
    const url = new URL(info.descriptionurl)
    if (url.protocol === 'https:' && url.hostname === 'commons.wikimedia.org') return url.href
  } catch {}
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || '')}`
}

export async function searchCommonsImages(prompt, { count = 1, timeoutMs = 12000 } = {}) {
  const query = String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!query) return []

  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: String(Math.max(1, Math.min(10, Number(count) || 1))),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1200',
    format: 'json',
    formatversion: '2',
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${COMMONS_API}?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'CBTQuestionLab/1.0 (educational image search)' },
      signal: controller.signal,
    })
    if (!response.ok) return []

    const data = await response.json()
    return (data?.query?.pages || [])
      .flatMap((page) => (page.imageinfo || []).map((info) => {
        const url = info.thumburl || info.url
        let parsedUrl
        try { parsedUrl = new URL(url) } catch { return null }
        if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'upload.wikimedia.org') return null

        const metadata = info.extmetadata || {}
        return {
          url: parsedUrl.href,
          title: metadataText(metadata.ObjectName?.value) || 'Wikimedia Commons image',
          sourceUrl: commonsSourceUrl(info, page),
          license: metadataText(metadata.LicenseShortName?.value || metadata.UsageTerms?.value) || 'See source page',
          artist: metadataText(metadata.Artist?.value),
        }
      }))
      .filter(Boolean)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}