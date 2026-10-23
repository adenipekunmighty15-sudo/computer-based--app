import { type ReactNode } from 'react'
import { Spinner } from '../ui'

interface ToolPanelProps {
  id: string
  icon: string
  title: string
  subtitle: ReactNode
  children: ReactNode
  onRun: () => void
  disabled: boolean
  busyLabel: string
}

export function ToolPanel({ id, icon, title, subtitle, children, onRun, disabled, busyLabel }: ToolPanelProps) {
  return (
    <form
      id={id}
      onSubmit={(e) => {
        e.preventDefault()
        onRun()
      }}
    >
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 16 }}>
              <span className="tile-icon" style={{ width: 32, height: 32, fontSize: 15 }} aria-hidden="true">{icon}</span>
              {title}
            </h2>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>{subtitle}</p>
          </div>
        </div>
        <div className="panel-body">
          {children}
          <div style={{ marginTop: 16 }}>
            <button type="submit" className="btn primary" disabled={disabled} style={{ minWidth: 140 }}>
              {disabled ? <><Spinner size="sm" label="" /> {busyLabel}</> : 'Run'}
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}
