import { ACTION_OVERRIDES, KNOWN_VERBS, type DerivedAction } from './config'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `/api/clients/abc?x=1` → `/api/clients/abc` */
export function stripQuery(path: string): string {
  const i = path.indexOf('?')
  return i === -1 ? path : path.slice(0, i)
}

/**
 * Padrão da rota com parâmetros nomeados (`/api/clients/:id`).
 * Usa o padrão resolvido pelo roteador; sem ele, troca UUIDs e números por `:id`.
 */
export function routePatternFor(path: string, matched?: string | null): string {
  if (matched) return matched.replace(/\*\*?/g, ':p')
  return stripQuery(path)
    .split('/')
    .map(seg => (UUID.test(seg) || /^\d+$/.test(seg) ? ':id' : seg))
    .join('/')
}

/** Chave estável para comparar com as listas de config: todo parâmetro vira `:p`. */
export function normalizePattern(pattern: string): string {
  return pattern.split('/').map(seg => (seg.startsWith(':') ? ':p' : seg)).join('/')
}

export function snake(value: string): string {
  return value.replace(/-/g, '_')
}

export function singular(value: string): string {
  if (value.endsWith('ies')) return `${value.slice(0, -3)}y`
  if (/(uses|xes|ches|shes|sses)$/.test(value)) return value.slice(0, -2)
  if (value.endsWith('ss') || value.endsWith('us') || !value.endsWith('s')) return value
  return value.slice(0, -1)
}

const METHOD_VERB: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
  GET: 'view'
}

/**
 * Deriva action / resource_type / resource_id sem mapear cada rota (§5.6):
 * `POST /api/clients` → client.create · `POST /api/service-orders/:id/cancel` → service_order.cancel.
 */
export function deriveAction(input: {
  method: string
  pattern: string
  params?: Record<string, unknown> | null
  body?: Record<string, unknown> | null
}): DerivedAction {
  const method = input.method.toUpperCase()
  const all = input.pattern.split('/').filter(Boolean).slice(1) // sem "api"
  // /api/admin/** é o painel do owner: o recurso é o que vem depois (admin/audit-logs → audit_log).
  const segments = all[0] === 'admin' && all.length > 1 ? all.slice(1) : all
  const params = input.params ?? {}

  const names: string[] = []
  let lastParamName: string | null = null
  const statics = segments.filter(seg => !seg.startsWith(':'))
  const lastSegment = segments[segments.length - 1]
  const lastIsStatic = lastSegment !== undefined && !lastSegment.startsWith(':')

  for (const seg of segments) {
    if (seg.startsWith(':')) {
      lastParamName = seg.slice(1)
      continue
    }
    const isVerbTail = lastIsStatic && seg === lastSegment && statics.length > 1 && isVerb(seg)
    // Rota de um segmento só (ex.: /api/clients) é recurso, mesmo que o nome pareça verbo.
    if (isVerbTail) continue
    names.push(snake(singular(seg)))
  }

  const resourceType = names.length ? names.join('.') : undefined
  const tail = lastIsStatic && statics.length > 1 && isVerb(lastSegment!) ? snake(lastSegment!) : null
  const verb = tail ?? METHOD_VERB[method] ?? method.toLowerCase()

  let resourceId = lastParamName && params[lastParamName] != null ? String(params[lastParamName]) : undefined
  let action = `${resourceType ?? 'api'}.${verb}`

  const override = ACTION_OVERRIDES[`${method} ${normalizePattern(input.pattern)}`]
  if (typeof override === 'string') {
    action = override
  } else if (override) {
    const result = override(input.body ?? null)
    action = result.action
    if (result.resourceId) resourceId = result.resourceId
  }

  return {
    action,
    resourceType: resourceType ? resourceType.split('.')[0]! : undefined,
    resourceId
  }
}

function isVerb(segment: string): boolean {
  return KNOWN_VERBS.has(segment) || segment.startsWith('export')
}
