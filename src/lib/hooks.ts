import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryParam, useQueryPatch } from './router'
import { api, type SubjectRow } from '../api'

/* Shared hooks. Anything used by more than one page lives here so the app
   behaves the same everywhere — same hotkey, same density key, same scroll
   memory. */

export type SortDir = 'asc' | 'desc'

export interface TableState {
  q: string
  sort: string
  dir: SortDir
  page: number
  per: number
  cols: string | null
  preset: string
  patch: (p: Record<string, string | null>) => void
  setSort: (key: string) => void
  setPage: (p: number) => void
  setPer: (n: number) => void
  setCols: (csv: string | null) => void
  setPreset: (id: string) => void
  reset: () => void
}

/* All table state in the URL. A teacher's filtered view of 240 questions is a
   thing you bookmark, send in a message, and come back to after marking — so
   it cannot live in component state. */
export function useTableState(defaultSort = ''): TableState {
  const [q] = useQueryParam('q')
  const [sort] = useQueryParam('sort', defaultSort)
  const [dir] = useQueryParam('dir', 'asc')
  const [pageRaw] = useQueryParam('page', '1')
  const [per] = useQueryParam('per', '25')
  const [cols] = useQueryParam('cols')
  const [preset] = useQueryParam('view')
  const patch = useQueryPatch()

  const page = Math.max(1, Number(pageRaw) || 1)
  const perPage = [25, 50, 100, 200].includes(Number(per)) ? Number(per) : 25

  const setSort = useCallback(
    (key: string) => {
      if (key === sort) {
        patch({ dir: dir === 'asc' ? 'desc' : 'asc' })
      } else {
        patch({ sort: key, dir: 'asc', page: null })
      }
    },
    [sort, dir, patch],
  )

  return {
    q,
    sort,
    dir: dir === 'desc' ? 'desc' : 'asc',
    page,
    per: perPage,
    cols,
    preset,
    patch,
    setSort,
    setPage: (p) => patch({ page: p <= 1 ? null : String(p) }),
    setPer: (n) => patch({ per: n === 25 ? null : String(n), page: null }),
    setCols: (csv) => patch({ cols: csv }),
    setPreset: (id) => patch({ view: id || null, page: null }),
    reset: () => patch({ q: null, sort: null, dir: null, page: null, view: null, topic: null, subject: null, diff: null }),
  }
}

/* Sort a list the same way everywhere: numbers numerically, strings with
   localeCompare, nulls last regardless of direction. */
export function sortRows<T>(rows: T[], key: string, dir: SortDir, pick: (r: T) => unknown): T[] {
  if (!key) return rows
  const mul = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = pick(a)
    const vb = pick(b)
    const na = va === null || va === undefined || va === ''
    const nb = vb === null || vb === undefined || vb === ''
    if (na && nb) return 0
    if (na) return 1
    if (nb) return -1
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul
    return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * mul
  })
}

export function paginate<T>(rows: T[], page: number, per: number): T[] {
  const start = (page - 1) * per
  return rows.slice(start, start + per)
}

/* Keyword match across several fields, case- and diacritic-insensitive, with
   every term required. Teachers type "algebra quadratic" and mean both. */
export function matches(row: Record<string, unknown>, terms: string[]): boolean {
  if (!terms.length) return true
  const hay = Object.values(row)
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return terms.every((t) => hay.includes(t))
}

export function terms(q: string): string[] {
  return q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean)
}

export interface Hotkey {
  /** "mod+k", "shift+?", "escape", or a chord: "g b", "g r", "?" */
  keys: string
  handler: (e: KeyboardEvent) => void
  /** Fire even when a text field has focus. */
  allowInInput?: boolean
  preventDefault?: boolean
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export function isMod(e: KeyboardEvent) {
  return isMac ? e.metaKey : e.ctrlKey
}

function inTextField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/* A chord sequence: "g" then "b" opens the bank. Power users move through a
   marking tool by keyboard, and because the sequence is listed in the command
   bar it is discoverable without a cheat sheet nobody reads. */
export function useHotkeys(hotkeys: Hotkey[], enabled = true) {
  const spec = useMemo(() => hotkeys.map((h) => ({ ...h, chord: h.keys.includes(' ') })), [hotkeys])
  const signature = spec.map((h) => h.keys).join('|')
  const ref = useRef(spec)
  ref.current = spec

  useEffect(() => {
    if (!enabled) return
    let pending: string | null = null
    let timer: number | null = null

    const onKey = (e: KeyboardEvent) => {
      const list = ref.current
      const typing = inTextField(e.target)
      const mod = isMod(e)
      const key = e.key.toLowerCase()

      if (pending !== null) {
        const chord = `${pending} ${key}`
        const hit = list.find((h) => h.chord && h.keys.toLowerCase() === chord)
        pending = null
        if (timer) window.clearTimeout(timer)
        if (hit) {
          e.preventDefault()
          hit.handler(e)
          return
        }
      }

      const modCombos = list.filter((h) => !h.chord)
      for (const h of modCombos) {
        const parts = h.keys.toLowerCase().split('+').reverse()
        const wantKey = parts[0]
        const mods = parts.slice(1)
        if (key !== wantKey) continue
        if (mod !== mods.includes('mod')) continue
        if (Boolean(e.shiftKey) !== mods.includes('shift')) continue
        if (Boolean(e.altKey) !== mods.includes('alt')) continue
        if (typing && !h.allowInInput) continue
        if (h.preventDefault !== false) e.preventDefault()
        h.handler(e)
        return
      }

      if (!typing && !mod && e.key.length === 1) {
        const isPrefix = list.some((h) => h.chord && h.keys.toLowerCase().split(' ')[0] === key)
        const isExact = list.some((h) => h.chord && h.keys.toLowerCase() === key)
        if (isExact) {
          e.preventDefault()
          const hit = list.find((h) => h.chord && h.keys.toLowerCase() === key)
          hit?.handler(e)
          return
        }
        if (isPrefix) {
          e.preventDefault()
          pending = key
          if (timer) window.clearTimeout(timer)
          timer = window.setTimeout(() => {
            pending = null
          }, 1500)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timer) window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled])
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() =>
    typeof matchMedia !== 'undefined' ? matchMedia(query).matches : false,
  )
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

/* Whether an always-animating decorative layer is allowed to run at all.

   Four independent vetoes, any one of which is enough to switch the WebGL
   scene off: the in-app motion preference, the OS setting, a data-saver, or a
   browser with no WebGL. The scene sits behind the sign-in form, so every
   reader who trips one of these is better served by the static gradient it
   falls back to — and the first two are accessibility requirements, not
   preferences.

   The in-app preference is watched rather than sampled once, so switching
   motion off in Settings takes effect immediately instead of at next load.
   WebGL support is memoised at module level because probing it allocates a
   context, and the answer cannot change within a session. */
let webglSupport: boolean | null = null

function hasWebGL(): boolean {
  if (webglSupport === null) {
    try {
      const probe = document.createElement('canvas')
      webglSupport = Boolean(probe.getContext('webgl2') || probe.getContext('webgl'))
    } catch {
      webglSupport = false
    }
  }
  return webglSupport
}

type SaveData = Navigator & { connection?: { saveData?: boolean } }

export function useAllowAmbient(): boolean {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const lean = useMediaQuery('(prefers-reduced-data: reduce)')

  // Sampled synchronously so the first paint is already the right one: starting
  // at `false` would flash the static gradient at everyone before upgrading.
  const [allowed, setAllowed] = useState(() => {
    if (typeof document === 'undefined') return false
    const conn = (navigator as SaveData).connection
    return (
      document.documentElement.dataset.motion !== 'reduce' &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      !matchMedia('(prefers-reduced-data: reduce)').matches &&
      !conn?.saveData &&
      hasWebGL()
    )
  })

  useEffect(() => {
    const el = document.documentElement
    const compute = () => {
      const conn = (navigator as SaveData).connection
      setAllowed(
        !reduced &&
          !lean &&
          el.dataset.motion !== 'reduce' &&
          !conn?.saveData &&
          hasWebGL(),
      )
    }
    compute()
    const mo = new MutationObserver(compute)
    mo.observe(el, { attributes: true, attributeFilter: ['data-motion'] })
    return () => mo.disconnect()
  }, [reduced, lean])

  return allowed
}

/* True while the tab is foregrounded. Decorative render loops should stop
   when it is not — a backgrounded tab that keeps requesting frames is a
   battery complaint waiting to happen on a school laptop. */
export function useTabVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? false : !document.hidden,
  )
  useEffect(() => {
    const on = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      /* ignore */
    }
  }, [key, v])
  return [v, setV]
}

/* A ticking clock. Returns Date.now() on an interval; components that need it
   re-render on the tick, which is why the exam bar is its own component. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}

export function useToggleSet<T extends string | number>(initial: T[] = []) {
  const [items, setItems] = useState<T[]>(initial)
  const toggle = useCallback((item: T) => {
    setItems((x) => (x.includes(item) ? x.filter((i) => i !== item) : [...x, item]))
  }, [])
  const clear = useCallback(() => setItems([]), [])
  const all = useCallback((next: T[]) => setItems(next), [])
  return { items, toggle, clear, all, has: (i: T) => items.includes(i) }
}

export function useOutside<T extends HTMLElement>(onOutside: () => void, active = true) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!active) return
    const on = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', on)
    return () => document.removeEventListener('mousedown', on)
  }, [onOutside, active])
  return ref
}

/* Copy to clipboard with a graceful fallback, because a locked-down school
   machine will refuse the async API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    fnRef
      .current()
      .then((d) => {
        if (live) setData(d)
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'Request failed')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []) }
}

/* Live bank-preparation status for one teacher.
   Loads once, then polls fast only while any subject is still being prepared,
   and stops as soon as everything is ready — a quiet teacher with a full bank
   must not trip the network every ten seconds. Polling pauses while the tab is
   hidden and resumes when it is visible again. */
const BANK_POLL_MS = 10_000

export function useSubjectStatus(): {
  subjects: SubjectRow[]
  queue: number
  target: number
  loading: boolean
  error: string | null
  refresh: () => void
} {
  const visible = useTabVisible()
  const { data, error, loading, reload } = useAsync(() => api.mySubjects(), [])
  const peers = data?.subjects ?? []
  const anyPreparing = peers.some((s) => s.status !== 'ready')

  useEffect(() => {
    if (!visible || !anyPreparing) return
    const t = window.setInterval(() => reload(), BANK_POLL_MS)
    return () => window.clearInterval(t)
  }, [visible, anyPreparing, reload])

  return {
    subjects: peers,
    queue: data?.queue ?? 0,
    target: data?.target ?? 0,
    loading,
    error,
    refresh: reload,
  }
}
