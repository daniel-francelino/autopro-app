export function normalizeOsNumber(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const match = raw.match(/^\s*(?:OS)?\s*(\d{1,})\s*$/i)
  if (match) return `OS${match[1]}`
  return raw
}
