import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/* A KPI is a number, a label, and — if there is one worth having — a trend.
   The three always appear in that order, top to bottom, in every screen. */

export function Kpi({
  label,
  value,
  unit,
  icon,
  foot,
  delta,
  onClick,
  href,
  tone,
  spark,
}: {
  label: string
  value: ReactNode
  unit?: string
  icon?: IconName
  foot?: ReactNode
  delta?: { value: number; suffix?: string }
  onClick?: () => void
  href?: string
  tone?: 'chalk' | 'jade' | 'vermilion' | 'brass'
  spark?: number[]
}) {
  const inner = (
    <>
      <p className="kpi-label">
        {icon ? <Icon name={icon} size={12} /> : null}
        {label}
      </p>
      <p className={`kpi-value ${tone ? `kpi-${tone}` : ''}`}>
        {value}
        {unit ? <span className="kpi-unit">{unit}</span> : null}
      </p>
      {spark && spark.length > 1 ? <Spark data={spark} /> : null}
      <p className="kpi-foot">
        {delta ? <Delta d={delta} /> : null}
        {foot}
      </p>
    </>
  )
  if (href) {
    return (
      <a className="kpi" href={href}>
        {inner}
      </a>
    )
  }
  if (onClick) {
    return (
      <button className="kpi" onClick={onClick}>
        {inner}
      </button>
    )
  }
  return <div className="kpi">{inner}</div>
}

function Delta({ d }: { d: { value: number; suffix?: string } }) {
  if (d.value === 0) return <span className="kpi-delta flat">—</span>
  const dir = d.value > 0 ? 'up' : 'down'
  return (
    <span className={`kpi-delta ${dir}`}>
      {d.value > 0 ? '▲' : '▼'} {Math.abs(d.value)}
      {d.suffix ?? '%'}
    </span>
  )
}

/* A real sparkline, not an icon. It is the only place a trend is drawn, and it
   never appears without the number it describes directly above it. */
export function Spark({ data, width = 200, height = 30 }: { data: number[]; width?: number; height?: number }) {
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const step = data.length > 1 ? width / (data.length - 1) : width
  const pts = data.map((v, i) => [i * step, height - ((v - min) / span) * (height - 5) - 2.5] as const)
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L${width} ${height} L0 ${height} Z`
  const last = pts[pts.length - 1]
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="area" d={area} />
      <path className="line" d={line} />
      <circle cx={last[0]} cy={last[1]} r="2.5" />
    </svg>
  )
}

export function KpiRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`kpis ${className}`}>{children}</div>
}
