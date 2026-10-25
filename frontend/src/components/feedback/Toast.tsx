import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../ui'

/* Toasts. Confirmation that something happened and nothing more — a save, a
   copy, a failure. Never used for something the user must act on; that gets a
   modal. They expire, they stack, and they can be dismissed by clicking. */

export type ToastTone = 'success' | 'error' | 'info' | 'warn'

interface ToastItem {
  id: number
  tone: ToastTone
  message: string
  action?: { label: string; onClick: () => void }
}

let pushRef: ((t: Omit<ToastItem, 'id'>) => void) | null = null
let seq = 0

const ICONS: Record<ToastTone, IconName> = {
  success: 'check',
  error: 'x',
  info: 'info',
  warn: 'warn',
}

const TTL: Record<ToastTone, number> = {
  success: 3200,
  info: 4200,
  warn: 6000,
  error: 7000,
}

export function notify(tone: ToastTone, message: string, action?: ToastItem['action']) {
  pushRef?.({ tone, message, action })
}

export const toastOk = (m: string) => notify('success', m)
export const toastErr = (m: string) => notify('error', m)
export const toastInfo = (m: string) => notify('info', m)

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setItems((x) => x.filter((i) => i.id !== id))
  }, [])

  useEffect(() => {
    pushRef = (t) => {
      const id = ++seq
      setItems((x) => [...x.slice(-3), { ...t, id }])
      window.setTimeout(() => dismiss(id), TTL[t.tone])
    }
    return () => {
      pushRef = null
    }
  }, [dismiss])

  return (
    <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone === 'warn' ? 'info' : t.tone}`} style={t.tone === 'warn' ? { borderLeftColor: 'var(--brass)' } : undefined}>
          <span className="toast-icon">
            <Icon name={ICONS[t.tone]} size={11} />
          </span>
          <span className="toast-msg">{t.message}</span>
          {t.action ? (
            <button
              className="toast-action"
              onClick={() => {
                t.action?.onClick()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" data-tip="Dismiss">
            <Icon name="x" size={10} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ToastHost />
    </>
  )
}
