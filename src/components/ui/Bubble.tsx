import { type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/* The OMR bubble — the app's one repeated atom.

   An optical-mark-recognition answer sheet is the oldest interface this
   product has: a column of bubbles you fill with a pencil. Every status in
   the app is one of these, so a teacher who learned the answer sheet in
   year 9 can read a question list, a mark sheet and a KPI without a legend. */

export type BubbleState =
  | 'blank'
  | 'answered'
  | 'chosen'
  | 'flagged'
  | 'correct'
  | 'wrong'
  | 'skipped'
  | 'current'

const SIZES = { xs: 'xs', sm: 'sm', md: '', lg: 'lg', xl: 'xl' } as const

export function Bubble({
  state = 'blank',
  size = 'md',
  children,
  onClick,
  title,
  just,
  ...rest
}: {
  state?: BubbleState
  size?: keyof typeof SIZES
  children?: ReactNode
  onClick?: () => void
  title?: string
  just?: boolean
} & Record<string, unknown>) {
  const cls = ['bubble', SIZES[size], state === 'blank' ? '' : '', state === 'current' ? '' : '']
    .filter(Boolean)
    .join(' ')
  const data = { 'data-state': state === 'blank' ? undefined : state, 'data-just': just || undefined }
  if (onClick) {
    return (
      <button className={cls} onClick={onClick} title={title} {...data} {...rest}>
        {children}
      </button>
    )
  }
  return (
    <span className={cls} title={title} {...data} {...rest}>
      {children}
    </span>
  )
}

/* A run of bubbles — the answer-sheet column, or a candidate's mark on a mark
   sheet. `col` stacks them; the horizontal form is a paper answer strip. */
export function BubbleRun({
  children,
  col,
  className = '',
}: {
  children: ReactNode
  col?: boolean
  className?: string
}) {
  return <div className={`bubble-run ${col ? 'col' : ''} ${className}`}>{children}</div>
}

export function Meter({
  value,
  max = 1,
  tone,
  size = 'md',
  label,
}: {
  value: number
  max?: number
  tone?: 'good' | 'warn' | 'bad'
  size?: 'md' | 'lg'
  label?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      className={`meter ${tone ?? ''} ${size === 'lg' ? 'lg' : ''}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <i style={{ width: `${pct}%` }} />
    </div>
  )
}

/* The shape of a class at a glance. Segments always have a legend on the same
   screen — a stacked bar with no key is decoration, not data. */
export function StackBar({
  segments,
}: {
  segments: { value: number; color: string; label: string }[]
}) {
  const total = segments.reduce((a, s) => a + s.value, 0)
  if (total <= 0) return <div className="stack-bar" />
  return (
    <div className="stack-bar">
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <span
            key={s.label}
            style={{ flexGrow: s.value, background: s.color }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
    </div>
  )
}

export function Legend({ items }: { items: { color: string; label: string; value?: ReactNode }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label} className="legend-item">
          <i style={{ background: i.color }} />
          {i.label}
          {i.value !== undefined ? <b className="num">{i.value}</b> : null}
        </span>
      ))}
    </div>
  )
}

/* Status marks that are not bubbles: a check, a cross, a clock. Used where the
   state is a single verdict rather than one of a run. */
export function Mark({
  icon,
  tone,
  size = 'md',
}: {
  icon: IconName
  tone: 'jade' | 'vermilion' | 'brass' | 'chalk'
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <span className={`mark mark-${tone} mark-${size}`}>
      <Icon name={icon} size={size === 'lg' ? 20 : size === 'sm' ? 12 : 15} />
    </span>
  )
}
