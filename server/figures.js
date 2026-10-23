// Figures — the diagrams that sit inside exam questions.
//
// Two jobs live here and they are deliberately separate:
//
//   1. SCORING   which questions actually want a picture, so "10 pictures out of
//                30" lands on the ten questions that need one instead of on
//                questions 1–10.
//   2. STYLING   taking whatever SVG an engine returns and turning it into
//                something that prints: a paper background, labels that are big
//                enough to read, a light halo behind each label so it survives
//                being drawn on top of artwork, and — by default — a pencil
//                waver that makes it look drawn rather than plotted.
//
// The styler is a post-processor, not a prompt. Models already return a usable
// SVG most of the time; what they get wrong is legibility and framing, and
// legibility is something we can fix deterministically instead of hoping a
// model agrees with us about it.

// ─────────────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────────────

// Written for an engine that has never seen a school exam paper. The two rules
// that matter are the labelling block (labels are the whole point — an
// unlabelled diagram is worse than no diagram) and the ban on <style> blocks,
// because a CSS class would hide a font size from the styler below.
export const FIGURE_SYSTEM = `You are the illustrator for a secondary school exam paper. You draw ONE labelled figure per question, in the style of a hand-drawn textbook diagram: clear, precise pencil linework on plain paper, and labels a student can read at a glance. Each drawing must be clearly drawn (clean, unbroken lines, no smudging, no sketchy noise) with sharp, legible lettering.

Return ONLY raw SVG markup. No markdown, no code fences, no commentary before or after.

CANVAS
- Begin with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 440" width="100%"> and end with </svg>.
- Keep a 24px margin: nothing may cross the viewBox edge.
- Do not draw a background rectangle — the paper is added for you.

LINEWORK
- Strokes and pale flat washes only. No gradients, no shadows, no 3D, no photorealism, no clip-art.
- stroke="#1f2328" with stroke-width="2" or "3"; fill="none", or a pale wash such as "#f2efe6", "#e9f0f4", "#f7ece4", "#eaf2e8" for a solid part.
- Put an arrowhead on every directional arrow, and ticks plus numbers on every axis.
- Write every measurement the question gives straight onto the figure (an angle, a length, a value, a unit).

LABELLING — a figure without labels is rejected
- Label every part the question names, every axis, every arrow, and every unit. Use the EXACT letters and numbers the question uses.
- Place each label OUTSIDE the shape it names, never on top of a line or inside a filled shape.
- One label per part. No duplicates. Labels must not overlap each other or the artwork; leave clear space around each one.
  - font-size 17–20 for part names, 14–16 for small annotations. Never below 14.
  - Use font-family="Times New Roman", "Times", "serif" for ALL text labels. Do NOT use sans-serif, monospaced, display, or decorative fonts.
  - Connect a label to its part with a thin leader line (a <line> with stroke-width="1") whenever the label is not already touching the part it names.
  - Use presentation attributes only, e.g. <text x="120" y="96" font-size="18" font-family="Times New Roman, Times, serif" fill="#1f2328">O</text>. No <style> block, no CSS classes, no CSS inside a style attribute.

CONTENT
- Draw exactly what the question describes — no more. If it names points A, B and C, label those three letters.
- No title, caption, heading, border text or watermark inside the drawing; the caption is printed separately.
- Never include <script>, <foreignObject>, on* event handlers, external images or javascript: URLs.

INTERACTIVITY & EXPLORATION
- For each distinct part of the diagram (e.g. an organ, a circuit component, a geometric shape, a labelled part), wrap its elements in a <g> tag.
- Add a data-label="Name of Part" attribute to that <g> tag. 
- Example: <g data-label="Mitochondrion"><ellipse .../><path .../></g>
- Students will be able to hover over these parts to see their names.`

export function figureAsk({ subject, prompt, extra }) {
  return [
    `Draw ONE labelled figure for this ${subject || 'secondary school'} exam question.`,
    `Question: ${prompt ? `"${String(prompt).slice(0, 600)}"` : '"(a general school science concept)"'}`,
    extra ? String(extra) : '',
    'Think first about exactly which parts this question refers to, then label every one of them.',
    'Return only the SVG.',
  ]
    .filter(Boolean)
    .join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Sanitising
// ─────────────────────────────────────────────────────────────────────────────

// Keep only the <svg>…</svg> payload and strip anything executable, so stored
// markup is safe even if it is ever inlined rather than shown in an <img>.
//
// A figure that was cut off mid-document is still a usable figure. Models hit
// the output-token ceiling on detailed diagrams, and previously the truncated
// markup was thrown away whole — the response was perfectly good right up to
// the cut, but with no closing </svg> the old strict scan rejected it and the
// engine was reported as having produced nothing. repairTruncatedSvg() closes
// what is still open so the drawing survives its own truncation.
export function sanitizeSvg(raw) {
  if (!raw) return null
  const t = String(raw).replace(/```svg/gi, '').replace(/```/g, '').trim()
  const s = t.indexOf('<svg')
  if (s === -1) return null

  const e = t.lastIndexOf('</svg>')
  // No closing tag: the response was truncated. Take everything from <svg on
  // and repair it — but only when it is real drawing markup. Without this guard
  // a model that merely *talks* about SVG ("the <svg> element is used for…")
  // would be accepted and rendered as an empty, meaningless figure.
  const svg = e === -1 || e < s ? repairTruncatedSvg(t.slice(s)) : t.slice(s, e + 6)
  if (!svg) return null

  const cleaned = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
  return /^<svg[\s>]/i.test(cleaned) ? cleaned : null
}

// Close every element the model left open. Two passes: void elements never need
// closing, and a <text> truncated mid-glyph still has its container closed so
// the part that was written still renders.
const VOID_ELEMENTS = new Set([
  'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'use',
  'image', 'stop', 'animate', 'feTurbulence', 'feDisplacementMap', 'feColorMatrix',
  'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode', 'feComposite', 'feFlood',
])

// Elements that make a fragment an actual drawing rather than a mention of one.
const DRAWABLE = /<(?:g|rect|circle|ellipse|line|polyline|polygon|path|text|image|use)\b/i

function repairTruncatedSvg(fragment) {
  const src = fragment.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
  const head = src.match(/^<svg\b[^>]*>/i)
  if (!head) return null
  // Prose about SVG, not a figure: no root element, no canvas, nothing drawn.
  const body = src.slice(head[0].length)
  if (!/\bviewBox\s*=/i.test(head[0]) && !DRAWABLE.test(body)) return null
  if (!DRAWABLE.test(src)) return null

  // Drop whatever partial tag the token cut landed in the middle of.
  let out = src.replace(/<[^>]*$/, '')

  // Rebuild with a nesting stack. When a closing tag arrives for an element
  // that is not the innermost open one, the elements left open inside it are
  // closed right there — that keeps <marker>…</marker></defs> properly nested
  // instead of emitting a closing tag for the wrong ancestor.
  const open = []
  let result = ''
  let cursor = 0
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g
  let m
  while ((m = tagRe.exec(out)) !== null) {
    result += out.slice(cursor, m.index)
    cursor = m.index + m[0].length
    const closing = m[1]
    const selfClose = m[4]
    const tag = m[2].toLowerCase()
    if (closing) {
      const at = open.lastIndexOf(tag)
      // Close only what is still open *inside* the tag the model wrote, then
      // let the real tag follow — <marker>…</marker></defs> nests correctly and
      // no closing tag is duplicated.
      if (at !== -1) {
        for (let i = open.length - 1; i > at; i -= 1) result += `</${open[i]}>`
        open.length = at
      }
    } else if (!VOID_ELEMENTS.has(tag) && selfClose !== '/') {
      open.push(tag)
    }
    // The tag itself is always kept: dropping it would discard the drawing.
    result += m[0]
  }
  result += out.slice(cursor)

  // Close whatever is still open at the cut.
  for (let i = open.length - 1; i >= 0; i -= 1) result += `</${open[i]}>`
  return result
}


// ─────────────────────────────────────────────────────────────────────────────
// SVG surgery helpers
// ─────────────────────────────────────────────────────────────────────────────

const ROOT_RE = /^<svg\b[^>]*>/i
const CLOSE_RE = /<\/svg>\s*$/i

function viewBoxOf(svg) {
  const m = svg.match(/\bviewBox\s*=\s*["']\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)\s*["']/i)
  if (!m) return null
  const w = parseFloat(m[3])
  const h = parseFloat(m[4])
  if (!(w > 0) || !(h > 0)) return null
  return { x: parseFloat(m[1]) || 0, y: parseFloat(m[2]) || 0, w, h }
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  return m ? m[2] ?? m[3] ?? '' : null
}

function setAttr(tag, name, value) {
  const re = new RegExp(`(\\s${name}\\s*=\\s*)("([^"]*)"|'([^']*)')`, 'i')
  if (re.test(tag)) return tag.replace(re, `$1"${String(value)}"`)
  // No existing attribute: add one just before the tag closes, keeping any
  // self-closing slash that is already there.
  return tag.replace(/(\s*\/?>)$/, ` ${name}="${String(value)}"$1`)
}

function dropAttr(tag, name) {
  return tag.replace(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'), '')
}

// Perceived lightness, 0–1. Used to decide whether a label needs a light halo
// (dark glyphs) or a dark one (light glyphs).
function lightnessOf(color) {
  if (!color) return 0
  const c = String(color).trim().toLowerCase()
  if (c === 'none' || c === 'transparent') return 0
  let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (m) {
    const hex = m[1].length === 3 ? m[1].replace(/./g, (c2) => c2 + c2) : m[1]
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }
  m = c.match(/rgba?\(([^)]+)\)/i)
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p))
    if (parts.length >= 3) return (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 255
  }
  const named = { white: 1, black: 0, red: 0.29, blue: 0.29, green: 0.59, navy: 0.16, gray: 0.5, grey: 0.5, silver: 0.75 }
  return named[c] ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// The styler
// ─────────────────────────────────────────────────────────────────────────────

const PAPER = '#fdfcf8'
const INK = '#1f2328'

const PENCIL_DEFS = `<defs>
<filter id="fx-waver" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.019" numOctaves="3" seed="11" result="warp"/><feDisplacementMap in="SourceGraphic" in2="warp" scale="1.4" xChannelSelector="R" yChannelSelector="G"/></filter>
<filter id="fx-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="3"/><feColorMatrix type="matrix" values="0 0 0 0 0.16 0 0 0 0 0.15 0 0 0 0 0.13 0 0 0 0.06 0"/></filter>
</defs>`

const SHARED_STYLE = `<style>text,tspan{font-family:Verdana,"DejaVu Sans","Helvetica Neue",Arial,sans-serif}line,polyline,polygon,path,circle,ellipse,rect{stroke-linecap:round;stroke-linejoin:round}</style>`

/**
 * Post-process an engine's SVG into something that prints well.
 *
 * `style`:
 *   'pencil' (default) — paper grain plus a low-frequency waver on the artwork,
 *                        so the figure reads as hand-drawn. Labels stay crisp
 *                        because the waver is under one user-space pixel.
 *   'clean'            — same framing and label work, no waver or grain.
 *
 * Everything here is deterministic. The prompt asks for a legible figure; this
 * is what guarantees it.
 */
export function styleFigureSvg(svg, options = {}) {
  if (!svg) return null
  const style = options.style === 'clean' ? 'clean' : 'pencil'
  let out = svg

  const rootMatch = out.match(ROOT_RE)
  if (!rootMatch) return null
  let root = rootMatch[0]
  let body = out.slice(rootMatch[0].length).replace(CLOSE_RE, '')

  const vb = viewBoxOf(out) || { x: 0, y: 0, w: 640, h: 440 }

  // Labels are sized relative to the canvas so a 320px-wide diagram and a
  // 1200px-wide one both end up with a label a student can read.
  const floor = Math.max(13, Math.round(vb.w * 0.033))

  // 1. Label size floor. Every explicit font size is scaled by one shared
  //    factor (capped, so an already-large label does not explode) and then
  //    floored, which keeps the intended hierarchy while raising the floor.
  const sizeAttr = /\bfont-size\s*=\s*("([^"]*)"|'([^']*)')/gi
  const found = []
  let m
  while ((m = sizeAttr.exec(body)) !== null) {
    const v = parseFloat(m[2] ?? m[3])
    if (Number.isFinite(v) && v > 0) found.push(v)
  }
  const smallest = found.length ? Math.min(...found) : 0
  const k = smallest > 0 ? Math.min(1.45, Math.max(1, floor / smallest)) : 1
  body = body.replace(sizeAttr, (full, _quoted, dq, sq) => {
    const raw = dq ?? sq ?? ''
    const v = parseFloat(raw)
    if (!Number.isFinite(v) || v <= 0) return full
    const name = full.slice(0, full.indexOf('='))
    const quote = dq !== undefined ? '"' : "'"
    const next = Math.max(floor, Math.round(v * k * 10) / 10)
    return `${name}=${quote}${next}${quote}`
  })
  body = body.replace(/(style\s*=\s*"[^"]*?)font-size\s*:\s*([\d.]+)px/gi, (full, head, num) => {
    const v = parseFloat(num)
    if (!Number.isFinite(v) || v <= 0) return full
    return `${head}font-size: ${Math.max(floor, Math.round(v * k * 10) / 10)}px`
  })

  // 2. Labels get a halo in the opposite value to their own fill, so a label
  //    stays readable even when the model drew it across a filled shape or a
  //    line. paint-order puts the halo behind the glyphs.
  body = body.replace(/<text\b[^>]*>/gi, (tag) => {
    let t = tag
    const fill = attr(t, 'fill') ?? (/fill\s*:\s*([^;"']+)/i.exec(attr(t, 'style') || '') || [])[1] ?? null
    const l = lightnessOf(fill)
    const dark = l === null || l < 0.72
    t = dropAttr(t, 'stroke')
    t = dropAttr(t, 'paint-order')
    t = setAttr(t, 'stroke', dark ? '#fffdf6' : '#12171d')
    t = setAttr(t, 'stroke-width', '2.6')
    t = setAttr(t, 'stroke-linejoin', 'round')
    t = setAttr(t, 'paint-order', 'stroke')
    if (attr(t, 'font-weight') === null) t = setAttr(t, 'font-weight', '600')
    if (attr(t, 'font-size') === null) t = setAttr(t, 'font-size', String(floor))
    return t
  })

  // 3. Root element: scale to its container instead of to fixed pixels, so the
  //    same data URL is crisp in a 90px thumbnail, a 320px sheet and full-screen.
  if (viewBoxOf(root)) {
    root = dropAttr(root, 'width')
    root = dropAttr(root, 'height')
  } else {
    root = setAttr(root, 'viewBox', `0 0 ${Math.round(vb.w)} ${Math.round(vb.h)}`)
  }
  root = setAttr(root, 'preserveAspectRatio', 'xMidYMid meet')

  const paper =
    `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${PAPER}"/>` +
    (style === 'pencil' ? `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" filter="url(#fx-grain)"/>` : '')

  const head = style === 'pencil' ? `${PENCIL_DEFS}\n${SHARED_STYLE}\n${paper}` : `${SHARED_STYLE}\n${paper}`
  const artwork = style === 'pencil' ? `<g filter="url(#fx-waver)">${body}</g>` : body

  return `${root}${head}${artwork}</svg>`
}

// Strip the width/height an engine may have set so the styler can own framing.
export function normaliseFigureSvg(svg, options = {}) {
  const safe = sanitizeSvg(svg)
  return safe ? styleFigureSvg(safe, options) : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Which questions want a picture
// ─────────────────────────────────────────────────────────────────────────────

// A question that says "in the diagram below" is worthless without a diagram, so
// that phrasing outranks everything. Everything after it is a hint that a figure
// would help: named shapes, organs, graphs, apparatus.
const NEEDS_FIGURE = [
  'diagram', 'sketch', 'graph below', 'shown below', 'illustrated', 'figure below',
  'the diagram', 'this diagram', 'as shown', 'in the figure',
]
const VISUAL = [
  // geometry & measurement
  'triangle', 'rectangle', 'parallelogram', 'trapezium', 'rhombus', 'circle', 'cylinder', 'cone', 'sphere',
  'polygon', 'prism', 'polygon', 'angle', 'polygon', 'quadrilateral', 'plane', 'solid', 'net of',
  'vector', 'bearing', 'latitude', 'longitude', 'contour', 'scale drawing', 'construction',
  // charts
  'graph', 'histogram', 'bar chart', 'pie chart', 'scatter', 'frequency polygon', 'ogive',
  // biology
  'cell', 'nucleus', 'organ', 'heart', 'lung', 'leaf', 'flower', 'root', 'seed', 'photosynthesis',
  'digestive', 'respirat', 'circulatory', 'nervous', 'skeleton', 'muscle', 'reflex', 'chromosome',
  'gene', 'dna', 'tissue', 'organism', 'microscope', 'food chain', 'ecosystem', 'evolution',
  // chemistry & physics
  'atom', 'molecule', 'compound', 'mixture', 'acid', 'alkali', 'titration', 'apparatus', 'solution',
  'circuit', 'resistor', 'battery', 'current', 'voltage', 'wave', 'lens', 'mirror', 'magnet',
  'pulley', 'lever', 'inclined plane', 'force', 'equilibrium', 'machine', 'turbine', 'generator',
  // economics & geography
  'map', 'cross-section', 'climograph', 'population pyramid', 'supply', 'demand', 'bar',
  // general
  'apparatus', 'setup', 'shown in the figure', 'identify the',
]
// Questions that are pure recall or pure arithmetic. A picture here is
// decoration at best and a distraction at worst.
const AVOID_FIGURE = [
  'state ', 'define ', 'mention ', 'list ', 'name the', 'write ', 'which of the following is not',
  'state one', 'give two', 'state any', 'state the', 'true or false',
]

// Scores are additive and then clamped; the ordering is what matters, not the
// absolute number.
export function figureScore(question) {
  const parts = [question?.prompt, question?.topic, question?.subject, ...(question?.options || [])]
  const text = parts.filter(Boolean).join(' \n ').toLowerCase()
  if (!text) return 0
  let score = 0

  if (NEEDS_FIGURE.some((p) => text.includes(p))) score += 100
  for (const v of VISUAL) if (text.includes(v)) score += 6
  for (const a of AVOID_FIGURE) if (text.includes(a)) score -= 12

  // A stem full of numbers with four numeric options is arithmetic, not a diagram.
  const opts = (question?.options || []).filter(Boolean)
  if (opts.length >= 3) {
    const numeric = opts.filter((o) => /^[\s$£₦0-9.,()+\-/*^%]+$/.test(String(o))).length
    if (numeric >= opts.length - 1) score -= 10
  }
  // A long stem is usually a wordy comprehension item.
  if ((question?.prompt || '').length > 260) score -= 8

  return score
}

// Where a paper's pictures come from. `auto` (the default) draws with the AI
// engines and asks the web (Wikimedia Commons/Openverse) only when a draw
// fails; `ai` and `web` pin the source. Every mode still falls back to the
// local SVG so a question never prints without its figure.
export function figureSourceMode(value) {
  return value === 'ai' || value === 'web' ? value : 'auto'
}

/**
 * Choose `want` questions to illustrate.
 *
 * `order` is the caller's spread order (round-robin across sections), so every
 * section stays represented; the score only reorders that spread by how much
 * each question wants a picture. Anything scoring at or below zero is dropped
 * first, so a paper of pure arithmetic gets no diagrams at all rather than
 * twenty decorative ones.
 */
export function pickFigureTargets(questions, want, order = questions.map((_, i) => i)) {
  const n = Math.max(0, Math.min(questions.length, Math.floor(want) || 0))
  if (!n) return []
  const ranked = order
    .map((i) => ({ i, score: figureScore(questions[i]) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
  const positive = ranked.filter((r) => r.score > 0)
  // Prefer questions that want a figure; fall back to the spread order so the
  // teacher still gets the pictures they asked for on a non-visual topic.
  const picked = (positive.length >= n ? positive : [...positive, ...ranked.filter((r) => r.score <= 0)])
    .slice(0, n)
    .map((r) => r.i)
  // Hand back in paper order so figures read as spread through the sheet.
  return picked.sort((a, b) => a - b)
}

/**
 * Turn a teacher's "how many pictures" into a number.
 * Accepts an explicit count, or a ratio of the paper, and never exceeds the
 * number of questions actually generated.
 */
export function figureBudget(spec = {}, total = 0) {
  const n = Math.max(0, Math.floor(total) || 0)
  if (spec === false || spec.withFigures === false) return 0
  const raw = spec.figures ?? spec.figureCount
  if (raw !== undefined && raw !== null && raw !== '' && Number.isFinite(Number(raw))) {
    return Math.max(0, Math.min(n, Math.round(Number(raw))))
  }
  const ratio = Number(spec.figureRatio)
  if (Number.isFinite(ratio) && ratio > 0) return Math.max(0, Math.min(n, Math.round(n * Math.min(1, ratio))))
  if (spec.figures === undefined && spec.figureRatio === undefined && spec.withFigures === undefined && n > 0) {
    /* No preference given: a third of the paper. There is deliberately no cap
       here — it used to be 20, then 200, and both numbers quietly truncated a
       teacher's paper without saying so. The wall-clock budget in
       attachFigures() is what actually bounds a request, and it scales with the
       count, so "as many as the paper needs" is now literally true. */
    return Math.max(1, Math.round(n / 3))
  }
  return 0
}