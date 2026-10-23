/* Formatting. Every number the app prints goes through here so a mark sheet
   from March and one from November are formatted identically. */

export const nf = new Intl.NumberFormat('en-GB')
export const nf1 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function n(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return nf.format(v)
}

export function pct(v: number | null | undefined, dp = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${v.toFixed(dp)}%`
}

export function frac(part: number, whole: number, dp = 0): string {
  if (!whole) return '0'
  return ((part / whole) * 100).toFixed(dp)
}

/* Marks read as "18 / 40" in prose and as "18" in a column. */
export function marks(got: number, max: number): string {
  return `${n(got)}/${n(max)}`
}

export function dur(minutes: number): string {
  if (!minutes || minutes < 1) return '—'
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} hr ${m} min` : `${h} hr`
}

/* A clock. Used for a deadline, a submission, and the exam timer — so it
   always shows a leading zero in the seconds column and never shows hours. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`
}

export function seconds(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const DAY = 86_400_000

/* A Date is accepted as readily as a timestamp, because half these helpers are
   called with one already in hand — a deadline parsed from a payload, a mark
   sheet row — and converting back and forth at every call site is how a
   timezone bug gets written. */
type Stamp = number | string | Date | null | undefined

const toDate = (ts: Stamp): Date | null => {
  if (ts === null || ts === undefined) return null
  const d = ts instanceof Date ? ts : new Date(ts)
  return Number.isNaN(d.getTime()) ? null : d
}

export function dateShort(ts: Stamp): string {
  const d = toDate(ts)
  if (!d) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export function dateLong(ts: Stamp): string {
  const d = toDate(ts)
  if (!d) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function dateTime(ts: Stamp): string {
  const d = toDate(ts)
  if (!d) return '—'
  return `${dateShort(d)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

export function timeOnly(ts: number | string): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/* "4 days ago" for an activity feed, "Today" for a mark sheet. */
export function ago(ts: number, now = Date.now()): string {
  const diff = now - ts
  if (diff < 0) return 'scheduled'
  if (diff < 45_000) return 'just now'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(diff / 3_600_000)
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(diff / DAY)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} wk ago`
  return dateShort(ts)
}

export function dueIn(ms: number): { label: string; tone: 'jade' | 'brass' | 'vermilion' } {
  if (ms <= 0) return { label: 'Closed', tone: 'vermilion' }
  if (ms < 3_600_000) return { label: `${Math.max(1, Math.round(ms / 60_000))} min left`, tone: 'vermilion' }
  if (ms < DAY) return { label: `${Math.round(ms / 3_600_000)} hr left`, tone: 'brass' }
  return { label: `${Math.round(ms / DAY)} days left`, tone: 'jade' }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/* Truncate on a word boundary, so a question stem never ends mid-word in a
   table cell. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return `${sp > max * 0.6 ? cut.slice(0, sp) : cut}…`
}

export function bytes(kb: number): string {
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export function ms(v: number): string {
  if (v < 1000) return `${Math.round(v)} ms`
  return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)} s`
}
