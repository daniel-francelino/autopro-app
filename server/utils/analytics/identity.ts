import { createHmac } from 'node:crypto'
import type { H3Event } from 'h3'
import { getAccessTokenFromCookies } from '../auth-cookies'
import { getSupabaseAdminClient } from '../supabase'
import { getSupabaseAnonClient } from '../supabase-anon'

export interface AnalyticsIdentity {
  userId: string | null
  organizationId: string | null
  isOwner: boolean
}

export const VISITOR: AnalyticsIdentity = { userId: null, organizationId: null, isOwner: false }

const TTL_MS = 5 * 60 * 1000
const NEGATIVE_TTL_MS = 60 * 1000
const MAX_ENTRIES = 1000

// Cache em memória por token: evita uma chamada à Supabase Auth a cada lote de eventos.
const cache = new Map<string, { value: AnalyticsIdentity, expires: number }>()

function remember(key: string, value: AnalyticsIdentity, ttl: number) {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { value, expires: Date.now() + ttl })
}

/** Pseudonimiza o usuário com HMAC (sem o segredo não dá para reverter a partir da lista de IDs). */
export function hashUser(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(userId).digest('hex').slice(0, 24)
}

export async function loadProfileIdentity(userId: string): Promise<AnalyticsIdentity> {
  const { data } = await getSupabaseAdminClient()
    .from('user_profiles')
    .select('organization_id, is_owner')
    .eq('user_id', userId)
    .maybeSingle()

  return {
    userId,
    organizationId: (data?.organization_id as string | null) ?? null,
    isOwner: Boolean(data?.is_owner)
  }
}

/**
 * Resolve quem está chamando, SOMENTE pelo cookie httpOnly `sb-access-token`.
 * Nunca usa o cookie `sb-user` (legível e editável pelo cliente). Sem token válido → visitante.
 */
export async function resolveAnalyticsIdentity(event: H3Event): Promise<AnalyticsIdentity> {
  const token = getAccessTokenFromCookies(event)
  if (!token) return VISITOR

  const hit = cache.get(token)
  if (hit && hit.expires > Date.now()) return hit.value

  try {
    const { data, error } = await getSupabaseAnonClient().auth.getUser(token)
    if (error || !data.user) {
      remember(token, VISITOR, NEGATIVE_TTL_MS)
      return VISITOR
    }
    const identity = await loadProfileIdentity(data.user.id)
    remember(token, identity, TTL_MS)
    return identity
  } catch {
    return VISITOR
  }
}
