import type { H3Event } from 'h3'
import { getHeader } from 'h3'
import {
  normalizePlatform,
  normalizeSessionId,
  type AnalyticsEvent,
  type Platform
} from '../../../lib/analytics/events'
import { sanitizeAttribution } from '../../../lib/analytics/attribution'
import { classifyTraffic } from '../../../lib/analytics/traffic'
import { getSupabaseAdminClient } from '../supabase'
import { hashUser, loadProfileIdentity, resolveAnalyticsIdentity } from './identity'

export interface AnalyticsRow {
  user_hash: string
  organization_id: string | null
  session_id: string
  event: string
  area: string | null
  platform: Platform | null
  country: string | null
  traffic: string | null
  bot: string | null
  bot_purpose: string | null
  duration_ms: number | null
  step: number | null
  attribution: unknown
  created_at?: string
}

export interface RequestContext {
  sessionId: string | null
  platform: Platform | null
  country: string | null
  traffic: string
  bot: string | null
  botPurpose: string | null
}

let warnedMissingSecret = false

/**
 * Segredo do HMAC. O runtimeConfig só é sobrescrito em execução por `NUXT_ANALYTICS_HASH_SECRET`;
 * `ANALYTICS_HASH_SECRET` entra no build. Lê também o env em execução para não depender de onde o
 * segredo foi definido (senão a telemetria se desliga em silêncio).
 */
function readSecret(event?: H3Event | null): string {
  const config = event ? useRuntimeConfig(event) : useRuntimeConfig()
  return String(config.analyticsHashSecret || process.env.ANALYTICS_HASH_SECRET || '')
}

/** Telemetria desligada → o coletor responde ok e descarta. */
export function analyticsEnabled(event: H3Event): boolean {
  const config = useRuntimeConfig(event)
  const enabled = Boolean((config.public as Record<string, unknown>).analyticsEnabled)
  if (!enabled) return false
  if (!readSecret(event)) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true
      console.warn('[analytics] ANALYTICS_HASH_SECRET ausente: telemetria desativada.')
    }
    return false
  }
  return true
}

export function analyticsSecret(event: H3Event): string {
  return readSecret(event)
}

/** País só como ISO-3166 de 2 letras (header do CDN). O IP e o User-Agent nunca são gravados. */
export function countryFromHeaders(event: H3Event): string | null {
  const raw = getHeader(event, 'x-vercel-ip-country') || getHeader(event, 'cf-ipcountry') || ''
  return /^[A-Za-z]{2}$/.test(raw) && raw.toUpperCase() !== 'XX' ? raw.toUpperCase() : null
}

export function requestContext(event: H3Event): RequestContext {
  const info = classifyTraffic(getHeader(event, 'user-agent'))
  return {
    sessionId: normalizeSessionId(getHeader(event, 'x-analytics-session')),
    platform: normalizePlatform(getHeader(event, 'x-client-platform')),
    country: countryFromHeaders(event),
    traffic: info.traffic,
    bot: info.bot,
    botPurpose: info.purpose
  }
}

// Limite em memória: 240 eventos/min por usuário ou IP. Em serverless é por instância (basta para conter abuso).
const RATE_LIMIT = 240
const WINDOW_MS = 60_000
const buckets = new Map<string, { count: number, resetAt: number }>()

/** Devolve quantos dos `n` eventos cabem; o excedente é descartado em silêncio. */
export function takeRateLimit(key: string, n: number): number {
  const now = Date.now()
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
  }
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS }
    buckets.set(key, bucket)
  }
  const allowed = Math.max(0, Math.min(n, RATE_LIMIT - bucket.count))
  bucket.count += allowed
  return allowed
}

export async function insertAnalyticsRows(rows: AnalyticsRow[]) {
  if (!rows.length) return
  try {
    const { error } = await getSupabaseAdminClient().from('analytics_events').insert(rows)
    if (error) console.warn('[analytics] falha ao gravar eventos:', error.message)
  } catch (err) {
    console.warn('[analytics] erro inesperado ao gravar eventos:', (err as Error)?.message)
  }
}

/** Agenda a gravação sem atrasar a resposta; em serverless usa waitUntil para não ser interrompida. */
export function trackServerEvent(event: H3Event, name: AnalyticsEvent, options: ServerEventOptions = {}) {
  const promise = recordServerEvent(event, name, options)
  const waitUntil = (event as unknown as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil
  if (typeof waitUntil === 'function') waitUntil.call(event, promise)
}

export interface ServerEventOptions {
  /** Usuário explícito (login/signup/webhook, onde ainda não há cookie). */
  userId?: string | null
  organizationId?: string | null
  attribution?: unknown
  /** Sem sessão (webhook): grava session_id='server'. */
  noSession?: boolean
}

/**
 * Grava um evento de negócio emitido pelo servidor. Nunca lança e nunca grava IDs de registros,
 * corpo ou texto livre. Usuários `is_owner` e visitantes sem organização (em ações) são ignorados.
 */
export async function recordServerEvent(
  event: H3Event | null,
  name: AnalyticsEvent,
  options: ServerEventOptions = {}
) {
  try {
    if (event && !analyticsEnabled(event)) return
    const config = event ? null : useRuntimeConfig()
    const secret = readSecret(event)
    if (!secret) return
    if (!event && !(config?.public as Record<string, unknown> | undefined)?.analyticsEnabled) return

    let identity = event && options.userId === undefined
      ? await resolveAnalyticsIdentity(event)
      : options.userId
        ? await loadProfileIdentity(options.userId)
        : { userId: null, organizationId: null, isOwner: false }

    if (identity.isOwner) return
    if (options.organizationId) identity = { ...identity, organizationId: options.organizationId }

    // Webhook (ex.: Stripe) não é uma visita: sem sessão, tráfego, plataforma ou país.
    const context = event && !options.noSession ? requestContext(event) : null
    const sessionId = context?.sessionId ?? 'server'

    await insertAnalyticsRows([{
      user_hash: identity.userId ? hashUser(identity.userId, secret) : 'server',
      organization_id: identity.organizationId,
      session_id: sessionId,
      event: name,
      area: null,
      platform: context?.platform ?? null,
      country: context?.country ?? null,
      traffic: context?.traffic ?? null,
      bot: context?.bot ?? null,
      bot_purpose: context?.botPurpose ?? null,
      duration_ms: null,
      step: null,
      attribution: name === 'signup_completed' ? sanitizeAttribution(options.attribution) : null
    }])
  } catch (err) {
    console.warn('[analytics] evento do servidor ignorado:', (err as Error)?.message)
  }
}
