import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export type Tone = 'neutral' | 'chalk' | 'jade' | 'vermilion' | 'brass' | 'gold'

/* The tag. One component for every status in the app; the tone carries the
   meaning, never a colour name. Semantics:
     chalk     — in progress, selected, teacher-owned
     jade      — correct, passed, ready, done
     vermilion — wrong, overdue, destructive
     brass     — needs a human decision
     gold      — the school seal only */
export function Tag({
  children,
  tone = 'neutral',
  icon,
  dot,
  outline,
  title,
}: {
  children: ReactNode
  tone?: Tone
  icon?: IconName
  dot?: boolean
  outline?: boolean
  title?: string
}) {
  const cls = ['tag', tone === 'neutral' ? '' : tone, outline ? 'outline' : '', dot ? 'dot' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <span className={cls} title={title}>
      {icon ? <Icon name={icon} size={11} /> : null}
      {children}
    </span>
  )
}

const DIFF_TONE: Record<string, Tone> = { easy: 'jade', medium: 'brass', hard: 'vermilion' }

export function DifficultyTag({ value }: { value?: string | null }) {
  if (!value) return null
  return <Tag tone={DIFF_TONE[value.toLowerCase()] ?? 'neutral'}>{value}</Tag>
}

/* A status pill with a leading mark. Used in list rows where the state is the
   first thing to read. */
export function StatusPill({
  children,
  tone = 'neutral',
  icon,
}: {
  children: ReactNode
  tone?: Tone
  icon?: IconName
}) {
  return (
    <span className={`pill pill-${tone}`}>
      {icon ? <Icon name={icon} size={12} /> : <i className="pill-dot" />}
      {children}
    </span>
  )
}
