import { z } from 'zod'
import { requireOwner } from '../../utils/require-owner'
import { getSupabaseAdminClient } from '../../utils/supabase'

/**
 * GET /api/admin/metrics?days=7|30|90&tab=...[&fresh=1][&internal=1]
 * Telemetria de uso para o dono da plataforma (`is_owner`). Já devolve agregado (funções SQL);
 * cache de 60 s em memória por (dias, aba, internas) que também junta pedidos simultâneos.
 */
const TABS = ['summary', 'acquisition', 'engagement', 'activation', 'accounts', 'quality'] as const
type Tab = (typeof TABS)[number]

const querySchema = z.object({
  days: z.coerce.number().refine(value => [7, 30, 90].includes(value), 'days deve ser 7, 30 ou 90').default(30),
  tab: z.enum(TABS).default('summary'),
  fresh: z.string().optional(),
  internal: z.string().optional()
})

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number, promise: Promise<unknown> }>()

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await getSupabaseAdminClient().rpc(name, args)
  if (error) {
    // 42883 / PGRST202: função inexistente → migração 098 ainda não aplicada
    const missing = error.code === '42883' || error.code === 'PGRST202'
    throw createError({
      statusCode: missing ? 503 : 500,
      statusMessage: missing
        ? 'Métricas indisponíveis: aplique a migration 20240101000098_create_analytics_events.sql.'
        : 'Erro ao consultar métricas'
    })
  }
  return data
}

async function load(tab: Tab, days: number, internal: boolean) {
  const args = { p_days: days, p_include_internal: internal }
  switch (tab) {
    case 'summary': {
      const [summary, coverage] = await Promise.all([rpc('analytics_summary', args), rpc('analytics_coverage', {})])
      return { ...(summary as object), coverage }
    }
    case 'acquisition':
      return rpc('analytics_acquisition', args)
    case 'engagement':
      return rpc('analytics_engagement', args)
    case 'activation':
      return rpc('analytics_funnel', args)
    case 'accounts':
      return rpc('analytics_accounts_health', { p_include_internal: internal })
    case 'quality': {
      const [traffic, coverage] = await Promise.all([rpc('analytics_traffic', args), rpc('analytics_coverage', {})])
      return { ...(traffic as object), coverage }
    }
  }
}

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Parâmetros inválidos' })
  }
  const { days, tab, fresh, internal } = parsed.data
  const includeInternal = internal === '1'
  const key = `${tab}|${days}|${includeInternal}`

  const hit = cache.get(key)
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { tab, days, cached: true, generatedAt: new Date(hit.at).toISOString(), data: await hit.promise }
  }

  const promise = load(tab, days, includeInternal)
  const entry = { at: Date.now(), promise }
  cache.set(key, entry)
  try {
    const data = await promise
    return { tab, days, cached: false, generatedAt: new Date(entry.at).toISOString(), data }
  } catch (err) {
    // não guarda falha no cache
    if (cache.get(key) === entry) cache.delete(key)
    throw err
  }
})
