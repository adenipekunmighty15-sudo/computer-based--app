/* CSV. Teachers paste mark sheets into a spreadsheet the same day, so export
   is a first-class feature, not a debug affordance. */

function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const head = headers.map(cell).join(',')
  const body = rows.map((r) => r.map(cell).join(',')).join('\r\n')
  return `${head}\r\n${body}`
}

export function downloadCsv(name: string, headers: string[], rows: unknown[][]) {
  const csv = toCsv(headers, rows)
  // A BOM, because Excel on a school machine will otherwise read UTF-8 as Latin-1
  // and turn every teacher's name into mojibake.
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name.endsWith('.csv') ? name : `${name}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/* Parse a pasted or uploaded mark sheet. Tolerates the two shapes teachers
   actually have: a header row with named columns, and a headerless grid. */
export function parseCsv(text: string, opts: { header?: boolean } = {}): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  const src = text.replace(/\r\n?/g, '\n')

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
      continue
    }
    if (ch === '"') {
      quoted = true
      continue
    }
    if (ch === ',') {
      row.push(cur)
      cur = ''
      continue
    }
    if (ch === '\n') {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur || row.length) {
    row.push(cur)
    rows.push(row)
  }
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ''))
  if (opts.header === false) return clean
  return clean
}
