import { type ReactNode } from 'react'
import { Tag } from '../ui'

/* The page masthead.

   A page opens by answering two questions: where am I, and what can I do from
   here. So the head is title and one line of consequence on the left, actions on
   the right, and an optional progress hairline for the two places that are
   genuinely a process rather than a place — the AI Lab and a student's paper. */

export function PageHead({
  title,
  tagline,
  kicker,
  actions,
  status,
  progress,
}: {
  title: string
  tagline?: ReactNode
  kicker?: ReactNode
  actions?: ReactNode
  status?: ReactNode
  /** 0–100. Only for flows, not for pages. */
  progress?: number
}) {
  return (
    <header className="page-head">
      <div className="min-w-0">
        {kicker ? <p className="kicker">{kicker}</p> : null}
        <h1>{title}</h1>
        {tagline ? <p className="sub">{tagline}</p> : null}
      </div>
      {actions || status ? (
        <div className="page-head-actions">
          {status}
          {actions}
        </div>
      ) : null}
      {progress !== undefined ? (
        <div
          className="head-progress"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${title} progress`}
        >
          <i style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      ) : null}
    </header>
  )
}

/* Whether the AI Lab can actually run. Shown as a status tag rather than a
   warning banner: a teacher with keys configured should never have to think
   about it again, and one without should be told once, quietly. */
export function ModelStatus({ readyCount }: { readyCount: number }) {
  if (readyCount > 0) {
    return (
      <Tag tone="jade" dot>
        {readyCount} AI model{readyCount === 1 ? '' : 's'} ready
      </Tag>
    )
  }
  return <Tag tone="brass" dot>No AI keys configured</Tag>
}
