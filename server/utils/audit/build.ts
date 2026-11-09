import { isIP } from 'node:net'
import type { AuditContext } from '../../types/audit'
import { normalizePlatform } from '../../../lib/analytics/events'
import { ALWAYS_AUDIT_GET_ROUTES, AUTH_ROUTE_PREFIX, DETAIL_GET_ROUTES, IGNORED_ROUTES } from './config'
import { deriveAction, normalizePattern, stripQuery } from './derive'
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, pickEmail, redact, sanitizeAndCap, sanitizeQuery } from './sanitize'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export type Outcome = 'success' | 'denied' | 'invalid' | 'error'

/** success = 2xx/3xx · denied = 401/403 · invalid = 400/404/409/422 · error = 5xx e o resto. */
export function outcomeFor(status: number): Outcome {
  if (status >= 200 && status < 400) return 'success'
  if (status === 401 || status === 403) return 'denied'
  if ([400, 404, 409, 422].includes(status)) return 'invalid'
  return 'error'
}

export interface AuditDecision {
  audit: boolean
  /** Guardar o corpo da resposta (GET de detalhe com sucesso). */
  captureResponse: boolean
}

/** Quais requisições entram no log (§5.2). */
export function shouldAudit(input: {
  method: string
  path: string
  matchedRoute?: string | null
  hasUser: boolean
  status?: number
}): AuditDecision {
  const none = { audit: false, captureResponse: false }
  const method = input.method.toUpperCase()
  const path = stripQuery(input.path)
  if (!path.startsWith('/api/')) return none

  const pattern = normalizePattern(input.matchedRoute ?? path)
  const key = `${method} ${pattern}`
  if (IGNORED_ROUTES.has(key) || IGNORED_ROUTES.has(`${method} ${path}`)) return none

  // Rota inexistente de visitante sem sessão: varredura de bots.
  if (!input.matchedRoute && !input.hasUser) return none

  if (WRITE_METHODS.has(method)) return { audit: true, captureResponse: false }

  if (method === 'GET') {
    if (ALWAYS_AUDIT_GET_ROUTES.has(key)) return { audit: true, captureResponse: false }
    const detail = DETAIL_GET_ROUTES.has(key) && !path.startsWith(AUTH_ROUTE_PREFIX)
    if (detail) return { audit: true, captureResponse: true }
    const failed = input.status !== undefined && input.status >= 400
    return { audit: failed, captureResponse: false }
  }
  return none
}

export interface RowInput {
  ctx: AuditContext
  method: string
  path: string
  matchedRoute?: string | null
  params?: Record<string, unknown> | null
  query?: Record<string, unknown> | null
  status: number
  /** Corpo JSON já lido; `undefined` quando não houve ou é multipart. */
  body?: unknown
  contentType?: string | null
  contentLength?: number | null
  headers: {
    userAgent?: string | null
    forwardedFor?: string | null
    realIp?: string | null
    vercelForwardedFor?: string | null
    socketIp?: string | null
    platform?: string | null
  }
}

export interface AuditRow {
  request_id: string
  organization_id: string | null
  actor_user_id: string | null
  actor_email: string | null
  actor_role: string | null
  actor_type: string
  action: string
  resource_type: string | null
  resource_id: string | null
  http_method: string
  http_path: string
  route_pattern: string | null
  status_code: number
  outcome: Outcome
  error_message: string | null
  duration_ms: number | null
  query_params: unknown
  request_body: unknown
  body_truncated: boolean
  response_body: unknown
  response_truncated: boolean
  response_size_bytes: number | null
  changes: unknown
  ip_address: string | null
  user_agent: string | null
  platform: string | null
}

const cut = (value: string | null | undefined, max: number): string | null =>
  value ? value.slice(0, max) : null

function pickIp(headers: RowInput['headers']): string | null {
  const candidates = [
    headers.vercelForwardedFor,
    headers.forwardedFor?.split(',')[0],
    headers.realIp,
    headers.socketIp
  ]
  for (const raw of candidates) {
    const ip = raw?.trim().replace(/^::ffff:/, '')
    if (ip && isIP(ip)) return ip
  }
  return null
}

export function isMultipart(contentType?: string | null): boolean {
  return !!contentType && contentType.toLowerCase().startsWith('multipart/')
}

/** Monta a linha de auditoria a partir de dados simples (testável sem H3). */
export function buildAuditRow(input: RowInput): AuditRow {
  const { ctx } = input
  const method = input.method.toUpperCase()
  const path = stripQuery(input.path)
  const pattern = input.matchedRoute ?? path
  const body = (input.body && typeof input.body === 'object') ? input.body as Record<string, unknown> : null

  const derived = deriveAction({ method, pattern, params: input.params, body })
  const action = ctx.action ?? derived.action

  const isAuth = path.startsWith(AUTH_ROUTE_PREFIX)
  const failed = input.status >= 400

  // Corpo da requisição
  let requestBody: unknown = null
  let bodyTruncated = false
  if (isMultipart(input.contentType)) {
    requestBody = { multipart: true, content_type: input.contentType, size_bytes: input.contentLength ?? null }
  } else if (body !== null) {
    const capped = sanitizeAndCap(input.body, MAX_REQUEST_BYTES)
    requestBody = capped.value
    bodyTruncated = capped.truncated
  } else if (Array.isArray(input.body)) {
    const capped = sanitizeAndCap(input.body, MAX_REQUEST_BYTES)
    requestBody = capped.value
    bodyTruncated = capped.truncated
  }

  // Corpo da resposta: erros sempre; GET de detalhe com sucesso; nunca em /api/auth/*
  let responseBody: unknown = null
  let responseTruncated = false
  let responseSize: number | null = null
  if (failed && ctx.error) {
    const capped = sanitizeAndCap({ statusCode: ctx.error.statusCode, message: ctx.error.message, data: ctx.error.data }, MAX_RESPONSE_BYTES)
    responseBody = capped.value
    responseTruncated = capped.truncated
    responseSize = capped.size
  } else if (!failed && !isAuth && ctx.responseBody !== undefined) {
    const capped = sanitizeAndCap(ctx.responseBody, MAX_RESPONSE_BYTES)
    responseBody = capped.value
    responseTruncated = capped.truncated
    responseSize = capped.size
  }

  const actorType = ctx.actorType ?? (ctx.userId ? 'user' : 'anonymous')
  // Sem sessão (login/cadastro/reset): o e-mail digitado é a única pista de quem tentou.
  const email = ctx.email ?? (ctx.userId ? null : pickEmail(body))

  return {
    request_id: ctx.requestId,
    organization_id: ctx.organizationId && UUID.test(ctx.organizationId) ? ctx.organizationId : null,
    actor_user_id: ctx.userId && UUID.test(ctx.userId) ? ctx.userId : null,
    actor_email: cut(email, 200),
    actor_role: cut(ctx.role ?? (actorType === 'owner' ? 'owner' : null), 100),
    actor_type: actorType,
    action: action.slice(0, 100),
    resource_type: cut(ctx.resourceType ?? derived.resourceType, 60),
    resource_id: cut(ctx.resourceId ?? derived.resourceId, 100),
    http_method: method.slice(0, 10),
    http_path: path.slice(0, 300),
    route_pattern: cut(input.matchedRoute ? input.matchedRoute : pattern, 300),
    status_code: input.status,
    outcome: outcomeFor(input.status),
    error_message: failed ? cut(ctx.error?.message ?? null, 2000) : null,
    duration_ms: Math.max(0, Date.now() - ctx.startedAt),
    query_params: sanitizeQuery(input.query),
    request_body: requestBody,
    body_truncated: bodyTruncated,
    response_body: responseBody,
    response_truncated: responseTruncated,
    response_size_bytes: responseSize,
    changes: ctx.changes ? redact(ctx.changes) : null,
    ip_address: pickIp(input.headers),
    user_agent: cut(input.headers.userAgent, 400),
    platform: normalizePlatform(input.headers.platform ?? undefined)
  }
}
