import { getResponseStatus, readBody } from 'h3'
import type { H3Event } from 'h3'
import { actionRuleFor, resolveActionEvent } from '../utils/analytics/actions'
import { hashUser, resolveAnalyticsIdentity } from '../utils/analytics/identity'
import {
  analyticsEnabled,
  analyticsSecret,
  insertAnalyticsRows,
  requestContext
} from '../utils/analytics/record'

/**
 * Emite eventos de AÇÃO de negócio depois que a resposta foi enviada, só para 2xx.
 * Não bloqueia o usuário e nunca lança. Grava apenas o nome do evento (sem IDs, corpo ou texto).
 */
async function handle(event: H3Event) {
  const method = event.method
  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return

  const path = event.path || ''
  if (!path.startsWith('/api/') || path.startsWith('/api/metrics/')) return

  const status = getResponseStatus(event)
  if (status < 200 || status >= 300) return

  const rule = actionRuleFor(method, path)
  if (!rule) return
  if (!analyticsEnabled(event)) return

  let body: Record<string, unknown> | null = null
  if (rule.needsBody) {
    try {
      const parsed = await readBody(event)
      body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
      body = null
    }
  }

  const identity = await resolveAnalyticsIdentity(event)
  // Ações pertencem a uma oficina; owner da plataforma não suja os números.
  if (!identity.userId || !identity.organizationId || identity.isOwner) return

  const context = requestContext(event)
  await insertAnalyticsRows([{
    user_hash: hashUser(identity.userId, analyticsSecret(event)),
    organization_id: identity.organizationId,
    session_id: context.sessionId ?? 'server',
    event: resolveActionEvent(rule, body),
    area: null,
    platform: context.platform,
    country: context.country,
    traffic: context.traffic,
    bot: context.bot,
    bot_purpose: context.botPurpose,
    duration_ms: null,
    step: null,
    attribution: null
  }])
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('afterResponse', (event: H3Event) => {
    void handle(event).catch((err) => {
      console.warn('[analytics] ação ignorada:', (err as Error)?.message)
    })
  })
})
