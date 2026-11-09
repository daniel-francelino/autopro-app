import { getHeader, getRequestIP, readBody } from 'h3'
import {
  ATTRIBUTION_EVENTS,
  MAX_EVENTS_PER_BATCH,
  cleanClientEvent,
  normalizePlatform,
  normalizeSessionId,
  type RawClientEvent
} from '../../../lib/analytics/events'
import { sanitizeAttribution } from '../../../lib/analytics/attribution'
import { hashUser, resolveAnalyticsIdentity } from '../../utils/analytics/identity'
import {
  analyticsEnabled,
  analyticsSecret,
  insertAnalyticsRows,
  requestContext,
  takeRateLimit,
  type AnalyticsRow
} from '../../utils/analytics/record'

/**
 * POST /api/metrics/track — coletor público de telemetria (lote de até 25 eventos).
 * Visitantes são aceitos. Tudo é validado contra listas fechadas; o servidor resolve a identidade
 * (nunca confia no cliente), pseudonimiza o usuário e NÃO grava IP nem User-Agent.
 * Responde `{ ok: true }` sempre que o corpo for válido — erros internos nunca chegam ao usuário.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const sessionId = normalizeSessionId(body?.sessionId)
  const rawEvents: unknown = body?.events

  if (!sessionId || !Array.isArray(rawEvents) || rawEvents.length === 0 || rawEvents.length > MAX_EVENTS_PER_BATCH) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid payload' })
  }

  if (!analyticsEnabled(event)) return { ok: true, dropped: rawEvents.length }

  try {
    const identity = await resolveAnalyticsIdentity(event)
    // Owner da plataforma não suja os números.
    if (identity.isOwner) return { ok: true, dropped: rawEvents.length }

    const secret = analyticsSecret(event)
    const userHash = identity.userId ? hashUser(identity.userId, secret) : 'visitor'
    const context = requestContext(event)
    const platform = normalizePlatform(body?.platform) ?? context.platform

    const rateKey = identity.userId ?? `ip:${getRequestIP(event, { xForwardedFor: true }) ?? getHeader(event, 'user-agent') ?? 'unknown'}`
    const allowed = takeRateLimit(rateKey, rawEvents.length)

    const rows: AnalyticsRow[] = []
    for (const raw of rawEvents.slice(0, allowed)) {
      const clean = cleanClientEvent((raw ?? {}) as RawClientEvent)
      if (!clean) continue
      rows.push({
        user_hash: userHash,
        organization_id: identity.organizationId,
        session_id: sessionId,
        event: clean.event,
        area: clean.area,
        platform,
        country: context.country,
        traffic: context.traffic,
        bot: context.bot,
        bot_purpose: context.botPurpose,
        duration_ms: clean.durationMs,
        step: clean.step,
        attribution: ATTRIBUTION_EVENTS.has(clean.event) ? sanitizeAttribution(clean.attribution) : null,
        created_at: clean.createdAt.toISOString()
      })
    }

    await insertAnalyticsRows(rows)
    return { ok: true, dropped: rawEvents.length - rows.length }
  } catch (err) {
    console.warn('[analytics] coletor ignorou o lote:', (err as Error)?.message)
    return { ok: true }
  }
})
