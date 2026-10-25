import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/* Scroll reveal, for long reading surfaces only.

   Two rules keep this honest. It is opt-in — a table of 200 rows must not
   animate in, so nothing wraps itself in this by default. And it is a one-shot:
   once shown, the observer disconnects, because a card that re-animates every
   time it scrolls back into view is noise.

   `.reveal` already collapses to a no-op under both `prefers-reduced-motion`
   and the in-app motion preference, so this component does not check either —
   it only has to make sure the content is *reachable* if the observer never
   fires. */

export function Reveal({
  children,
  delay = 0,
  className = '',
  as: As = 'div',
}: {
  children: ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'section' | 'li' | 'article'
}) {
  const ref = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const el = ref.current
    if (!el || shown || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown])

  return (
    <As
      ref={ref as never}
      className={`reveal${shown ? ' in' : ''}${className ? ` ${className}` : ''}`}
      style={delay ? ({ '--reveal-delay': `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </As>
  )
}

/* A page arriving. One animation on the route change, never on the children —
   the eye needs to be told once that it is somewhere new, and a screen where
   everything staggers in is a screen nobody can read. */
export function PageEnter({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`page-enter ${className}`.trim()}>{children}</div>
}
