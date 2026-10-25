import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { Button } from './Button'

/* Loading, empty and error states. Each one is a designed screen, not a
   spinner in a void: they say what is happening, what is missing, and what
   the one useful next action is. */

export function Spinner({ size = 'md', label }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  return (
    <span className="spinner" data-size={size} role="status">
      <svg viewBox="0 0 24 24" width={size === 'lg' ? 26 : size === 'sm' ? 15 : 20} aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
        <path d="M21 12a9 9 0 00-9-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {label ? <span>{label}</span> : null}
      {!label ? <span className="sr-only">Loading</span> : null}
    </span>
  )
}

export function Skeleton({
  w,
  h = 12,
  r,
  className = '',
  style,
}: {
  w?: number | string
  h?: number | string
  r?: number
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      className={`skeleton ${className}`}
      style={{ width: w, height: h, borderRadius: r, display: 'block', ...style }}
      aria-hidden="true"
    />
  )
}

/* A skeleton that matches the shape of a real table, so the page does not
   jump when the data lands. */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="skel-table" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div className="skel-row" key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} h={11} w={c === 0 ? '38%' : c === cols - 1 ? '11%' : '22%'} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ count = 3, height = 108 }: { count?: number; height?: number }) {
  return (
    <div className="grid-3" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-card" key={i} style={{ height }}>
          <Skeleton h={9} w="42%" />
          <Skeleton h={30} w="66%" />
          <Skeleton h={9} w="80%" />
        </div>
      ))}
    </div>
  )
}

export function EmptyState({
  icon = 'inbox',
  title,
  body,
  action,
  secondary,
  compact,
}: {
  icon?: IconName
  title: string
  body?: ReactNode
  action?: { label: string; onClick: () => void; icon?: IconName; href?: string }
  secondary?: { label: string; onClick: () => void; icon?: IconName }
  compact?: boolean
}) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <span className="empty-icon">
        <Icon name={icon} size={compact ? 17 : 21} />
      </span>
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action || secondary ? (
        <div className="empty-actions">
          {action ? (
            <Button variant="primary" icon={action.icon} onClick={action.onClick} as={action.href ? 'a' : 'button'} href={action.href}>
              {action.label}
            </Button>
          ) : null}
          {secondary ? (
            <Button variant="quiet" icon={secondary.icon} onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  body,
  onRetry,
}: {
  title?: string
  body?: ReactNode
  onRetry?: () => void
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon bad">
        <Icon name="warn" size={21} />
      </span>
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {onRetry ? (
        <div className="empty-actions">
          <Button variant="secondary" icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function BootScreen({ line = 'Opening the hall' }: { line?: string }) {
  return (
    <div className="boot">
      <span className="seal lg">T</span>
      <p className="boot-title">T. Gold Brighter Tomorrow</p>
      <div className="boot-line">
        <i />
      </div>
      <p className="boot-note">{line}…</p>
    </div>
  )
}

export function Notice({
  tone = 'info',
  icon,
  children,
  action,
}: {
  tone?: 'info' | 'good' | 'warn' | 'bad'
  icon?: IconName
  children: ReactNode
  action?: { label: string; onClick: () => void }
}) {
  const fallback: Record<string, IconName> = {
    info: 'info',
    good: 'checkCircle',
    warn: 'warn',
    bad: 'xCircle',
  }
  return (
    <div className={`notice ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon name={icon ?? fallback[tone]} size={15} />
      <div className="grow">{children}</div>
      {action ? (
        <Button variant="ghost" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
