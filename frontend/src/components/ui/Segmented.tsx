import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/* A segmented control for 2–4 mutually exclusive options in one row. More
   than four and it stops being a control and starts being a menu. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  grow,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: ReactNode; icon?: IconName; title?: string }[]
  onChange: (v: T) => void
  grow?: boolean
  ariaLabel?: string
}) {
  return (
    <div className={`segmented ${grow ? 'grow' : ''}`} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          title={o.title}
        >
          {o.icon ? <Icon name={o.icon} size={13} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* Tabs switch a view inside a page; they are never navigation. */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: ReactNode; icon?: IconName; count?: number | string }[]
  onChange: (v: T) => void
  ariaLabel?: string
}) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.icon ? <Icon name={o.icon} size={14} /> : null}
          {o.label}
          {o.count !== undefined ? <span className="tab-count num">{o.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/* A filter chip that opens a menu. `count` shows how many are currently set, so
   an applied filter is never invisible. */
export function FilterChip({
  children,
  count,
  open,
  onToggle,
  icon,
}: {
  children: ReactNode
  count?: number
  open?: boolean
  onToggle: () => void
  icon?: IconName
}) {
  return (
    <button className="chip-filter" aria-expanded={open} onClick={onToggle} type="button">
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
      {count ? <span className="n num">{count}</span> : null}
      <Icon name="chevron" size={11} className="caret" />
    </button>
  )
}

/* A removable chip — the record that a filter is applied. */
export function Chip({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <span className="chip">
      {children}
      <button onClick={onRemove} aria-label="Remove filter">
        <Icon name="x" size={10} />
      </button>
    </span>
  )
}
