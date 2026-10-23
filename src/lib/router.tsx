import { useCallback, useEffect, useMemo, useState, type ReactNode, type MouseEvent } from 'react'

/* A router with no dependencies and no hash.

   Two reasons it is hand-rolled rather than pulled in: the app has eleven
   routes and none of them nest, and every one of them needs to be
   link-addressable so a teacher can send a colleague straight to a paper.
   History API + one popstate listener is the whole requirement. */

export interface Route {
  path: string
  parts: string[]
  query: URLSearchParams
}

function read(): Route {
  const path = window.location.pathname || '/'
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(window.location.search) }
}

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', emit)
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(read)
  useEffect(() => {
    const l = () => setRoute(read())
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return route
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  emit()
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
}

export function href(to: string): string {
  return to
}

interface LinkProps {
  to: string
  children: ReactNode
  className?: string
  title?: string
  onClick?: () => void
  'aria-label'?: string
  'aria-current'?: 'page' | 'true'
  'data-tip'?: string
  id?: string
}

/* A link that routes on the client and still behaves like a link: middle-click
   and ctrl-click open a new tab because the href is real. */
export function Link({
  to,
  children,
  onClick,
  ...rest
}: LinkProps) {
  const on = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.()
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} onClick={on} {...rest}>
      {children}
    </a>
  )
}

/* ── Query-string state ───────────────────────────────────────────────────
   Anything a teacher would want to survive a refresh, send to a colleague, or
   find again after lunch lives in the URL. Sort order, page, density, column
   set, active filters — all of it. */

export function useQuery(): URLSearchParams {
  return useRoute().query
}

export function useQueryParam(key: string, fallback = ''): [string, (v: string | null) => void] {
  const route = useRoute()
  const value = route.query.get(key) ?? fallback
  const set = useCallback(
    (v: string | null) => {
      const q = new URLSearchParams(window.location.search)
      if (v === null || v === '' || v === fallback) q.delete(key)
      else q.set(key, v)
      const qs = q.toString()
      navigate(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { replace: true })
    },
    [key, fallback],
  )
  return [value, set]
}

/* Several params set at once — a filter click changes three keys and must be a
   single history entry, not three. */
export function useQueryPatch(): (patch: Record<string, string | null>) => void {
  return useCallback((patch) => {
    const q = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') q.delete(k)
      else q.set(k, v)
    }
    const qs = q.toString()
    navigate(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { replace: true })
  }, [])
}

export function useSearch(): [string, (v: string) => void] {
  const [raw, setRaw] = useQueryParam('q')
  const [local, setLocal] = useState(raw)
  useEffect(() => setLocal(raw), [raw])

  // Debounced into the URL so every keystroke is not a history entry, but the
  // visible input stays instant.
  useEffect(() => {
    if (local === raw) return
    const t = window.setTimeout(() => setRaw(local), 220)
    return () => window.clearTimeout(t)
  }, [local, raw, setRaw])

  return [local, setLocal]
}

export function clearQuery() {
  navigate(window.location.pathname, { replace: true })
}

/* Match a path against a pattern with `:param` segments. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean)
  const a = path.split('/').filter(Boolean)
  if (p.length !== a.length) return null
  const out: Record<string, string> = {}
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) out[p[i].slice(1)] = decodeURIComponent(a[i])
    else if (p[i] !== a[i]) return null
  }
  return out
}

/* One-time scroll restore per path, so going back to a list puts you where you
   were in it rather than at the top. */
const restore = new Map<string, number>()

export function useScrollMemory(key: string, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const y = restore.get(key) ?? 0
    if (y) el.scrollTop = y
    return () => {
      restore.set(key, el.scrollTop)
    }
  }, [key, ref])
}

export function useIsActive(path: string, exact = false): boolean {
  const route = useRoute()
  return useMemo(
    () => (exact ? route.path === path : route.path === path || route.path.startsWith(`${path}/`)),
    [route.path, path, exact],
  )
}
