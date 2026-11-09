import type { H3Event } from 'h3'
import { sanitizeAndCap, MAX_REQUEST_BYTES } from './sanitize'
import { setAuditContext } from './context'

const DEFAULT_IGNORE = ['updated_at', 'updated_by', 'created_at', 'created_by']

type Snapshot = Record<string, unknown>

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Diff campo a campo: `{ campo: { from, to } }` só para o que mudou. */
export function diffSnapshots(before: Snapshot, after: Snapshot, ignore: string[] = DEFAULT_IGNORE) {
  const diff: Record<string, { from: unknown, to: unknown }> = {}
  const skip = new Set(ignore)
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (skip.has(key)) continue
    if (!same(before[key], after[key])) diff[key] = { from: before[key] ?? null, to: after[key] ?? null }
  }
  return { changed_fields: Object.keys(diff), diff }
}

/** Resultado de `recordAudit`, útil em testes. */
export function buildChanges(input: { before?: Snapshot | null, after?: Snapshot | null, ignore?: string[] }) {
  const { before, after } = input
  if (before && after) {
    const result = diffSnapshots(before, after, input.ignore)
    return sanitizeAndCap(result, MAX_REQUEST_BYTES).truncated
      ? { changed_fields: result.changed_fields, truncated: true }
      : result
  }
  // Criação (só `after`) ou exclusão (só `before`): guarda o snapshot, sem os campos ignorados.
  const snapshot = (before ?? after) as Snapshot | null | undefined
  if (!snapshot) return null
  const skip = new Set(input.ignore ?? DEFAULT_IGNORE)
  const trimmed = Object.fromEntries(Object.entries(snapshot).filter(([key]) => !skip.has(key)))
  const capped = sanitizeAndCap(trimmed, MAX_REQUEST_BYTES)
  return before ? { before: capped.value, truncated: capped.truncated } : { after: capped.value, truncated: capped.truncated }
}

/**
 * Camada 2: anexa o antes/depois à MESMA linha de auditoria da requisição (mesmo request_id).
 * Não faz I/O e nunca lança; sem contexto de auditoria (fora de /api) não faz nada.
 */
export function recordAudit(event: H3Event, input: {
  action?: string
  resourceType?: string
  resourceId?: string
  before?: Snapshot | null
  after?: Snapshot | null
  ignore?: string[]
  /** Contexto livre (ex.: quantos registros uma operação em cascata removeu). */
  extra?: Record<string, unknown>
}): void {
  try {
    const base = buildChanges(input)
    const changes = input.extra ? { ...(base ?? {}), extra: input.extra } : base
    setAuditContext(event, {
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      changes: changes ? (changes as Record<string, unknown>) : undefined
    })
  } catch (err) {
    console.warn('[audit] recordAudit ignorado:', (err as Error)?.message)
  }
}
