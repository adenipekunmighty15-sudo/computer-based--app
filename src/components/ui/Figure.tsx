/* Figures. Question diagrams are referenced as `data:` or `/uploads/...` URLs
   by the server, and they are part of the paper - never cropped, never lazy in
   a way that shifts the layout, always captioned when a caption exists.

   A diagram is drawn for an A4 page but a question row is a fraction of that
   width, so on screen the labels are often too small to read. Every figure is
   therefore a zoom control: clicking opens it full-size on a light surface,
   where the labels are legible. A `thumb` is a deliberate preview (the inline
   editor) and stays inert. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

function useLightbox(open: boolean, onClose: () => void, ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
    }
  }, [open, onClose, ref])
}

function InteractiveSvg({ src, alt }: { src: string; alt?: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [hovered, setHovered] = useState<{ label: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (src.startsWith('data:image/svg+xml')) {
      const parts = src.split(',')
      const payload = parts[1]
      try {
        const decoded = src.includes(';base64,') ? atob(payload) : decodeURIComponent(payload)
        setSvg(decoded)
      } catch (e) {
        setSvg(null)
      }
    } else {
      setSvg(null)
    }
  }, [src])

  if (!svg) return <img src={src} alt={alt} />

  const handleMouseMove = (e: React.MouseEvent) => {
    const target = e.target as SVGElement
    const g = target.closest('g[data-label]')
    if (g) {
      const label = g.getAttribute('data-label')
      if (label) {
        setHovered({ label, x: e.clientX, y: e.clientY })
        return
      }
    }
    setHovered(null)
  }

  return (
    <div
      className="interactive-figure"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHovered(null)}
      style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        style={{ width: '100%', height: '100%' }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {hovered && (
        <div
          style={{
            position: 'fixed',
            left: hovered.x + 12,
            top: hovered.y + 12,
            backgroundColor: 'rgba(0,0,0,0.85)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 12,
            pointerEvents: 'none',
            zIndex: 10000,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        >
          {hovered.label}
        </div>
      )}
      <style>{`
        .interactive-figure g[data-label] { cursor: help; pointer-events: all; transition: opacity 0.2s; }
        .interactive-figure g[data-label]:hover { opacity: 0.7; filter: brightness(1.2); }
      `}</style>
    </div>
  )
}

/* Full-size view of one figure. Kept separate from Figure so a caller can open
   a diagram from anywhere - the exam sheet, a result review, a search hit. */
export function FigureLightbox({
  src,
  alt,
  caption,
  onClose,
  actions,
}: {
  src: string
  alt?: string
  caption?: string | null
  onClose: () => void
  actions?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [explore, setExplore] = useState(false)
  useLightbox(true, onClose, ref)

  const isSvg = src.includes('svg')

  return createPortal(
    <>
      <div className="fig-scrim" onClick={onClose} />
      <div
        ref={ref}
        className="fig-zoom"
        role="dialog"
        aria-modal="true"
        aria-label={caption || alt || 'Question figure'}
        tabIndex={-1}
      >
        <header className="fig-zoom-head">
          <div className="min-w-0">
            {caption ? <p className="fig-zoom-kicker">{caption}</p> : null}
            <h2>Figure</h2>
          </div>
          <div className="fig-zoom-actions">
            {actions}
            {isSvg && (
              <button
                className={`btn sm ${explore ? 'primary' : 'secondary'}`}
                onClick={() => setExplore(!explore)}
                title="Explore parts of this diagram"
              >
                <Icon name="sparkle" size={13} /> {explore ? 'Exploring...' : 'Explore'}
              </button>
            )}
            <a className="btn secondary sm" href={src} download="figure.svg" style={{ textDecoration: 'none' }}>
              <Icon name="download" size={13} /> Save
            </a>
            <button className="btn ghost sm" onClick={onClose} aria-label="Close figure">
              <Icon name="x" size={14} /> Close
            </button>
          </div>
        </header>
        <div className="fig-zoom-stage">
          {explore ? (
            <InteractiveSvg src={src} alt={alt} />
          ) : (
            <img src={src} alt={alt ?? caption ?? 'Question figure'} />
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}

export function Figure({
  src,
  alt,
  caption,
  thumb,
  className = '',
  zoom = true,
}: {
  src?: string | null
  alt?: string
  caption?: string | null
  thumb?: boolean
  className?: string
  /** Thumbs and printed copies never open the lightbox. */
  zoom?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!src) return null

  const inner = (
    <>
      <img src={src} alt={alt ?? caption ?? 'Question figure'} loading="lazy" />
      {zoom && !thumb ? (
        <span className="fig-zoom-hint" aria-hidden="true">
          <Icon name="maximize" size={12} /> Zoom
        </span>
      ) : null}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </>
  )

  if (!zoom || thumb) {
    return <figure className={`q-figure ${thumb ? 'thumb' : ''} ${className}`.trim()}>{inner}</figure>
  }

  return (
    <>
      <figure className={`q-figure ${className}`.trim()}>
        <button
          type="button"
          className="fig-trigger"
          onClick={() => setOpen(true)}
          aria-label={`Zoom ${caption || alt || 'question figure'}`}
        >
          {inner}
        </button>
      </figure>
      {open ? <FigureLightbox src={src} alt={alt} caption={caption} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/* A4-only blocks. A candidate can print the paper and sit it on the desk, and
   the marks grid at the end is printed but never shown on screen. */
export function A4Only({ children }: { children: ReactNode }) {
  return <div className="a4">{children}</div>
}

export function NoPrint({ children }: { children: ReactNode }) {
  return <div className="no-print">{children}</div>
}
