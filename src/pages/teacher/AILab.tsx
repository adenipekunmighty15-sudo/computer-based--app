import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, type AiEngineResult, type AiJob, type AiModelInfo, type DuplicateHit, type FigureStyle, type Question, type QuestionType } from '../../api'
import { MathText, Spinner, Figure, Segmented, Icon, Modal, type IconName } from '../../components/ui'
import { ConfirmDialog, notify } from '../../components/feedback'
import { ThinkingDrawer, type ThinkingState } from '../../components/patterns/ThinkingDrawer'
import { ExamSheetTool } from './ExamSheet'

type Tab = 'sheet' | 'questions' | 'paper' | 'pictures'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'sheet', label: 'Exam sheet', icon: 'file' },
  { id: 'questions', label: 'Questions', icon: 'edit' },
  { id: 'paper', label: 'Full paper', icon: 'book' },
  { id: 'pictures', label: 'Pictures', icon: 'image' },
]

/* ── small shared helpers ─────────────────────────────────────────────── */

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

// A 40-60s generation with a static spinner reads as a hang. Showing elapsed
// time tells the teacher the request is alive and how long to expect. start()
// is called from the click handler; the effect only owns the ticking interval.
function useElapsed() {
  const [since, setSince] = useState<number | null>(null)
  const [ms, setMs] = useState(0)
  useEffect(() => {
    if (since === null) return
    const id = setInterval(() => setMs(Date.now() - since), 500)
    return () => clearInterval(id)
  }, [since])
  const start = useCallback(() => {
    setSince(Date.now())
    setMs(0)
  }, [])
  const stop = useCallback(() => setSince(null), [])
  return { ms, start, stop, running: since !== null }
}

const CLASS_LEVELS = ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3']

/* ── how many questions get a picture ─────────────────────────────────────
   A 30-question request should come back with about ten illustrated questions,
   not zero and not thirty. The teacher sets the number; the server decides
   *which* ones — a question that says "in the diagram below" gets the picture,
   a definitions question does not.

   The default follows the batch size until the teacher touches the control, at
   which point their number is kept. Not capped: a teacher asking for a diagram
   on every question gets one on every question, and the server's wall-clock
   budget scales with the count rather than quietly returning a tenth of them. */

const AUTO_FIGURE_CAP = 1000
const autoFigures = (total: number) => (total <= 0 ? 0 : Math.min(AUTO_FIGURE_CAP, Math.max(1, Math.round(total / 3))))

type FigurePlan = {
  count: number
  style: FigureStyle
  auto: boolean
  setCount: (n: number) => void
  useAuto: () => void
  setStyle: (s: FigureStyle) => void
}

function useFigurePlan(total: number): FigurePlan {
  // `manual` is null until the teacher touches the control. While it is null the
  // count is derived from the batch size, so asking for 60 questions quietly
  // offers 20 pictures instead of the 10 that suited 30 — with no effect and no
  // cascading render.
  const [manual, setManual] = useState<number | null>(null)
  const [style, setStyle] = useState<FigureStyle>('pencil')
  const auto = manual === null
  const count = auto ? autoFigures(total) : Math.max(0, Math.min(AUTO_FIGURE_CAP, manual))

  const setCount = useCallback((n: number) => {
    setManual(Math.max(0, Math.min(AUTO_FIGURE_CAP, Math.round(n) || 0)))
  }, [])

  const useAuto = useCallback(() => setManual(null), [])

  return { count, style, auto, setCount, useAuto, setStyle }
}

/* The diagram control. One row: how many, a slider, four presets, and the
   drawing style. Deliberately small — pictures are a property of the batch, not
   a second wizard. */
function FigureControls({ total, plan }: { total: number; plan: FigurePlan }) {
  const max = Math.min(AUTO_FIGURE_CAP, Math.max(1, total))
  const pct = total > 0 ? Math.round((plan.count / total) * 100) : 0

  return (
    <div className="panel" style={{ marginTop: 10, background: 'var(--slab-2)' }}>
      <div className="panel-body" style={{ display: 'grid', gap: 10, padding: 14 }}>
        <div className="row-between" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="row" style={{ gap: 8 }}>
            <span className="row" style={{ gap: 6, fontSize: 13, fontWeight: 650 }}><Icon name="image" size={14} /> Diagrams</span>
            <span className={`tag ${plan.count > 0 ? 'gold' : ''}`}>
              {plan.count} of {total || 0} question{total === 1 ? '' : 's'}
            </span>
            {plan.auto && total > 0 && <span className="muted" style={{ fontSize: 11 }}>auto · about a third</span>}
          </span>
          <Segmented
            value={plan.style}
            onChange={plan.setStyle}
            ariaLabel="Diagram style"
            options={[
              { value: 'pencil', label: 'Pencil', icon: 'edit' },
              { value: 'clean', label: 'Clean', icon: 'sliders' },
            ]}
          />
        </div>

        <input
          type="range"
          min={0}
          max={max}
          value={Math.min(plan.count, max)}
          onChange={(e) => plan.setCount(Number(e.target.value))}
          aria-label="How many questions get a diagram"
          disabled={total === 0}
          style={{ width: '100%', accentColor: 'var(--role)' }}
        />

        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn secondary sm" onClick={() => plan.setCount(0)}>None</button>
          <button type="button" className="btn secondary sm" onClick={() => plan.setCount(Math.round(total / 3))}>A third</button>
          <button type="button" className="btn secondary sm" onClick={() => plan.setCount(Math.round(total / 2))}>Half</button>
          <button type="button" className="btn secondary sm" onClick={() => plan.setCount(total)}>All</button>
          {!plan.auto && (
            <button type="button" className="btn ghost sm" onClick={plan.useAuto}><Icon name="refresh" size={13} /> Auto</button>
          )}
          <span className="muted" style={{ fontSize: 12, alignSelf: 'center', marginLeft: 'auto' }}>
            {plan.count === 0
              ? 'No diagrams — questions only.'
              : `${pct}% of the batch. The questions that most need a picture are chosen.`}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── engine health ─────────────────────────────────────────────────────── */

type EngineState = {
  models: AiModelInfo[]
  missingKeys: string[]
  health: { total: number; healthy: number; cooling: number } | null
  lastBench: string | null
  benchBusy: boolean
  error: string | null
  refresh: () => void
  runBench: () => void
}

function useEngines(): EngineState {
  const [models, setModels] = useState<AiModelInfo[]>([])
  const [missingKeys, setMissingKeys] = useState<string[]>([])
  const [health, setHealth] = useState<EngineState['health']>(null)
  const [lastBench, setLastBench] = useState<string | null>(null)
  const [benchBusy, setBenchBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api.aiModels()
      .then((r) => {
        setModels(r.models || [])
        setMissingKeys(r.missingKeys || [])
        setHealth(r.health ?? null)
        setLastBench(r.speed?.generatedAt || null)
        setError(null)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Could not reach the AI service')
        setMissingKeys(['check server/.env'])
      })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const runBench = useCallback(async () => {
    setBenchBusy(true)
    try {
      const r = await api.aiBenchmark()
      notify('success', `Speed test done — ${r.winners.length} engines responding.`)
      refresh()
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Speed test failed')
    } finally {
      setBenchBusy(false)
    }
  }, [refresh])

  return { models, missingKeys, health, lastBench, benchBusy, error, refresh, runBench }
}

// One line by default, full per-engine detail on demand. The previous version
// printed every model as an identical green dot, which said nothing about which
// engine would actually serve the next request.
function EngineBar({ engines }: { engines: EngineState }) {
  const [open, setOpen] = useState(false)
  const { models, health, missingKeys, lastBench, benchBusy, error, runBench } = engines
  const healthy = health?.healthy ?? models.filter((m) => !m.cooling).length
  const total = health?.total ?? models.length

  const tone = error ? 'red' : healthy === 0 ? 'red' : healthy < total ? 'gold' : 'green'

  return (
    <div className="panel ai-engines">
      <div className="panel-body row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <button
          className="ai-engine-summary"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
        >
          <span className={`tag ${tone}`}>
            {error ? '● AI service unreachable' : healthy === 0 ? '● No engines ready' : `● ${healthy} of ${total} engines ready`}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            {open ? 'Hide engine detail ▾' : 'Engine detail ▸'}
          </span>
        </button>
        <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
          {lastBench && <span className="muted" style={{ fontSize: 12 }}>Speed test {new Date(lastBench).toLocaleTimeString()}</span>}
          <button className="btn secondary" disabled={benchBusy} onClick={runBench}>
            <>{benchBusy ? <><Spinner size="sm" label="" /> Testing…</> : <><Icon name="gauge" size={14} /> Speed test</>}</>
          </button>
        </div>
      </div>

      {error && <div className="panel-body" style={{ paddingTop: 0 }}><span className="hint" style={{ color: 'var(--vermilion)' }}>{error}</span></div>}

      {open && (
        <div className="panel-body ai-engine-grid" style={{ paddingTop: 0 }}>
          {models.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No engines configured — add keys to server/.env.</span>}
          {models.map((m, i) => {
            const ms = m.liveMs ?? m.latencyMs ?? null
            return (
              <span
                key={`${m.key}-${m.model}-${i}`}
                className={`tag ${m.cooling ? 'red' : 'green'}`}
                title={m.cooling ? `Paused after ${m.fails} failure(s) — retrying in ${Math.ceil((m.retryInMs ?? 0) / 1000)}s. ${m.lastError ?? ''}` : m.lastError ?? m.model}
              >
                <Icon name={m.cooling ? 'clock' : 'checkCircle'} size={12} /> {m.label}{ms != null ? ` · ${ms}ms` : ''}
              </span>
            )
          })}
          {missingKeys.length > 0 && (
            <span className="muted" style={{ fontSize: 12, flexBasis: '100%' }}>
              Unset keys: {missingKeys.join(', ')} — add them to server/.env for more engines.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/* ── background generation progress ─────────────────────────────────────── */

// Shown while a large run is in flight. A "Full bank (9000)" job runs for
// minutes, so the panel reports what has been collected and which engines
// answered rather than only spinning.
function JobProgress({ job }: { job: AiJob }) {
  const pct = job.requested ? Math.min(100, Math.round((job.done / job.requested) * 100)) : 0
  const answered = job.engines.filter((e) => e.ok)
  const failed = job.engines.filter((e) => !e.ok)

  return (
    <div className="ai-job" role="status" aria-live="polite">
      <div className="row-between" style={{ gap: 10 }}>
        <strong style={{ fontSize: 14 }}>
          {job.status === 'running'
            ? `Generating… ${job.done.toLocaleString()} of ${job.requested.toLocaleString()}`
            : job.status === 'done'
              ? `Finished — ${job.done.toLocaleString()} question${job.done === 1 ? '' : 's'}`
              : 'Generation failed'}
        </strong>
        <span className="muted" style={{ fontSize: 12 }}>{formatDuration(job.elapsedMs)}{job.rounds > 0 ? ` · ${job.rounds} round${job.rounds === 1 ? '' : 's'}` : ''}</span>
      </div>
      <div className="ai-job-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Generation progress">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="row-between" style={{ gap: 10, fontSize: 12 }}>
        <span className="muted">{pct}% collected</span>
        {answered.length > 0 && <span className="muted">{answered.length} engine{answered.length === 1 ? '' : 's'} answered{failed.length > 0 ? ` · ${failed.length} failed` : ''}</span>}
      </div>
      {job.error && <p className="hint" style={{ color: 'var(--vermilion)', margin: 0 }}>{job.error}</p>}
      {job.note && <p className="hint" style={{ margin: 0 }}>{job.note}</p>}
    </div>
  )
}

/* ── daily AI budget ────────────────────────────────────────────────────── */
// The server enforces a per-teacher daily question cap (AI_DAILY_QUESTION_LIMIT)
// but only when one is configured, and it used to reject an oversized run with
// nothing on screen beforehand. This shows today's spend before the click, and
// warns when the requested batch would not fit in what is left.
function useAiBudget() {
  const [state, setState] = useState({ used: 0, limit: 0, remaining: 0 as number | null, loaded: false })
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api
      .aiUsage()
      .then((r) => {
        setState({ used: r.used ?? 0, limit: r.limit ?? 0, remaining: r.remaining ?? null, loaded: true })
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not read AI usage'))
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 20000)
    return () => clearInterval(id)
  }, [refresh])

  return { ...state, error, refresh }
}

function BudgetBar({ budget }: { budget: ReturnType<typeof useAiBudget> }) {
  if (budget.error) {
    return <div className="panel ai-budget"><div className="panel-body"><span className="hint" style={{ color: 'var(--vermilion)' }}>{budget.error}</span></div></div>
  }
  if (!budget.loaded) return null

  const { used, limit, remaining } = budget
  const capped = limit > 0
  const left = remaining ?? 0
  const pct = capped ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const tone = !capped ? 'green' : left === 0 ? 'red' : left < limit * 0.2 ? 'gold' : 'green'

  return (
    <div className="panel ai-budget">
      <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
        <div className="row-between" style={{ gap: 10 }}>
          <span className={`tag ${tone}`}>
            {capped
              ? `Today: ${used} of ${limit} questions used · ${left} left`
              : `Today: ${used} questions used · no daily cap set`}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>resets at midnight</span>
        </div>
        {capped && (
          <div style={{ height: 6, borderRadius: 99, background: 'var(--slab-2)', overflow: 'hidden' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${pct}%`, height: '100%', background: tone === 'red' ? 'var(--vermilion)' : tone === 'gold' ? 'var(--gold)' : 'var(--jade)', transition: 'width 0.4s var(--ease)' }} />
          </div>
        )}
        {!capped && (
          <p className="hint" style={{ margin: 0 }}>
            No daily limit is configured. Set <code>AI_DAILY_QUESTION_LIMIT</code> in server/.env to cap spend per teacher.
          </p>
        )}
      </div>
    </div>
  )
}

/* ── question tray ─────────────────────────────────────────────────────── */


// Per-item save state. `dupe` is set when the server refused the save because
// the question is already in the bank, which is what the "Save anyway" action
// clears.
export type SaveState = 'pending' | 'saving' | 'saved' | 'dupe' | 'error'
export type TrayItem = { q: Question; state: SaveState; message?: string }

const UNSAVED: SaveState[] = ['pending', 'error']

// The same "save one / save all" logic was copy-pasted into five tools. It is
// one hook now, and saving marks an item instead of silently removing it —
// losing your place in a 200-question result list was the old behaviour.
function useQuestionTray() {
  const [items, setItems] = useState<TrayItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((questions: Question[]) => {
    setItems((old) => {
      const keyOf = (q: Question) => `${q.prompt.trim()}\n${q.options.join('\n')}\n${q.answer}`
      const previous = new Map(old.map((item) => [keyOf(item.q), item]))
      return questions.map((q) => {
        const saved = previous.get(keyOf(q))
        return saved ? { ...saved, q } : { q, state: 'pending' as SaveState }
      })
    })
    setError(null)
  }, [])

  const clear = useCallback(() => setItems([]), [])

  const remove = useCallback((i: number) => {
    setItems((old) => old.filter((_, x) => x !== i))
  }, [])

  const patch = useCallback((i: number, next: Partial<TrayItem>) => {
    setItems((old) => old.map((it, x) => (x === i ? { ...it, ...next } : it)))
  }, [])

  // Replace one question without touching its save state. Used when a diagram is
  // drawn onto an already-listed question.
  const patchQ = useCallback((i: number, q: Question) => {
    setItems((old) => old.map((it, x) => (x === i ? { ...it, q } : it)))
  }, [])

  // Saving a question that is already saved is a no-op, so a double click or a
  // retry after an error can never write the same question twice.
  const saveOne = useCallback(async (i: number, force = false) => {
    setItems((old) => {
      const it = old[i]
      if (!it || (it.state === 'saved' && !force) || it.state === 'saving') return old
      return old.map((x, idx) => (idx === i ? { ...x, state: 'saving' as SaveState, message: undefined } : x))
    })
    setError(null)
    const item = items[i]
    if (!item) return
    try {
      await api.createQuestion({ ...item.q, force })
      patch(i, { state: 'saved', message: undefined })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        patch(i, { state: 'dupe', message: err.message })
      } else {
        patch(i, { state: 'error', message: err instanceof Error ? err.message : 'Save failed' })
      }
      throw err
    }
  }, [items, patch])

  // One request for the whole batch. The server runs it in a transaction, so
  // the previous half-save failure mode — 89 questions written, error shown,
  // 89 duplicates on the next attempt — cannot happen.
  const saveAll = useCallback(async (force = false) => {
    const pending = items.filter((it) => UNSAVED.includes(it.state))
    if (!pending.length) return 0
    setSaving(true)
    setError(null)
    setItems((old) => old.map((it) => (UNSAVED.includes(it.state) ? { ...it, state: 'saving' as SaveState, message: undefined } : it)))
    try {
      const r = await api.createQuestionsBulk(pending.map((it) => ({ ...it.q, force })), force)
      const dupes = r.duplicates || []
      setItems((old) => {
        let cursor = 0
        return old.map((it) => {
          if (!UNSAVED.includes(it.state)) return it
          const index = cursor
          cursor += 1
          const hit = dupes.find((d) => d.index === index)
          if (hit) {
            return {
              ...it,
              state: 'dupe' as SaveState,
              message: `${Math.round(hit.similarity * 100)}% ${hit.method === 'semantic' ? 'semantic' : 'text'} match to a question already in the bank`,
            }
          }
          return { ...it, state: 'saved' as SaveState, message: undefined }
        })
      })
      if (dupes.length) {
        notify('info', `Saved ${r.saved} question${r.saved === 1 ? '' : 's'} · ${dupes.length} already in the bank.`)
      } else {
        notify('success', `${r.saved} question${r.saved === 1 ? '' : 's'} saved to the bank.`)
      }
      return r.saved
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Every question in the batch was a duplicate: nothing was written, so
        // a retry is safe.
        const dupes = (Array.isArray(err.data?.duplicates) ? err.data.duplicates : []) as DuplicateHit[]
        setItems((old) => {
          let cursor = 0
          return old.map((it) => {
            if (!UNSAVED.includes(it.state)) return it
            const index = cursor
            cursor += 1
            const hit = dupes.find((d) => d.index === index)
            return { ...it, state: 'dupe' as SaveState, message: hit ? `${Math.round(hit.similarity * 100)}% match — ${err.message}` : err.message }
          })
        })
        notify('info', err.message)
      } else {
        const msg = err instanceof Error ? err.message : 'Save failed'
        setError(msg)
        notify('error', msg)
        setItems((old) => old.map((it) => (it.state === 'saving' ? { ...it, state: 'error' as SaveState, message: msg } : it)))
      }
      return 0
    } finally {
      setSaving(false)
    }
  }, [items])

  // Clear a duplicate flag so the item is eligible for the next save attempt.
  const retry = useCallback((i: number) => patch(i, { state: 'pending', message: undefined }), [patch])

  return { items, saving, error, load, clear, remove, saveOne, saveAll, retry, patchQ }
}

function ResultList({
  items,
  title,
  busy,
  onSave,
  onSaveAll,
  onSaveAnyway,
  onRetry,
  onDismiss,
  onDrawFigures,
  drawingFigures,
  footer,
}: {
  items: TrayItem[]
  title: string
  busy: boolean
  onSave: (i: number) => void
  onSaveAll: () => void
  onSaveAnyway?: () => void
  onRetry?: (i: number) => void
  onDismiss?: (i: number) => void
  onDrawFigures?: (i?: number) => void
  drawingFigures?: boolean
  footer?: React.ReactNode
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const pending = items.filter((it) => UNSAVED.includes(it.state)).length
  const saved = items.filter((it) => it.state === 'saved').length
  const dupes = items.filter((it) => it.state === 'dupe').length
  const missingFigures = items.filter((it) => it.state !== 'saved' && !it.q.figure).length
  const figNums: Record<number, number> = {}
  let figCount = 0
  items.forEach((it, i) => { if (it.q.figure) figNums[i] = ++figCount })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (activeIndex === null || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void onSave(activeIndex)
      } else if (event.key === ' ') {
        event.preventDefault()
        setFocusIndex(activeIndex)
      } else if (event.key.toLowerCase() === 'd' && onDismiss) {
        event.preventDefault()
        onDismiss(activeIndex)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeIndex, onDismiss, onSave])

  if (items.length === 0) return null

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <h2>
          {title} <span className="tag gold">{items.length}</span>
          {figCount > 0 && <span className="tag blue">{figCount} with picture{figCount === 1 ? '' : 's'}</span>}
          {saved > 0 && <span className="tag green">{saved} saved</span>}
          {dupes > 0 && <span className="tag red">{dupes} duplicate{dupes === 1 ? '' : 's'}</span>}
        </h2>
        <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
          {onDrawFigures && missingFigures > 0 && (
            <button className="btn secondary" disabled={busy || drawingFigures} onClick={() => onDrawFigures()}>
              <>{drawingFigures
                ? <><Spinner size="sm" label="" /> Drawing…</>
                : `Draw ${missingFigures} diagram${missingFigures === 1 ? '' : 's'}`}</>
            </button>
          )}
          <button className="btn primary" disabled={busy || pending === 0} onClick={onSaveAll}>
            <>{busy ? <><Spinner size="sm" label="" /> Saving…</> : pending === items.length ? 'Save all to bank' : `Save ${pending} remaining`}</>
          </button>
        </div>
      </div>
      {dupes > 0 && onSaveAnyway && (
        <div className="ai-dupe-banner">
          <span>
            {dupes} question{dupes === 1 ? '' : 's'} already exist{dupes === 1 ? 's' : ''} in the bank. Save the rest without {dupes === 1 ? 'it' : 'them'}, or keep the duplicates on purpose.
          </span>
          <button className="btn secondary" onClick={onSaveAnyway}>
            Save {dupes} duplicate{dupes === 1 ? '' : 's'} anyway
          </button>
        </div>
      )}
      <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
        {items.map((it, i) => (
          <article
            className={`ai-preview-paper${it.state === 'saved' ? ' is-saved' : ''}${it.state === 'dupe' ? ' is-dupe' : ''}`}
            key={`${i}-${it.q.prompt.slice(0, 40)}`}
            tabIndex={0}
            onFocus={() => setActiveIndex(i)}
            onMouseEnter={() => setActiveIndex(i)}
            aria-label={`Question ${i + 1} staging card`}
          >
            <div className="ai-preview-header">
              <span className="ai-preview-index">Question {i + 1}</span>
              {it.state === 'dupe' ? (
                <div className="ai-save-actions">
                  <span className="tag red" title={it.message}>Already in bank</span>
                  {onRetry && <button className="btn ghost" onClick={() => onRetry(i)} style={{ minHeight: 34, padding: '6px 12px' }}>Dismiss</button>}
                  <button className="btn secondary" onClick={() => onSave(i)} style={{ minHeight: 34, padding: '6px 12px' }}>Save anyway</button>
                </div>
              ) : (
                <div className="ai-save-actions">
                  {onDrawFigures && !it.q.figure && it.state !== 'saved' && (
                    <button
                      className="btn ghost"
                      disabled={busy || drawingFigures}
                      onClick={() => onDrawFigures(i)}
                      title="Draw a labelled diagram for this question"
                      style={{ minHeight: 34, padding: '6px 10px' }}
                    >
                      <><Icon name="image" size={13} /> Draw</>
                    </button>
                  )}
                  <button
                    className={`btn ${it.state === 'saved' ? 'secondary' : 'primary'}`}
                    disabled={busy || it.state === 'saving' || it.state === 'saved'}
                    onClick={() => onSave(i)}
                    style={{ minHeight: 34, padding: '6px 12px' }}
                  >
                    {it.state === 'saving' ? 'Saving…' : it.state === 'saved' ? <><Icon name="check" size={13} /> In bank</> : it.state === 'error' ? 'Retry save' : <>Save <kbd>S</kbd></>}
                  </button>
                  <button className="btn ghost" onClick={() => setFocusIndex(i)} aria-label={`Focus question ${i + 1}`} title="Focus preview (Space)" style={{ minHeight: 34, padding: '6px 10px' }}><Icon name="maximize" size={13} /><kbd>Space</kbd></button>
                </div>
              )}
            </div>

            {it.message && it.state !== 'saved' && (
              <p className={`hint${it.state === 'dupe' ? ' ai-dupe-note' : ''}`} style={{ marginTop: 0 }}>{it.message}</p>
            )}

            <p className="ai-preview-question"><MathText text={it.q.prompt} /></p>

            {it.q.figure && <Figure src={it.q.figure} caption={figNums[i] ? `Fig. ${figNums[i]}` : undefined} />}

            <ol className="ai-preview-options">
              {it.q.options.map((o, x) => (
                <li key={x} className={x === it.q.answer ? 'is-answer' : ''}>
                  <span className="ai-option-letter">{String.fromCharCode(65 + x)}</span>
                  <span><MathText text={o} /></span>
                </li>
              ))}
            </ol>

            <div className="ai-preview-meta">
              {it.q.topic && <span className="tag">{it.q.topic}</span>}
              {it.q.difficulty && <span className="tag">{it.q.difficulty}</span>}
              <span className="tag green">Answer {String.fromCharCode(65 + it.q.answer)}</span>
              {it.q.sourceUrl && (
                <a className="tag" href={it.q.sourceUrl} target="_blank" rel="noreferrer">
                  Source: {it.q.source} · {it.q.sourceLicense}
                </a>
              )}
            </div>
          </article>
        ))}
        {footer}
      </div>
      {focusIndex !== null && items[focusIndex] ? (
        <Modal
          open
          onClose={() => setFocusIndex(null)}
          kicker={`Question ${focusIndex + 1} · Focus review`}
          title="Review question"
          width={760}
          actions={<button className="btn secondary" onClick={() => setFocusIndex(null)}>Close</button>}
        >
          <div className="ai-focus-review">
            <p className="ai-preview-question"><MathText text={items[focusIndex].q.prompt} /></p>
            {items[focusIndex].q.figure && <Figure src={items[focusIndex].q.figure} caption={figNums[focusIndex] ? `Fig. ${figNums[focusIndex]}` : undefined} />}
            <ol className="ai-preview-options">
              {items[focusIndex].q.options.map((option, optionIndex) => <li key={optionIndex} className={optionIndex === items[focusIndex].q.answer ? 'is-answer' : ''}><span className="ai-option-letter">{String.fromCharCode(65 + optionIndex)}</span><span><MathText text={option} /></span></li>)}
            </ol>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

// Shows which engines answered and which did not. Previously only successes
// were listed, so a run that took 60s looked like a success even when every
// engine had failed and the questions came from one struggling key.
function EngineReport({ engines, totalMs }: { engines: AiEngineResult[]; totalMs?: number }) {
  if (engines.length === 0) return null
  const ok = engines.filter((e) => e.ok)
  const bad = engines.filter((e) => !e.ok)
  return (
    <div className="ai-engine-report">
      {totalMs != null && <span className="muted" style={{ fontSize: 12 }}>Finished in {formatDuration(totalMs)}</span>}
      {ok.map((e, i) => (
        <span className="tag green" key={`ok${i}`} title={e.model}><Icon name="check" size={11} /> {e.label} · {formatDuration(e.latencyMs)} · {e.count}q</span>
      ))}
      {bad.map((e, i) => (
        <span className="tag red" key={`bad${i}`} title={e.model}><Icon name="x" size={11} /> {e.label}</span>
      ))}
    </div>
  )
}

/* ── 1. Exam sheet (main workspace) ────────────────────────────────────── */

function SheetTab() {
  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        The exam sheet is the main workspace. Everything in the other tabs feeds straight into it —
        generate questions, draw labelled diagrams, then reorder and publish.
      </p>
      <ExamSheetTool />
    </div>
  )
}

/* ── 2. Questions (generate / variants / past paper / rewrite) ─────────── */

type Mode = 'new' | 'variants' | 'convert' | 'rewrite'

const MODES: { id: Mode; label: string; blurb: string; cta: string; busy: string }[] = [
  { id: 'new', label: 'New questions', blurb: 'Write fresh exam questions on any topic.', cta: 'Generate', busy: 'Generating…' },
  { id: 'variants', label: 'Variants', blurb: 'Clone one question into N different versions.', cta: 'Create variants', busy: 'Creating variants…' },
  { id: 'convert', label: 'Past paper', blurb: 'Clean up typed or OCR text into proper questions.', cta: 'Convert', busy: 'Converting…' },
  { id: 'rewrite', label: 'Rewrite', blurb: 'Re-word a question and change its difficulty.', cta: 'Rewrite', busy: 'Rewriting…' },
]

function QuestionsTab({ budget }: { budget: ReturnType<typeof useAiBudget> }) {

  const [mode, setMode] = useState<Mode>('new')
  const [subject, setSubject] = useState('Mathematics')
  const [classLevel, setClassLevel] = useState('SS3')
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState('medium')
  const [questionType, setQuestionType] = useState<QuestionType>('multiple-choice')
  const [count, setCount] = useState(10)
  const [text, setText] = useState('')
  const [target, setTarget] = useState('medium')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [engines, setEngines] = useState<AiEngineResult[]>([])
  const [totalMs, setTotalMs] = useState<number | null>(null)
  const [job, setJob] = useState<AiJob | null>(null)
  const [drawingFigs, setDrawingFigs] = useState(false)
  const [thinking, setThinking] = useState<ThinkingState | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The server answers small fresh-question runs synchronously (≤200), and the
  // streaming twin of that call feeds this tab's Thinking Drawer the same way
  // the Exam Sheet's does. Bigger runs still go to the background job.
  const STREAM_MAX = 200
  const jobPoll = useRef<number | null>(null)
  const tray = useQuestionTray()
  const { ms: elapsedMs, start: startElapsed, stop: stopElapsed } = useElapsed()
  const heading = useRef<HTMLDivElement>(null)
  const meta = MODES.find((m) => m.id === mode)!
  // Diagrams belong to the fresh-question and past-paper modes, where the
  // questions are being written from scratch. Variants and rewrites inherit
  // whatever their source question already carries.
  const figures = useFigurePlan(mode === 'new' || mode === 'convert' ? count : 0)

  useEffect(() => () => { if (jobPoll.current) window.clearInterval(jobPoll.current) }, [])
  // If the teacher navigates away mid-run, stop the stream and let the server
  // stop after its current call (background jobs carry on regardless).
  useEffect(() => () => abortRef.current?.abort(), [])

  const cancelGenerate = () => {
    abortRef.current?.abort()
  }

  const needsInput =
    (mode === 'new' && !subject.trim()) ||
    (mode !== 'new' && !text.trim())

  // A batch over 200 is answered by a background job. Poll it so the teacher
  // sees questions appear, rather than a spinner for several minutes.
  const followJob = useCallback((jobId: string) => {
    jobPoll.current = window.setInterval(() => {
      api
        .aiJob(jobId)
        .then((j) => {
          setJob(j)
          const ready = j.questions ?? []
          if (j.status === 'running') {
            if (ready.length > 0) {
              tray.load(ready)
              const remaining = Math.max(0, j.requested - ready.length)
              setMessage(`Generating questions… ${ready.length}/${j.requested} ready. Generating the remaining ${remaining} question${remaining === 1 ? '' : 's'}…`)
            } else {
              setMessage(`Generating questions… Generating the remaining ${j.requested} question${j.requested === 1 ? '' : 's'}…`)
            }
            return
          }
          if (jobPoll.current) window.clearInterval(jobPoll.current)
          jobPoll.current = null
          setBusy(false)
          stopElapsed()
          budget.refresh()
          if (j.status === 'error') {
            setMessage(j.error || 'Generation failed.')
            notify('error', j.error || 'Generation failed.')
            return
          }
          setEngines(j.engines)
          setTotalMs(j.elapsedMs)
          setMessage(j.note || (j.done ? '' : 'No valid questions returned. Try again.'))
          tray.load(ready)
          if (j.done) {
            notify('success', `${j.done} question${j.done === 1 ? '' : 's'} ready to review.`)
            heading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          } else {
            notify('info', 'No valid questions returned. Try again.')
          }
        })
        .catch((err) => {
          if (jobPoll.current) window.clearInterval(jobPoll.current)
          jobPoll.current = null
          setBusy(false)
          stopElapsed()
          const msg = err instanceof Error ? err.message : 'Lost the generation job'
          setMessage(msg)
          notify('error', msg)
        })
    }, 20000)
  }, [budget, stopElapsed, tray])


  const run = async (n = count) => {
    if (needsInput) return
    // The server rejects a run that would blow past the daily cap, but only
    // after the teacher has waited for the engines. Fail fast and say why.
    if (budget.limit > 0 && n > (budget.remaining ?? 0)) {
      const text = `That asks for ${n} questions but only ${budget.remaining ?? 0} remain in today's budget (cap ${budget.limit}). Lower the count, or raise AI_DAILY_QUESTION_LIMIT in server/.env.`
      setMessage(text)
      notify('error', text)
      return
    }
    setBusy(true)

    startElapsed()
    setMessage('')
    setEngines([])
    setTotalMs(null)
    setJob(null)
    try {
      let questions: Question[] = []
      let count_ = 0
      if (mode === 'new') {
        const want = Math.min(9000, Math.max(1, n))
        const figWanted = figures.auto ? Math.min(autoFigures(want), want) : Math.min(figures.count, want)
        const payload = { subject, classLevel, topic, count: want, difficulty, type: questionType, figures: figWanted, figureStyle: figures.style }
        if (want <= STREAM_MAX) {
          // Small batches stream their live steps straight into the Thinking
          // Drawer — the teacher sees each engine round, any web fill and every
          // figure as it is produced, instead of one opaque wait.
          const controller = new AbortController()
          abortRef.current = controller
          setThinking({ steps: [], status: 'running', error: null })
          const r = await api.aiGenerateStream(payload, {
            signal: controller.signal,
            onStep: (step) => setThinking((t) => (t ? { ...t, steps: [...t.steps, step] } : t)),
          })
          questions = r.questions
          count_ = r.count
          setEngines(r.engines ?? [])
          setTotalMs(r.totalMs ?? null)
          setMessage(r.note || (r.count ? '' : 'No valid questions returned. Try again.'))
          if (controller.signal.aborted) {
            setThinking((t) => (t ? { ...t, status: 'cancelled', error: null } : t))
          } else {
            setThinking((t) => (t ? { ...t, status: 'done' } : t))
          }
          abortRef.current = null
          tray.load(questions)
          if (count_ > 0) {
            notify('success', `${count_} question${count_ === 1 ? '' : 's'} ready to review.`)
            heading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          } else {
            notify('info', 'No valid questions returned. Try again.')
          }
          stopElapsed()
          setBusy(false)
          budget.refresh()
          return
        }
        // Keep the generation flow in the job poller for large batches so the
        // teacher sees partial results appear while the model is still writing.
        const r = await api.aiStartJob(payload)
        setJob({ id: r.jobId, status: 'running', requested: want, done: 0, rounds: 0, engines: [], error: null, note: null, elapsedMs: 0 })
        setMessage(`Generating ${want.toLocaleString()} questions — Generating the remaining ${want.toLocaleString()} question${want === 1 ? '' : 's'}…`)
        followJob(r.jobId)
        return
      } else if (mode === 'variants') {
        const r = await api.aiVariants({ question: text, count })
        questions = r.questions
        count_ = r.count
        setMessage(r.note || (r.count ? '' : 'No variants returned. Try again.'))
      } else if (mode === 'convert') {
        const r = await api.aiConvert({ text, figures: figures.count, figureStyle: figures.style })
        questions = r.questions
        count_ = r.count
        setMessage(r.count ? '' : 'No valid questions found in that text.')
      } else {
        const r = await api.aiRewrite({ question: text, difficulty: target })
        questions = r.questions
        count_ = r.count
        setMessage(r.count ? '' : 'No result returned. Try again.')
      }
      tray.load(questions)
      if (count_ > 0) {
        notify('success', `${count_} question${count_ === 1 ? '' : 's'} ready to review.`)
        heading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        notify('info', 'No valid questions returned. Try again.')
      }
    } catch (err) {
      const cancelled = abortRef.current?.signal.aborted ?? false
      if (cancelled) {
        setThinking((t) => (t ? { ...t, status: 'cancelled', error: null } : t))
      } else {
        const msg = err instanceof Error ? err.message : 'Request failed'
        if (thinking) setThinking((t) => (t ? { ...t, status: 'error', error: msg } : t))
        setMessage(msg)
        notify('error', msg)
      }
    } finally {
      abortRef.current = null
      stopElapsed()
      setBusy(false)
    }
  }

  // Fill in diagrams after the fact — either one question ("Draw") or every
  // unsaved question still missing a picture. Results come back positionally, so
  // each drawn image is written onto exactly the question that asked for it.
  const drawFigures = async (only?: number) => {
    if (drawingFigs) return
    const targets = tray.items
      .map((it, i) => ({ it, i }))
      .filter(({ it, i }) => !it.q.figure && it.state !== 'saved' && (only == null || i === only))
      .slice(0, 60)
    if (targets.length === 0) return
    setDrawingFigs(true)
    try {
      const r = await api.aiFigures({
        questions: targets.map(({ it }) => ({ prompt: it.q.prompt, subject: it.q.subject ?? subject })),
        subject,
        style: figures.style,
      })
      let added = 0
      r.results.forEach((res, k) => {
        const t = targets[k]
        if (res?.ok && res.image && t) {
          tray.patchQ(t.i, { ...t.it.q, figure: res.image })
          added += 1
        }
      })
      notify(
        added ? 'success' : 'info',
        added
          ? `Drew ${added} labelled diagram${added === 1 ? '' : 's'}.`
          : 'No diagrams could be drawn — the picture engine did not answer.',
      )
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Could not draw diagrams')
    } finally {
      setDrawingFigs(false)
    }
  }

  const placeholders: Record<Mode, string> = {
    new: 'Fractions, Photosynthesis, Quadratic Equations…',
    variants: 'Paste the full question — stem plus its A–D options…',
    convert: 'Paste typed or scanned OCR text: questions with A–D options, or plain statements…',
    rewrite: 'Paste a question whose wording you want refreshed or difficulty changed…',
  }
  const estimate = useMemo(() => {
    const amount = Math.max(1, Number(count) || 1)
    const tokens = Math.round((amount * (mode === 'new' ? 230 : 180)) / 100) * 100
    const seconds = Math.max(6, Math.round(amount * (mode === 'new' ? 1.8 : 1.2)))
    return { tokens, seconds }
  }, [count, mode])

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Question assistant</h2>
        <span className="muted" style={{ fontSize: 12 }}>{meta.blurb}</span>
      </div>
      <div className="panel-body">
        <div className="pills" style={{ marginBottom: 14 }}>
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => { setMode(m.id); setMessage(''); setThinking(null) }}>
              {m.label}
            </button>
          ))}
        </div>

        {message && <p className="hint">{message}</p>}

        {job && <JobProgress job={job} />}

        {mode === 'new' ? (
          <div className="grid-3" style={{ gap: 10 }}>
            <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div className="field"><label>Class</label>
              <select value={classLevel} onChange={(e) => setClassLevel(e.target.value)}>
                {CLASS_LEVELS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="field"><label>Difficulty</label>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="mixed">Mixed</option>
              </select>
            </div>
            <div className="field"><label>Question type</label>
              <select value={questionType} onChange={(e) => setQuestionType(e.target.value as QuestionType)}>
                <option value="multiple-choice">Multiple choice</option>
                <option value="essay">Essay</option>
                <option value="theory">Theory</option>
              </select>
            </div>
            <div className="field"><label>Topic <span className="muted">(optional)</span></label><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={placeholders.new} /></div>
            <div className="field"><label>How many</label><input type="number" min={1} max={9000} value={count} onChange={(e) => setCount(Number(e.target.value))} /></div>
          </div>
        ) : (
          <>
            <div className="field">
              <label>{mode === 'variants' ? 'Existing question' : mode === 'convert' ? 'Past-exam text' : 'Question to rewrite'}</label>
              <textarea value={text} rows={mode === 'convert' ? 10 : 5} onChange={(e) => setText(e.target.value)} placeholder={placeholders[mode]} />
            </div>
            <div className="grid-2" style={{ gap: 10 }}>
              {mode === 'variants' && (
                <div className="field" style={{ maxWidth: 200 }}>
                  <label>How many variants</label>
                  <input type="number" min={2} max={9000} value={count} onChange={(e) => setCount(Number(e.target.value))} />
                </div>
              )}
              {mode === 'rewrite' && (
                <div className="field" style={{ maxWidth: 200 }}>
                  <label>Target difficulty</label>
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                  </select>
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={busy || needsInput} onClick={() => void run()}>
            <>{busy ? <><Spinner size="sm" label="" /> {meta.busy}{elapsedMs > 1500 ? ` ${formatDuration(elapsedMs)}` : ''}</> : meta.cta}</>
          </button>
          {mode === 'new' && (
            <button className="btn review" disabled={busy} onClick={() => setConfirmBulk(true)}>
              {busy ? 'Preparing…' : 'Generate a full bank (9000)'}
            </button>
          )}
        </div>
        <div className="ai-generation-estimate" aria-live="polite">
          <Icon name="gauge" size={14} />
          <span>Estimated effort: <strong>{estimate.tokens.toLocaleString()} tokens</strong> · about <strong>{estimate.seconds}s</strong></span>
          {mode === 'new' && figures.count > 0 ? <span className="tag blue">+ {figures.count} diagrams</span> : null}
        </div>

        {(mode === 'new' || mode === 'convert') && <FigureControls total={count} plan={figures} />}

        <div ref={heading} />
        <EngineReport engines={engines} totalMs={totalMs ?? undefined} />
        {tray.error && <p className="hint" style={{ color: 'var(--vermilion)' }}>{tray.error}</p>}
        <ResultList
          items={tray.items}
          title="Questions"
          busy={tray.saving}
          onSave={(i) => void tray.saveOne(i).catch(() => {})}
          onSaveAll={() => void tray.saveAll()}
          onSaveAnyway={() => void tray.saveAll(true)}
          onRetry={tray.retry}
          onDismiss={tray.remove}
          onDrawFigures={(i) => void drawFigures(i)}
          drawingFigures={drawingFigs}
        />
      </div>

      {confirmBulk && (
        <ConfirmDialog
          title="Generate 9000 questions?"
          body={`This asks every healthy AI engine for a large batch at once. It runs as a background job and this tab will show progress as questions arrive — you can switch tabs and come back. It can take several minutes and will use a lot of provider quota. Most teachers only need 40–120 questions per paper.${budget.limit > 0 ? ` Today's remaining budget: ${budget.remaining ?? 0} questions.` : ''}`}
          confirmLabel="Yes, generate 9000"

          busy={busy}
          onCancel={() => setConfirmBulk(false)}
          onConfirm={() => { setConfirmBulk(false); void run(9000) }}
        />
      )}

      {thinking ? (
        <ThinkingDrawer
          thinking={thinking}
          onCancel={cancelGenerate}
          onClose={() => setThinking(null)}
          texts={{
            kicker: 'Question assistant',
            running: 'Generating questions…',
            done: 'Questions ready',
            cancelled: 'Generation cancelled',
            error: 'Generation problem',
            readyNote: 'Done — the questions are loading in the list above.',
          }}
        />
      ) : null}
    </div>
  )
}

/* ── 3. Full paper builder ─────────────────────────────────────────────── */

function PaperTab({ budget }: { budget: ReturnType<typeof useAiBudget> }) {
  const [subject, setSubject] = useState('Mathematics')

  const [classLevel, setClassLevel] = useState('SS3')
  const [sections, setSections] = useState([
    { topic: 'Algebra', count: 10, marks: 1 },
    { topic: 'Geometry', count: 10, marks: 1 },
  ])
  const [busy, setBusy] = useState(false)
  const [paper, setPaper] = useState<{ paperTitle: string; instructions?: string; sections: { title: string; questions: Question[] }[] } | null>(null)
  const [message, setMessage] = useState('')
  const { ms: elapsedMs, start: startElapsed, stop: stopElapsed } = useElapsed()

  const total = sections.reduce((a, s) => a + Math.max(1, Number(s.count) || 1), 0)
  const overCap = total > 9000
  // The same diagram plan the Question Assistant uses, sized to the whole paper
  // rather than one section. 40 questions opens at ~13 pictures.
  const figures = useFigurePlan(total)

  // Available to add more questions (up to 9000 max)
  const canAddMore = total < 9000

  // Model selection for paper generation
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined)
  const availableModels = [
    { label: 'Default (auto)', value: '' },
    { label: 'nvidia/nemotron-3-super-120b-a12b', value: 'nvidia/nemotron-3-super-120b-a12b' },
    { label: 'nvidia/nemotron-3-ultra-550b-a55b', value: 'nvidia/nemotron-3-ultra-550b-a55b' },
    { label: 'google/gemini-1.5-flash', value: 'google/gemini-1.5-flash' },
  ]


  const setSection = (i: number, patch: Partial<{ topic: string; count: number; marks: number }>) =>
    setSections((old) => old.map((s, x) => (x === i ? { ...s, ...patch } : s)))

  const run = async () => {
    if (overCap) {
      setMessage('Maximum 9000 questions per paper — reduce the section counts.')
      notify('error', 'Maximum 9000 questions per paper.')
      return
    }
    // Same fail-fast as the Question Assistant: a paper of 4000 questions that
    // the daily cap will reject should not be built first.
    if (budget.limit > 0 && total > (budget.remaining ?? 0)) {
      const text = `This paper asks for ${total} questions but only ${budget.remaining ?? 0} remain in today's budget (cap ${budget.limit}). Reduce the section counts, or raise AI_DAILY_QUESTION_LIMIT in server/.env.`
      setMessage(text)
      notify('error', text)
      return
    }
    setBusy(true)
    startElapsed()
    setMessage('')
    try {
      const r = await api.aiPaper({
        subject,
        classLevel,
        figures: figures.count,
        figureStyle: figures.style,
        sections: sections.map((s) => ({ topic: s.topic, count: Math.min(9000, Math.max(1, Number(s.count) || 1)), marks: s.marks })),
        model: selectedModel,
      })
      setPaper(r.paper)
      setMessage(r.note || (r.paper
        ? `Paper built — ${(r.figures ?? 0) > 0 ? `${r.figures} diagram${(r.figures ?? 0) === 1 ? '' : 's'} drawn across ${total} questions` : 'no diagrams requested'}.`
        : 'No paper returned. Try again.'))

      if (r.paper) notify('success', 'Paper built — review and save the questions you want.')
      else notify('info', 'No paper returned. Try again.')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Build failed'
      setMessage(msg)
      notify('error', msg)
    } finally {
      stopElapsed()
      setBusy(false)
    }
  }

  const flattened = useMemo(
    () => (paper ? paper.sections.flatMap((s) => s.questions.map((q) => ({ ...q, topic: q.topic || s.title }))) : []),
    [paper],
  )

  // One tray for the whole paper, so "Save all" is a single transaction and
  // every question carries its own saved / duplicate / failed state. Saving an
  // individual question now visibly marks it, which it did not before.
  const tray = useQuestionTray()
  const sliceFor = useCallback((si: number) => {
    const start = paper!.sections.slice(0, si).reduce((a, s) => a + s.questions.length, 0)
    return { start, items: tray.items.slice(start, start + paper!.sections[si].questions.length) }
  }, [paper, tray.items])

  useEffect(() => {
    if (paper) tray.load(flattened)
    // Loading is keyed to the paper, not to every flattened identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper])

  const savedCount = tray.items.filter((it) => it.state === 'saved').length
  const dupeCount = tray.items.filter((it) => it.state === 'dupe').length
  const busySave = tray.saving

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Full exam paper builder</h2>
        <span className="muted" style={{ fontSize: 12 }}>Sections are generated in parallel, then illustrated.</span>
      </div>
      <div className="panel-body">
        {message && <p className="hint">{message}</p>}

        <div className="grid-2" style={{ gap: 10 }}>
          <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="field"><label>Class</label>
            <select value={classLevel} onChange={(e) => setClassLevel(e.target.value)}>
              {CLASS_LEVELS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Model</label>
            <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as string)}>
              {availableModels.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {sections.map((s, i) => (
          <div className="grid-3" style={{ gap: 10, marginBottom: 6 }} key={i}>
            <div className="field">
              <label>Section {String.fromCharCode(65 + i)} topic</label>
              <input value={s.topic} onChange={(e) => setSection(i, { topic: e.target.value })} />
            </div>
            <div className="field"><label>Questions</label><input type="number" min={1} max={9000} value={s.count} onChange={(e) => setSection(i, { count: Number(e.target.value) })} /></div>
            <div className="field"><label>Marks each</label><input type="number" min={1} value={s.marks} onChange={(e) => setSection(i, { marks: Number(e.target.value) })} /></div>
          </div>
        ))}

        <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn secondary" disabled={busy} onClick={() => setSections((old) => [...old, { topic: '', count: 10, marks: 1 }])}>+ Add section</button>
          {sections.length > 1 && (
            <button className="btn secondary" disabled={busy} onClick={() => setSections((old) => old.slice(0, -1))}>− Remove last</button>
          )}
          <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>{total} questions total</span>
          {selectedModel ? (
            <span className="muted" style={{ fontSize: 12, marginLeft: 8, color: 'var(--graphite)' }}>
              Model: {selectedModel}
            </span>
          ) : null}
          {canAddMore && !busy && (
            <button className="btn secondary" onClick={() => setSections((old) => {
              const first = { ...old[0], count: Math.min(9000, old[0].count + 20) }
              return old.map((s, i) => i === 0 ? first : s)
            })}>
              +20 questions
            </button>
          )}
        </div>

        <FigureControls total={total} plan={figures} />

        <div className="flex" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={busy || !subject.trim() || overCap} onClick={() => void run()}>
            <>{busy ? <><Spinner size="sm" label="" /> Building paper… {elapsedMs > 2000 ? formatDuration(elapsedMs) : ''}</> : 'Build paper'}</>
          </button>
        </div>

        {paper && (
          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head">
              <h2>
                {paper.paperTitle} <span className="tag gold">{flattened.length} questions</span>
                {savedCount > 0 && <span className="tag green">{savedCount} in bank</span>}
                {dupeCount > 0 && <span className="tag red">{dupeCount} duplicate{dupeCount === 1 ? '' : 's'}</span>}
              </h2>
              <button className="btn primary" disabled={busySave || tray.items.every((it) => !UNSAVED.includes(it.state))} onClick={() => void tray.saveAll()}>
                <>{busySave ? <><Spinner size="sm" label="" /> Saving…</> : 'Save all to bank'}</>
              </button>
            </div>
            <div className="panel-body">
              {paper.instructions && <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{paper.instructions}</p>}
              {tray.error && <p className="hint" style={{ color: 'var(--vermilion)' }}>{tray.error}</p>}
              {paper.sections.map((sec, si) => {
                const { start, items } = sliceFor(si)
                return (
                  <div key={si} style={{ marginBottom: 14 }}>
                    <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{sec.title}</h3>
                    <ResultList
                      items={items}
                      title=""
                      busy={busySave}
                      onSave={(i) => void tray.saveOne(start + i).catch(() => {})}
                      onSaveAll={() => void tray.saveAll()}
                      onSaveAnyway={() => void tray.saveAll(true)}
                      onRetry={tray.retry}
                      onDismiss={tray.remove}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── 4. Pictures ───────────────────────────────────────────────────────── */

function PicturesTab() {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [size, setSize] = useState('1:1')
  const [n, setN] = useState(1)
  const [style, setStyle] = useState<FigureStyle>('pencil')
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState<string[]>([])
  const [imageSources, setImageSources] = useState<({ url: string; title: string; sourceUrl: string; license: string; artist: string } | null)[]>([])
  const [message, setMessage] = useState('')
  const [imageModels, setImageModels] = useState<{ model: string; label: string; provider: string; key: string }[]>([])
  const [embedText, setEmbedText] = useState('Students should be able to identify parts of the plant cell.')
  const [embedBusy, setEmbedBusy] = useState(false)
  const [embedResult, setEmbedResult] = useState('')
  const [embedMatches, setEmbedMatches] = useState<{ id: number; prompt: string; subject: string | null; similarity: number }[] | null>(null)
  const { ms: elapsedMs, start: startElapsed, stop: stopElapsed } = useElapsed()

  useEffect(() => {
    api.aiModels().then((r) => setImageModels(r.imageModels || [])).catch(() => setImageModels([]))
  }, [])

  const run = async () => {
    if (!prompt.trim()) return setMessage('Describe the picture you want.')
    setBusy(true)
    startElapsed()
    setMessage('')
    setImages([])
    setImageSources([])
    try {
      const r = await api.aiImage({ prompt, model: model || undefined, size, count: n, style })
      setImages(r.images)
      setImageSources(r.imageSources || [])
      setMessage(r.success
        ? `${r.source ? `Prepared with ${r.source}` : `Generated with ${r.model || 'AI'}`} · ${r.count} image${r.count === 1 ? '' : 's'} in ${formatDuration(r.latencyMs ?? 0)}${r.svgFallback ? ' (includes a vector diagram)' : ''}.`
        : 'No image returned — try a clearer prompt or another model.')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed'
      setMessage(msg)
      notify('error', msg)
    } finally {
      stopElapsed()
      setBusy(false)
    }
  }

  const runEmbed = async () => {
    setEmbedBusy(true)
    setEmbedResult('')
    setEmbedMatches(null)
    try {
      const r = await api.aiEmbed({ text: embedText })
      if (!r.success) {
        setEmbedResult(r.error || 'Failed')
        notify('error', r.error || 'Failed')
        return
      }
      const matches = r.matches ?? []
      setEmbedMatches(matches)
      // The panel used to promise deduplication and then only print a dimension
      // count. It now reports what the bank search actually found.
      const out = matches.length
        ? `Embedded ${embedText.trim().length} characters into ${r.dims} dimensions. ${matches.length} similar question${matches.length === 1 ? '' : 's'} in the bank — closest ${Math.round(matches[0].similarity * 100)}%.`
        : `Embedded into ${r.dims} dimensions. No comparable question in the bank yet.`
      setEmbedResult(out)
      notify(matches.length ? 'info' : 'success', out)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed'
      setEmbedResult(msg)
      setEmbedMatches(null)
      notify('error', msg)
    } finally {
      setEmbedBusy(false)
    }
  }

  const fileName = (i: number) => `ai-picture-${i + 1}.png`

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="panel">
        <div className="panel-head">
          <div className="row" style={{ gap: 10 }}>
            <div className="chair-icon" title="AI Chairman">
              <Icon name="sparkle" size={20} className="text-gold" />
            </div>
            <div>
              <h2 style={{ margin: 0 }}>Picture studio</h2>
              <p className="kicker" style={{ fontSize: 10, color: 'var(--gold)' }}>Overseen by the AI Chairman</p>
            </div>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>The Chairman draws first; web search only if he fails.</span>
        </div>
        <div className="panel-body">
          {message && <p className="hint">{message}</p>}
          <div className="field">
            <label>Describe the picture</label>
            <textarea value={prompt} rows={3} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. A labelled diagram of the human heart for a biology question, clean school style" />
          </div>
          <div className="grid-3" style={{ gap: 10 }}>
            {imageModels.length > 0 && (
              <div className="field"><label>Model</label>
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">Auto (fastest available)</option>
                  {imageModels.map((m) => <option key={m.model} value={m.model}>{m.label}</option>)}
                </select>
              </div>
            )}
            <div className="field"><label>Shape</label>
              <select value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="1:1">Square 1:1</option>
                <option value="16:9">Landscape 16:9</option>
                <option value="9:16">Portrait 9:16</option>
                <option value="5:4">Wide 5:4</option>
                <option value="4:5">Tall 4:5</option>
                <option value="3:2">Landscape 3:2</option>
                <option value="2:3">Portrait 2:3</option>
              </select>
            </div>
            <div className="field"><label>Images</label>
              <select value={n} onChange={(e) => setN(Number(e.target.value))}>
                {[1, 2, 4].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
          </div>
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Drawing style</label>
            <Segmented
              grow
              value={style}
              onChange={setStyle}
              ariaLabel="Drawing style"
              options={[
                { value: 'pencil', label: 'Pencil', icon: 'edit' },
                { value: 'clean', label: 'Clean', icon: 'sliders' },
              ]}
            />
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            Applies to vector diagrams. Pencil adds hand-drawn line work and a label halo; clean is flat textbook art.
          </p>
          <button className="btn primary" disabled={busy || !prompt.trim()} onClick={() => void run()}>
            <>{busy ? <><Spinner size="sm" label="" /> Generating… {elapsedMs > 2000 ? formatDuration(elapsedMs) : ''}</> : 'Generate picture'}</>
          </button>

          {images.length > 0 && (
            <div className="ai-picture-grid">
              {images.map((src, i) => (
                <figure key={i} className="ai-picture-card">
                  <img src={src} alt={prompt} />
                  <figcaption className="ai-picture-card-foot">
                    <a className="btn secondary sm" href={src} download={fileName(i)} style={{ textDecoration: 'none' }}>Download</a>
                    <a className="btn secondary sm" href={src} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open</a>
                    {imageSources[i] && (
                      <span className="ai-picture-source">
                        <a href={imageSources[i].sourceUrl} target="_blank" rel="noreferrer">{imageSources[i].title}</a>
                        <span>{imageSources[i].license}{imageSources[i].artist ? ` · ${imageSources[i].artist}` : ''}</span>
                      </span>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}

          {imageModels.length === 0 && (
            <p className="hint" style={{ marginBottom: 0 }}>
              No hosted image model is available. Pictures fall back to vector diagrams drawn by the
              text engines — add an NVIDIA image key to server/.env for photographs.
            </p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Similarity check</h2>
          <span className="muted" style={{ fontSize: 12 }}>Search the bank for a question that says the same thing.</span>
        </div>
        <div className="panel-body">
          <p className="hint" style={{ marginTop: 0 }}>
            Embeds the text below and ranks every bank question by cosine similarity. The same check runs
            automatically when you save, so a near-duplicate is flagged before it reaches the bank.
          </p>
          <div className="field">
            <label>Text to check</label>
            <textarea value={embedText} rows={3} onChange={(e) => { setEmbedText(e.target.value); setEmbedMatches(null); setEmbedResult('') }} />
          </div>
          <button className="btn primary" disabled={embedBusy || !embedText.trim()} onClick={() => void runEmbed()}>
            <>{embedBusy ? <><Spinner size="sm" label="" /> Checking…</> : 'Check against the bank'}</>
          </button>
          {embedResult && <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>{embedResult}</p>}
          {embedMatches && embedMatches.length > 0 && (
            <ol className="ai-matches">
              {embedMatches.map((m) => (
                <li key={m.id}>
                  <div className="row-between" style={{ gap: 8 }}>
                    <span><MathText text={m.prompt.slice(0, 140)} /></span>
                    <span className={`tag ${m.similarity >= 0.9 ? 'red' : 'gold'}`}>{Math.round(m.similarity * 100)}%</span>
                  </div>
                  {m.subject && <span className="muted" style={{ fontSize: 12 }}>{m.subject}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>

      </div>
    </div>
  )
}

/* ── page ──────────────────────────────────────────────────────────────── */

export function AILab() {
  const [tab, setTab] = useState<Tab>('sheet')
  const engines = useEngines()
  const budget = useAiBudget()

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>AI Question Lab</h1>
          <p className="sub">Multi-provider generation. Every question is reviewable before it reaches the bank.</p>
        </div>
      </div>

      <EngineBar engines={engines} />
      <BudgetBar budget={budget} />


      <div className="tool-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'sheet' && <SheetTab />}
      {tab === 'questions' && <QuestionsTab budget={budget} />}
      {tab === 'paper' && <PaperTab budget={budget} />}

      {tab === 'pictures' && <PicturesTab />}
    </div>
  )
}

