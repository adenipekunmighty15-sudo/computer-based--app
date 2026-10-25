export function download(name: string, data: unknown) {
  const blob = new Blob(
    [typeof data === 'string' ? data : JSON.stringify(data, null, 2)],
    { type: 'application/json' },
  )
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}