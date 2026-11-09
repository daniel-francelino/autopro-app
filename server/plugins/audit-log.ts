import { randomUUID } from 'node:crypto'
import { getHeader, getQuery, getResponseStatus, readBody, setResponseHeader } from 'h3'
import type { H3Event } from 'h3'
import type { AuditContext } from '../types/audit'
import { buildAuditRow, isMultipart, shouldAudit } from '../utils/audit/build'
import { enqueueAudit, flushAudit } from '../utils/audit/queue'

/**
 * Log de auditoria (docs/audit/audit-log-plan.md, Camada 1): uma linha por requisição relevante em /api/**.
 * Nunca bloqueia nem quebra a resposta: tudo roda depois que ela saiu e dentro de try/catch.
 */

const BODY_READ_TIMEOUT_MS = 1000

function matchedRoute(event: H3Event): string | null {
  const matched = (event.context as { matchedRoute?: { path?: string } }).matchedRoute
  // O catch-all do Nuxt (`/**`) atende qualquer URL desconhecida: não é uma rota de API de verdade.
  const path = matched?.path
  return path && !path.includes('**') ? path : null
}

function errorFrom(value: unknown): AuditContext['error'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const err = value as { statusCode?: number, statusMessage?: string, message?: string, data?: unknown }
  if (typeof err.statusCode !== 'number') return undefined
  return { statusCode: err.statusCode, message: err.statusMessage || err.message || 'Error', data: err.data }
}

/** Lê o JSON já em cache do handler; handlers que não leram o corpo não podem travar o log. */
async function readJsonBody(event: H3Event): Promise<unknown> {
  const contentType = getHeader(event, 'content-type')
  if (isMultipart(contentType) || !contentType?.toLowerCase().includes('json')) return undefined
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), BODY_READ_TIMEOUT_MS)
    })
    try {
      return await Promise.race([readBody(event), timeout])
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return undefined
  }
}

async function log(event: H3Event, response: { body?: unknown } | undefined) {
  const ctx = event.context.audit
  if (!ctx || ctx.logged) return
  ctx.logged = true

  const status = getResponseStatus(event)
  const route = matchedRoute(event)
  const decision = shouldAudit({
    method: event.method,
    path: event.path,
    matchedRoute: route,
    hasUser: Boolean(ctx.userId),
    status
  })
  if (process.env.AUDIT_DEBUG) {
    console.log('[audit:debug]', event.method, event.path, { route, status, user: ctx.userId ?? null, audit: decision.audit })
  }
  if (!decision.audit) return

  if (status >= 400 && !ctx.error) ctx.error = errorFrom(response?.body)

  const row = buildAuditRow({
    ctx,
    method: event.method,
    path: event.path,
    matchedRoute: route,
    params: event.context.params as Record<string, unknown> | undefined,
    query: getQuery(event) as Record<string, unknown>,
    status,
    body: event.method === 'GET' ? undefined : await readJsonBody(event),
    contentType: getHeader(event, 'content-type'),
    contentLength: Number(getHeader(event, 'content-length')) || null,
    headers: {
      userAgent: getHeader(event, 'user-agent'),
      forwardedFor: getHeader(event, 'x-forwarded-for'),
      realIp: getHeader(event, 'x-real-ip'),
      vercelForwardedFor: getHeader(event, 'x-vercel-forwarded-for'),
      socketIp: event.node?.req?.socket?.remoteAddress,
      platform: getHeader(event, 'x-client-platform')
    }
  })
  enqueueAudit(event, row)
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event: H3Event) => {
    try {
      if (!event.path?.startsWith('/api/')) return
      const requestId = randomUUID()
      event.context.audit = { requestId, startedAt: Date.now() }
      setResponseHeader(event, 'X-Request-Id', requestId)
    } catch (err) {
      console.warn('[audit] request ignorado:', (err as Error)?.message)
    }
  })

  // Quando o handler lança, o Nitro envia a resposta de erro por conta própria e o h3 NÃO chama
  // `afterResponse` (event.handled). Por isso o erro é registrado aqui; `ctx.logged` evita duplicar.
  nitroApp.hooks.hook('error', (error: Error, context: { event?: H3Event, tags?: string[] }) => {
    try {
      const event = context?.event
      const ctx = event?.context.audit
      if (!event || !ctx) return
      ctx.error = errorFrom(error) ?? { statusCode: 500, message: error.message }
      const tags = context.tags ?? []
      if (tags.includes('request') && !tags.includes('response') && ctx.error.statusCode >= 400) {
        void log(event, { body: error }).catch((err) => {
          console.error('[audit] falha ao montar linha:', (err as Error)?.message)
        })
      }
    } catch { /* o log nunca atrapalha a requisição */ }
  })

  nitroApp.hooks.hook('beforeResponse', (event: H3Event, response: { body?: unknown }) => {
    try {
      const ctx = event.context.audit
      if (!ctx || event.method !== 'GET' || getResponseStatus(event) >= 400) return
      const route = matchedRoute(event)
      if (route && shouldAudit({ method: 'GET', path: event.path, matchedRoute: route, hasUser: true }).captureResponse) {
        ctx.responseBody = response?.body
      }
    } catch { /* idem */ }
  })

  nitroApp.hooks.hook('afterResponse', (event: H3Event, response: { body?: unknown } | undefined) => {
    void log(event, response).catch((err) => {
      console.error('[audit] falha ao montar linha:', (err as Error)?.message)
    })
  })

  nitroApp.hooks.hook('close', () => flushAudit())
})
