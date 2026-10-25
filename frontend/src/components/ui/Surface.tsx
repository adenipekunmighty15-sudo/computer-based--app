import type { ReactNode } from 'react'

/* Surfaces. The app has exactly two registers — the dark hall for chrome and
   the light sheet for anything read at length — and every box in it is one of
   those. Panel is the default; Card is the one you can pick up. */

export function Panel({
  title,
  kicker,
  actions,
  children,
  flush,
  className = '',
  bodyClassName = '',
}: {
  title?: ReactNode
  kicker?: ReactNode
  actions?: ReactNode
  children: ReactNode
  flush?: boolean
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <div className="min-w-0">
            {kicker ? <p className="kicker">{kicker}</p> : null}
            {title ? <h2>{title}</h2> : null}
          </div>
          {actions ? <div className="panel-head-actions">{actions}</div> : null}
        </header>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''} ${bodyClassName}`}>{children}</div>
    </section>
  )
}

export function Card({
  children,
  edge,
  interactive,
  as: As = 'div',
  className = '',
  ...rest
}: {
  children: ReactNode
  edge?: string
  interactive?: boolean
  as?: 'div' | 'a' | 'button'
  className?: string
} & Record<string, unknown>) {
  const cls = ['card', interactive ? 'interactive' : '', edge ? 'card-edge' : '', className]
    .filter(Boolean)
    .join(' ')
  const style = edge ? ({ '--edge': edge } as React.CSSProperties) : undefined
  return (
    <As className={cls} style={style} {...rest}>
      {children}
    </As>
  )
}

/* The school seal. Gold lives here and on the exam masthead, nowhere else. */
export function Seal({ initials = 'T', size = 'md' }: { initials?: string; size?: 'md' | 'lg' }) {
  return <span className={`seal ${size === 'lg' ? 'lg' : ''}`}>{initials}</span>
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span className={`avatar ${size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : ''}`} aria-hidden="true">
      {initials || '—'}
    </span>
  )
}
