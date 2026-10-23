import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../ui'
import { useOutside } from '../../lib/hooks'

/* The table.

   This is the surface a teacher actually lives in — a 240-question bank, a
   mark sheet, a roster — so it carries the whole data layer:

     · sort, search, filter and page all live in the URL
     · a column picker with a sensible default set per screen
     · density is a global preference, not a per-table setting
     · row actions stay hidden until the row is hovered or focused
     · a bulk bar appears only when something is selected
     · selection survives paging, and "select all" means all *filtered* rows

   It is deliberately not generic. A generic table would need a config language
   to express "the first column is the row's identity and never scrolls away",
   and that language would be worse than this component. */

export type RowKey = string | number

export interface Column<T> {
  key: string
  label: string
  /** Rendered cell. Keep it fast: 200 rows mount on every sort. */
  cell: (row: T) => ReactNode
  /** Value used for sorting and CSV. Omit for an unsortable column. */
  sort?: (row: T) => string | number | null
  width?: number
  align?: 'left' | 'right' | 'center'
  /** Sticky to the left edge — the row's identity. */
  pin?: 'left' | 'right'
  /** Hidden in the default column set but available in the picker. */
  optional?: boolean
  headerClass?: string
  cellClass?: string
  title?: (row: T) => string | undefined
}

export interface Preset<T> {
  id: string
  label: string
  count?: (rows: T[]) => number
  test: (row: T) => boolean
  /** Applied on top of the search box, so a preset and a search compose. */
  patch?: Record<string, string | null>
}

export interface BulkAction<T> {
  label: string
  icon?: IconName
  variant?: 'secondary' | 'danger' | 'primary'
  /** Only shown when every selected row passes. */
  enabled?: (rows: T[]) => boolean
  onRun: (rows: T[]) => void | Promise<void>
}

/** A per-row action. Rendered in the pinned right cell, revealed on hover. */
export interface RowAction<T> {
  label: string
  icon?: IconName
  variant?: 'ghost' | 'danger'
  onRun: (row: T) => void
  /** Stay visible on a row that is not hovered — for a row's only action. */
  always?: boolean
  tip?: string
}

export interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  sort?: string
  dir?: 'asc' | 'desc'
  onSort?: (key: string) => void
  onRowClick?: (row: T) => void
  presets?: Preset<T>[]
  activePreset?: string
  onPreset?: (id: string) => void
  selectable?: boolean
  bulk?: BulkAction<T>[]
  /** Shown under the table, left of the pager. */
  footNote?: ReactNode
  onExport?: () => void
  exportLabel?: string
  toolbar?: ReactNode
  maxHeight?: number | string
  emptyTitle?: string
  emptyBody?: string
  emptyAction?: { label: string; onClick: () => void; icon?: IconName }
  rowClass?: (row: T) => string | undefined
  loading?: boolean
  /** Pinned right column, e.g. a mark + verdict pair. */
  stickySummary?: (row: T) => ReactNode
  summaryLabel?: string
  /** Pinned right actions, hidden until the row is hovered or focused. */
  actions?: (row: T) => RowAction<T>[]

  /* ── Column set ───────────────────────────────────────────────────────────
     Pass `cols` + `onCols` (from useTableState) to keep the chosen columns in
     the URL. Left off, the picker still works — it just forgets. */
  cols?: string | null
  onCols?: (csv: string | null) => void

  /* ── Selection ────────────────────────────────────────────────────────────
     `allKeys` is every row matching the current filter, before paging. Pass it
     and "select all" means all of them, not just the 25 on screen. */
  allKeys?: RowKey[]
  /** Resolve selected keys back to rows, for bulk actions across pages. */
  resolveSelected?: (keys: RowKey[]) => T[]
  onSelectChange?: (keys: RowKey[]) => void
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  sort,
  dir = 'asc',
  onSort,
  onRowClick,
  presets,
  activePreset,
  onPreset,
  selectable,
  bulk = [],
  footNote,
  onExport,
  exportLabel = 'Export CSV',
  toolbar,
  maxHeight,
  emptyTitle = 'Nothing matches',
  emptyBody,
  emptyAction,
  rowClass,
  loading,
  stickySummary,
  summaryLabel = 'Mark',
  actions,
  cols,
  onCols,
  allKeys,
  resolveSelected,
  onSelectChange,
}: DataTableProps<T>) {
  const [picked, setPicked] = useState<Set<RowKey>>(() => new Set())
  const [localCols, setLocalCols] = useState<string | null>(null)
  const [colOpen, setColOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastKey = useRef<RowKey | null>(null)
  const colRef = useOutside<HTMLDivElement>(() => setColOpen(false), colOpen)

  /* ── Which columns are showing ───────────────────────────────────────────
     `optional` columns start hidden; everything else starts shown. Once a set
     is in the URL it wins outright, so a teacher can hide any column. Pinned
     columns are the row's identity and are never removable. */
  const defaultKeys = useMemo(
    () => columns.filter((c) => !c.optional).map((c) => c.key),
    [columns],
  )
  const hidden = useMemo(() => {
    if (cols) {
      const on = new Set(cols.split(',').filter(Boolean))
      return new Set(columns.filter((c) => !on.has(c.key) && c.pin !== 'left' && c.pin !== 'right').map((c) => c.key))
    }
    return new Set(columns.filter((c) => c.optional).map((c) => c.key))
  }, [columns, cols])

  const visible = useMemo(() => columns.filter((c) => !hidden.has(c.key)), [columns, hidden])
  const pinned = useMemo(() => new Set(columns.filter((c) => c.pin).map((c) => c.key)), [columns])

  const commitCols = useCallback(
    (csv: string | null) => {
      if (onCols) onCols(csv)
      else setLocalCols(csv)
    },
    [onCols],
  )
  const activeCols = onCols ? (cols ?? null) : localCols

  const toggleCol = (key: string) => {
    const next = new Set(visible.map((c) => c.key))
    if (next.has(key)) next.delete(key)
    else next.add(key)
    // A table with no columns left is a dead end, not a preference.
    if (next.size === 0) return
    const isDefault = next.size === defaultKeys.length && defaultKeys.every((k) => next.has(k))
    commitCols(isDefault ? null : columns.filter((c) => next.has(c.key)).map((c) => c.key).join(','))
  }

  useEffect(() => {
    if (!colOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [colOpen])

  /* ── Selection ──────────────────────────────────────────────────────────
     Keyed, not index-based, so it survives a sort and a page change. The
     header checkbox reads across the whole filtered set when `allKeys` is
     given, which is what makes "select all" mean what a teacher expects. */
  const keys = useMemo(() => rows.map(rowKey), [rows, rowKey])
  const universe = allKeys ?? keys
  const allPicked = universe.length > 0 && universe.every((k) => picked.has(k))
  const somePicked = picked.size > 0 && !allPicked
  const onThisPage = keys.filter((k) => picked.has(k)).length

  /* Drop keys that fell out of the filter, so a bulk action never fires at
     rows the teacher can no longer see. Only meaningful with `allKeys` — with
     paging alone, `universe` is the page and pruning would erase the point. */
  const prevUniverse = useRef(allKeys)
  useEffect(() => {
    if (!allKeys || prevUniverse.current === allKeys) return
    prevUniverse.current = allKeys
    setPicked((p) => {
      if (p.size === 0) return p
      const allowed = new Set(allKeys)
      const next = new Set([...p].filter((k) => allowed.has(k)))
      return next.size === p.size ? p : next
    })
  }, [allKeys])

  useEffect(() => {
    onSelectChange?.([...picked])
  }, [picked, onSelectChange])

  const selected = useMemo(
    () => (resolveSelected ? resolveSelected([...picked]) : rows.filter((r) => picked.has(rowKey(r)))),
    [resolveSelected, picked, rows, rowKey],
  )

  const toggleAll = () => {
    if (allPicked) {
      setPicked(new Set())
      lastKey.current = null
    } else {
      setPicked(new Set(universe))
    }
  }

  const toggle = (k: RowKey, index: number, shift: boolean) => {
    setPicked((p) => {
      const n = new Set(p)
      if (shift && lastKey.current !== null) {
        const from = keys.indexOf(lastKey.current)
        if (from >= 0) {
          const [lo, hi] = from < index ? [from, index] : [index, from]
          for (let i = lo; i <= hi; i++) n.add(keys[i])
        } else {
          n.add(k)
        }
      } else if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
    lastKey.current = k
  }

  const hasSummary = Boolean(stickySummary)
  const hasActions = Boolean(actions)
  const hasRight = hasSummary || hasActions
  const colCount = visible.length + (selectable ? 1 : 0) + (hasRight ? 1 : 0)
  const rightWidth = (hasSummary ? 96 : 0) + (hasActions ? 34 + 30 : 0)
  const showPicker = columns.length > 3

  return (
    <div className="table-shell">
      {presets && presets.length > 0 ? (
        <div className="presets" role="tablist" aria-label="Saved views">
          {presets.map((p) => {
            const c = p.count?.(rows)
            return (
              <button
                key={p.id}
                role="tab"
                className="preset"
                aria-selected={activePreset === p.id}
                onClick={() => onPreset?.(p.id)}
              >
                {p.label}
                {c !== undefined ? <span className="n num">{c}</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {toolbar || onExport || showPicker ? (
        <div className="tbar">
          {toolbar}
          <div className="tbar-spacer" />
          {showPicker ? (
            <div className="colpicker" ref={colRef}>
              <button
                className="btn quiet sm"
                aria-expanded={colOpen}
                aria-haspopup="menu"
                onClick={() => setColOpen((o) => !o)}
                data-tip="Columns"
              >
                <Icon name="columns" size={13} />
                Columns
              </button>
              {colOpen ? (
                <div className="popover" data-align="end" role="menu" aria-label="Columns">
                  <div className="popover-label">Columns</div>
                  {columns.map((c) => {
                    const on = !hidden.has(c.key)
                    const locked = pinned.has(c.key)
                    return (
                      <button
                        key={c.key}
                        role="menuitemcheckbox"
                        aria-checked={on}
                        className="menu-item"
                        disabled={locked}
                        onClick={() => toggleCol(c.key)}
                      >
                        <span className="menu-tick">{on ? <Icon name="check" size={12} /> : null}</span>
                        <span className="truncate">{c.label}</span>
                        {locked ? <span className="menu-hint">pinned</span> : null}
                      </button>
                    )
                  })}
                  {activeCols ? (
                    <>
                      <div className="menu-sep" />
                      <button role="menuitem" className="menu-item" onClick={() => commitCols(null)}>
                        <span className="menu-tick" />
                        Show default columns
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {onExport ? (
            <button className="btn quiet sm" onClick={onExport}>
              <Icon name="download" size={13} />
              {exportLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className="table-scroll"
        ref={scrollRef}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="tbl">
          <thead>
            <tr>
              {selectable ? (
                <th style={{ width: 40 }} className="pin-l">
                  <div className="th">
                    <input
                      type="checkbox"
                      className="check"
                      checked={allPicked}
                      ref={(el) => {
                        if (el) el.indeterminate = somePicked
                      }}
                      onChange={toggleAll}
                      aria-label={allKeys ? 'Select all matching rows' : 'Select all'}
                    />
                  </div>
                </th>
              ) : null}
              {visible.map((c) => {
                const sortable = Boolean(c.sort && onSort)
                const isSorted = sort === c.key
                return (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={[c.pin === 'left' ? 'pin-l' : '', c.headerClass ?? ''].filter(Boolean).join(' ')}
                    aria-sort={sortable ? (isSorted ? (dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                  >
                    {sortable ? (
                      <button className="th" onClick={() => onSort?.(c.key)} type="button">
                        {c.align === 'right' ? <span className="grow" /> : null}
                        <span className="truncate">{c.label}</span>
                        <span className={`sort ${isSorted && dir === 'asc' ? 'asc' : ''}`}>
                          <Icon name="chevron" size={11} />
                        </span>
                        {c.align !== 'right' ? <span className="grow" /> : null}
                      </button>
                    ) : (
                      <div className="th">
                        {c.align === 'right' ? <span className="grow" /> : null}
                        <span className="truncate">{c.label}</span>
                        {c.align !== 'right' ? <span className="grow" /> : null}
                      </div>
                    )}
                  </th>
                )
              })}
              {hasRight ? (
                <th style={rightWidth ? { width: rightWidth } : undefined} className="pin-r">
                  <div className="th">
                    {hasSummary ? (
                      <>
                        <span className="grow" />
                        <span>{summaryLabel}</span>
                      </>
                    ) : null}
                    {hasActions ? (
                      <span className="sr-only">{actions ? 'Row actions' : ''}</span>
                    ) : null}
                  </div>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }, (_, i) => (
                <tr key={`sk${i}`}>
                  {Array.from({ length: colCount }, (_, c) => (
                    <td key={c}>
                      <span className="skeleton" style={{ height: 10, width: c === 0 ? '60%' : '40%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount}>
                  <div className="empty">
                    <p className="empty-title">{emptyTitle}</p>
                    {emptyBody ? <p className="muted">{emptyBody}</p> : null}
                    {emptyAction ? (
                      <button className="btn secondary sm" style={{ marginTop: 10 }} onClick={emptyAction.onClick}>
                        {emptyAction.icon ? <Icon name={emptyAction.icon} size={13} /> : null}
                        {emptyAction.label}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const k = rowKey(row)
                const isPicked = picked.has(k)
                const acts = hasActions ? actions!(row) : []
                return (
                  <tr
                    key={k}
                    aria-selected={isPicked || undefined}
                    className={[onRowClick ? 'clickable' : '', rowClass?.(row)]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {selectable ? (
                      <td className="pin-l" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="check"
                          checked={isPicked}
                          onChange={(e) => toggle(k, i, (e.nativeEvent as MouseEvent).shiftKey)}
                          aria-label="Select row"
                        />
                      </td>
                    ) : null}
                    {visible.map((c) => (
                      <td
                        key={c.key}
                        className={[c.pin === 'left' ? 'pin-l' : '', c.cellClass ?? ''].filter(Boolean).join(' ')}
                        title={c.title?.(row)}
                        style={c.align === 'right' ? { textAlign: 'right' } : undefined}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                    {hasRight ? (
                      <td className="pin-r" onClick={(e) => e.stopPropagation()}>
                        <div className="cell-right">
                          {hasSummary ? <div className="cell-mark">{stickySummary!(row)}</div> : null}
                          {acts.length ? (
                            <div className="row-actions" data-always={acts.some((a) => a.always) ? 'true' : undefined}>
                              {acts.map((a) => (
                                <button
                                  key={a.label}
                                  className={`btn ${a.variant ?? 'ghost'} sm icon`}
                                  onClick={() => a.onRun(row)}
                                  data-tip={a.tip ?? a.label}
                                  aria-label={a.label}
                                >
                                  {a.icon ? <Icon name={a.icon} size={13} /> : null}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {footNote ? <div className="tbl-foot-note">{footNote}</div> : null}

      {selectable && picked.size > 0 && bulk.length ? (
        <BulkBar
          count={picked.size}
          rows={selected}
          actions={bulk}
          onThisPage={onThisPage}
          onClear={() => {
            setPicked(new Set())
            lastKey.current = null
          }}
        />
      ) : null}
    </div>
  )
}

function BulkBar<T>({
  count,
  rows,
  actions,
  onThisPage,
  onClear,
}: {
  count: number
  rows: T[]
  actions: BulkAction<T>[]
  onThisPage: number
  onClear: () => void
}) {
  return (
    <div className="bulkbar" role="region" aria-label="Bulk actions">
      <span className="bulkbar-count">
        <b className="num">{count}</b> selected
      </span>
      {onThisPage !== count ? <span className="bulkbar-scope">{onThisPage} on this page</span> : null}
      <span className="bulkbar-sep" />
      <div className="bulkbar-actions">
        {actions
          .filter((a) => !a.enabled || a.enabled(rows))
          .map((a) => (
            <button
              key={a.label}
              className={`btn ${a.variant ?? 'ghost'} sm`}
              onClick={() => a.onRun(rows)}
            >
              {a.icon ? <Icon name={a.icon} size={13} /> : null}
              {a.label}
            </button>
          ))}
      </div>
      <span className="bulkbar-sep" />
      <button className="btn ghost sm icon" onClick={onClear} data-tip="Clear selection" aria-label="Clear selection">
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}

/* ── Toolbar pieces ────────────────────────────────────────────────────────
   Composed by each page so a table looks the same but filters stay specific. */

export function SearchBox({
  value,
  onChange,
  placeholder = 'Search',
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div className="tbar-search">
      <Icon name="search" size={14} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
      />
      {value ? (
        <button className="clear" onClick={() => onChange('')} aria-label="Clear search">
          <Icon name="x" size={12} />
        </button>
      ) : null}
    </div>
  )
}

export function PageSize({
  value,
  onChange,
}: {
  value: number
  onChange: (n: number) => void
}) {
  return (
    <div className="chip-filter" style={{ cursor: 'default' }}>
      <span className="n">rows</span>
      <select
        className="select"
        style={{ width: 'auto', minHeight: 'var(--control-h-sm)', padding: '0 6px' }}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Rows per page"
      >
        {[25, 50, 100, 200].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Pager({
  page,
  per,
  total,
  onPage,
  onPer,
}: {
  page: number
  per: number
  total: number
  onPage: (p: number) => void
  onPer: (n: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / per))
  const from = total === 0 ? 0 : (page - 1) * per + 1
  const to = Math.min(total, page * per)

  const nums: (number | 'gap')[] = []
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i)
    else if (nums[nums.length - 1] !== 'gap') nums.push('gap')
  }

  return (
    <div className="pager">
      <span className="pager-total">
        {total === 0 ? 'no rows' : `${from}–${to} of ${total}`}
      </span>
      <PageSize value={per} onChange={onPer} />
      <div className="pager-pages">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <Icon name="chevronLeft" size={14} />
        </button>
        {nums.map((n, i) =>
          n === 'gap' ? (
            <span className="pager-gap" key={`g${i}`}>
              …
            </span>
          ) : (
            <button
              key={n}
              onClick={() => onPage(n)}
              aria-current={n === page ? 'page' : undefined}
            >
              {n}
            </button>
          ),
        )}
        <button onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          <Icon name="chevronRight" size={14} />
        </button>
      </div>
    </div>
  )
}
