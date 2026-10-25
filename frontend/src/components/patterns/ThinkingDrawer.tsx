import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { PaperStep } from '../../api'
import { Button, Icon, type IconName, Spinner, Tag } from '../ui'

// The live transcript Exam Sheet shows while a paper is being written. It is a
// drawer, not a modal, on purpose: the teacher keeps their place in the sheet
// while the generation runs, and every real unit of work (a section written, a
// figure drawn, a retry) shows up the moment the server has it.

export interface ThinkingState {
  steps: PaperStep[]
  status: 'running' | 'done' | 'error' | 'cancelled'
  error: string | null
}

const ICON_FOR: Record<PaperStep['phase'], IconName> = {
  begin: 'sparkle',
  plan: 'list',
  section: 'book',
  progress: 'check',
  figures: 'image',
  figure: 'image',
  web: 'search',
  warn: 'warn',
  done: 'checkCircle',
}

function formatAt(at: number) {
  return new Date(at).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })
}

function StepRow({ step, last }: { step: PaperStep; last: boolean }) {
  const chip =
    step.phase === 'section' ? (
      <Tag tone="chalk" dot>{step.section}</Tag>
    ) : step.phase === 'progress' ? (
      <Tag tone="chalk">{`${step.done ?? 0} of ${step.count ?? ''}`.trim()}</Tag>
    ) : step.phase === 'figure' ? (
      <Tag tone="chalk">{`${step.done ?? 0} of ${step.wanted ?? ''}`.trim()}</Tag>
    ) : step.phase === 'figures' ? (
      <Tag tone="brass" icon="image">{step.wanted ?? 0} to draw</Tag>
    ) : step.phase === 'web' ? (
      <Tag tone="jade" icon="search">web</Tag>
    ) : step.phase === 'warn' ? (
      <Tag tone="brass" icon="warn">retry</Tag>
    ) : step.phase === 'done' ? (
      <Tag tone="jade" icon="check">ready</Tag>
    ) : step.phase === 'plan' ? (
      <Tag tone="chalk" icon="list">plan</Tag>
    ) : step.phase === 'begin' ? null : null

  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
      <Icon
        name={step.phase === 'warn' ? 'warn' : step.phase === 'done' ? 'checkCircle' : ICON_FOR[step.phase]}
        size={14}
        style={{
          marginTop: 2,
          color: step.phase === 'warn' || step.phase === 'web' || step.phase === 'plan' ? 'var(--gold)' : 'var(--mint, var(--gold))',
          opacity: step.phase === 'begin' || step.phase === 'progress' ? 0.55 : 1,
        }}
      />
      <div className="grow min-w-0">
        <p style={{ margin: 0, fontSize: 'var(--t-sm)', lineHeight: 1.45 }}>
          {step.message}
          {last ? <span className="tag chalk dot" style={{ marginLeft: 8 }}>now</span> : null}
        </p>
        {step.phase === 'plan' && step.lines && step.lines.length ? (
          <div style={{ display: 'grid', gap: 3, marginTop: 6, paddingLeft: 4 }}>
            {step.lines.map((line, i) => (
              <p key={i} className="hint" style={{ margin: 0, fontSize: 'var(--t-sm)', lineHeight: 1.45 }}>{line}</p>
            ))}
          </div>
        ) : null}
        {chip ? <div style={{ marginTop: 3 }}>{chip}</div> : null}
      </div>
      <span className="hint" style={{ fontSize: 'var(--t-2xs)', opacity: 0.55, flex: '0 0 auto' }}>{formatAt(step.at)}</span>
    </div>
  )
}

export function ThinkingDrawer({
  thinking,
  onCancel,
  onClose,
  texts,
}: {
  thinking: ThinkingState
  onCancel: () => void
  onClose: () => void
  texts?: {
    kicker?: string
    running?: string
    done?: string
    cancelled?: string
    error?: string
    readyNote?: string
  }
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const running = thinking.status === 'running'

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thinking.steps.length])

  useEffect(() => {
    if (running) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [running, onClose])

  const headline =
    texts?.running && texts?.done && texts?.cancelled && texts?.error
      ? running ? texts.running
        : thinking.status === 'done' ? texts.done
          : thinking.status === 'cancelled' ? texts.cancelled
            : texts.error
      : running ? 'Generating paper…'
        : thinking.status === 'done' ? 'Paper ready'
          : thinking.status === 'cancelled' ? 'Generation cancelled'
            : 'Generation problem'

  return createPortal(
    <>
      <div className="scrim" onClick={running ? undefined : onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={texts?.kicker ?? 'Paper generation progress'}>
        <header className="drawer-head">
          <div className="min-w-0">
            <p className="kicker">{texts?.kicker ?? 'Exam sheet'}</p>
            <h2>{headline}</h2>
          </div>
          {running ? <Spinner size="sm" /> : <Button variant="ghost" size="sm" icon="x" onClick={onClose} data-tip="Close" aria-label="Close" />}
        </header>
        <div className="drawer-body" ref={scroller}>
          <div style={{ display: 'grid', gap: 10 }}>
            {thinking.steps.length === 0 ? <p className="hint" style={{ margin: 0 }}>Waiting for the server to start…</p> : null}
            {thinking.steps.map((step, i) => (
              <StepRow key={i} step={step} last={running && i === thinking.steps.length - 1} />
            ))}
            {thinking.error ? (
              <p style={{ margin: '6px 0 0', fontSize: 'var(--t-sm)', color: 'var(--gold)' }}>{thinking.error}</p>
            ) : null}
            {!running && thinking.status !== 'error' && thinking.status !== 'cancelled' ? (
              <p className="hint" style={{ margin: '6px 0 0' }}>{texts?.readyNote ?? 'Done — the paper is loading below.'}</p>
            ) : null}
          </div>
        </div>
        <footer className="drawer-foot">
          {running ? (
            <Button variant="danger" icon="x" onClick={onCancel}>Cancel generation</Button>
          ) : (
            <Button variant="primary" icon="check" onClick={onClose}>Done</Button>
          )}
        </footer>
      </aside>
    </>,
    document.body,
  )
}