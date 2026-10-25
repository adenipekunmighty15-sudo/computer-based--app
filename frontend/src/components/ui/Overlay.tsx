import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'
import { Button } from './Button'

/* Overlays. Three of them, and they mean different things:

   Modal   "stop and decide" — blocks the page, must be answered or dismissed
   Drawer  "look at this beside what you were doing" — the list stays alive
   Menu    "one of several things" — anchored to the control that opened it

   Keeping them distinct is most of why the app never feels like a pile of
   dialogs. */

/* Escape closes, the page behind stops scrolling, and focus lands inside.
   That is the whole contract; every overlay in the app honours it. */
function useOverlay(onClose: (() => void) | undefined, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
      if (e.key === 'Tab' && ref.current) {
        const focusable = ref.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
    }
  }, [onClose, ref])
}

export function Modal({
  open,
  onClose,
  title,
  kicker,
  children,
  actions,
  width,
  tone,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  kicker?: ReactNode
  children: ReactNode
  actions?: ReactNode
  width?: number
  tone?: 'danger'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(open ? onClose : undefined, ref)
  if (!open) return null
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div
        ref={ref}
        className={`modal ${tone === 'danger' ? 'modal-danger' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        style={width ? { width: `min(100% - 32px, ${width}px)` } : undefined}
      >
        <header className="modal-head">
          {kicker ? <p className="kicker">{kicker}</p> : null}
          <h2>{title}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </>,
    document.body,
  )
}

export function Drawer({
  open,
  onClose,
  title,
  kicker,
  children,
  footer,
  width,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  kicker?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(open ? onClose : undefined, ref)
  if (!open) return null
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <aside
        ref={ref}
        className="drawer"
        role="dialog"
        aria-modal="true"
        style={width ? { width: `min(100%, ${width}px)` } : undefined}
      >
        <header className="drawer-head">
          <div className="min-w-0">
            {kicker ? <p className="kicker">{kicker}</p> : null}
            <h2>{title}</h2>
          </div>
          <Button variant="ghost" size="sm" icon="x" onClick={onClose} data-tip="Close" aria-label="Close" />
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </aside>
    </>,
    document.body,
  )
}

/* An anchored menu. Positioned by the caller with `style`; the app only ever
   aligns these to the right edge of the button that opened them. */
export function Menu({
  open,
  onClose,
  anchorRef,
  children,
  align = 'end',
  width,
}: {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
  children: ReactNode
  align?: 'start' | 'end'
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<'below' | 'above'>('below')

  useEffect(() => {
    if (!open || !anchorRef.current) return
    const r = anchorRef.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    setPos(below < 220 && r.top > below ? 'above' : 'below')
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if (anchorRef.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, { once: true })
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, anchorRef, onClose])

  if (!open || !anchorRef.current) return null

  const r = anchorRef.current.getBoundingClientRect()
  const top = pos === 'below' ? r.bottom + 6 : undefined
  const bottom = pos === 'above' ? window.innerHeight - r.top + 6 : undefined

  return createPortal(
    <div
      ref={ref}
      className="popover"
      data-align={align}
      role="menu"
      style={{
        position: 'fixed',
        top,
        bottom,
        left: align === 'end' ? r.right : r.left,
        translate: align === 'end' ? '-100% 0' : '0 0',
        width,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="popover-label">{children}</p>
}

export function MenuItem({
  children,
  onClick,
  icon,
  checked,
  danger,
  disabled,
  hint,
  href,
}: {
  children: ReactNode
  onClick?: () => void
  icon?: IconName
  checked?: boolean
  danger?: boolean
  disabled?: boolean
  hint?: ReactNode
  href?: string
}) {
  const cls = ['menu-item', danger ? 'danger' : '', checked ? 'on' : ''].filter(Boolean).join(' ')
  const inner = (
    <>
      {icon ? <Icon name={icon} size={14} /> : checked !== undefined ? <span className="menu-tick">{checked ? '✓' : ''}</span> : null}
      <span className="grow truncate">{children}</span>
      {hint ? <span className="menu-hint">{hint}</span> : null}
    </>
  )
  if (href) {
    return (
      <a className={cls} href={href} role="menuitem">
        {inner}
      </a>
    )
  }
  return (
    <button className={cls} role="menuitem" onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  )
}

export function MenuSep() {
  return <div className="menu-sep" role="separator" />
}

import { useState } from 'react'
