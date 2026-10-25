import { describe, expect, it } from 'vitest'
import { figureSourceMode, sanitizeSvg, styleFigureSvg } from './figures.js'

// Models hit the output-token ceiling on detailed diagrams, so figures regularly
// arrive cut off. These cases pin the repair behaviour: a truncated drawing is
// recovered rather than thrown away, while prose that merely mentions <svg> is
// still rejected.

describe('figureSourceMode', () => {
  it('accepts ai and web and normalises everything else to auto', () => {
    expect(figureSourceMode('ai')).toBe('ai')
    expect(figureSourceMode('web')).toBe('web')
    expect(figureSourceMode('auto')).toBe('auto')
    expect(figureSourceMode(undefined)).toBe('auto')
    expect(figureSourceMode(null)).toBe('auto')
    expect(figureSourceMode('banana')).toBe('auto')
    expect(figureSourceMode('')).toBe('auto')
    expect(figureSourceMode(1)).toBe('auto')
  })
})

describe('sanitizeSvg', () => {
  it('keeps well-formed markup untouched', () => {
    const good = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="10" height="10"/></svg>'
    expect(sanitizeSvg(good)).toBe(good)
  })

  it('closes a document cut off mid-content', () => {
    const cut = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 440"><g><line x1="0" y1="0" x2="9" y2="9"/><text x="5" y="5">A'
    expect(sanitizeSvg(cut)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 440"><g><line x1="0" y1="0" x2="9" y2="9"/><text x="5" y="5">A</text></g></svg>',
    )
  })

  it('drops a half-written tag and nests the closers correctly', () => {
    const cut = '<svg viewBox="0 0 640 440"><defs><marker id="arrow" viewBox="0 0 10 10" refX="0" refY="5"></defs><g><circle cx="5" cy="5" r="4" fill="#eee"/><rect x="1" y="2" width='
    expect(sanitizeSvg(cut)).toBe(
      '<svg viewBox="0 0 640 440"><defs><marker id="arrow" viewBox="0 0 10 10" refX="0" refY="5"></marker></defs><g><circle cx="5" cy="5" r="4" fill="#eee"/></g></svg>',
    )
  })

  it('never invents a closing tag for a void element', () => {
    const cut = '<svg viewBox="0 0 10 10"><path d="M0 0"/><line x1="0" y1="0" x2="1" y2="1"/>'
    expect(sanitizeSvg(cut)).toBe(`${cut}</svg>`)
  })

  it('strips executable content, including on the repair path', () => {
    const cut = '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect onclick="x()" width="5" height="5"/><a href="javascript:alert(2)">x'
    const cleaned = sanitizeSvg(cut) ?? ''
    expect(cleaned).not.toMatch(/script/i)
    expect(cleaned).not.toMatch(/onclick/i)
    expect(cleaned).not.toMatch(/javascript:/i)
  })

  it('rejects prose that only mentions the svg element', () => {
    expect(sanitizeSvg('The tag <svg> is used for vector graphics.')).toBeNull()
  })

  it('rejects empty and non-string input', () => {
    expect(sanitizeSvg('')).toBeNull()
    expect(sanitizeSvg(null)).toBeNull()
  })
})

describe('styleFigureSvg', () => {
  const cut = '<svg viewBox="0 0 640 440"><g><text x="10" y="20" font-size="12">Radius</text>'

  it('styles a repaired figure', () => {
    const styled = styleFigureSvg(sanitizeSvg(cut))
    expect(styled).toMatch(/<\/svg>$/i)
    expect(styled).toContain('fx-waver')
  })

  it('omits the pencil waver in clean mode', () => {
    expect(styleFigureSvg(sanitizeSvg(cut), { style: 'clean' })).not.toContain('fx-waver')
  })

  it('haloes labels even when the figure was truncated', () => {
    expect(styleFigureSvg(sanitizeSvg(cut))).toContain('paint-order="stroke"')
  })
})
