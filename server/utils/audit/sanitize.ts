// Sanitização obrigatória antes de gravar corpos no log (docs/audit/audit-log-plan.md §5.3).

export const REDACTED = '[REDACTED]'

export const MAX_REQUEST_BYTES = 32 * 1024
export const MAX_RESPONSE_BYTES = 16 * 1024

// Nome de campo (minúsculo) que nunca vai para o log, em qualquer profundidade.
const SENSITIVE_EXACT = new Set([
  'password', 'new_password', 'current_password', 'newpassword', 'currentpassword', 'confirmpassword',
  'token', 'access_token', 'refresh_token', 'accesstoken', 'refreshtoken', 'secret', 'api_key', 'apikey',
  'authorization', 'cvv', 'cvc', 'cookie', 'set-cookie'
])
const SENSITIVE_PREFIX = ['card', 'certificate', 'certificado', 'senha']
const MAX_DEPTH = 12

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  return SENSITIVE_EXACT.has(k) || SENSITIVE_PREFIX.some(prefix => k.startsWith(prefix))
}

/** Cópia profunda com campos sensíveis redigidos. Nunca lança e não segue ciclos. */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? value.toString() : value
  }
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]'
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)

  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1, seen))
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1, seen)
  }
  return out
}

export function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
  } catch {
    return 0
  }
}

/** Resumo de um objeto grande: chaves de 1º nível e tamanho de cada array. */
export function summarize(value: unknown): unknown {
  if (Array.isArray(value)) return { type: 'array', length: value.length }
  if (value && typeof value === 'object') {
    const summary: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      summary[key] = Array.isArray(item)
        ? { type: 'array', length: item.length }
        : item !== null && typeof item === 'object' ? { type: 'object', keys: Object.keys(item).length } : typeof item
    }
    return summary
  }
  return { type: typeof value }
}

export interface Capped {
  value: unknown
  truncated: boolean
  size: number
}

/** Redige e, se passar do teto, troca o conteúdo por um resumo (`truncated = true`). */
export function sanitizeAndCap(value: unknown, maxBytes: number): Capped {
  if (value === undefined || value === null) return { value: null, truncated: false, size: 0 }
  const clean = redact(value)
  const size = byteLength(clean)
  if (size <= maxBytes) return { value: clean, truncated: false, size }
  return { value: summarize(clean), truncated: true, size }
}

/** Corpo de rota de login/cadastro: guarda só o e-mail (e nunca a senha). */
export function pickEmail(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const email = (body as Record<string, unknown>).email
  return typeof email === 'string' && email.length <= 200 ? email.trim().toLowerCase() : null
}

/** Parâmetros de query com campos sensíveis redigidos; vazio vira null. */
export function sanitizeQuery(query: Record<string, unknown> | null | undefined): unknown {
  if (!query || Object.keys(query).length === 0) return null
  return sanitizeAndCap(query, MAX_REQUEST_BYTES).value
}
