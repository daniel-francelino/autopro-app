import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { computeRates, weeklySeries, type GeoRunRow } from '../../../utils/geo-metrics'

/**
 * GET /api/admin/geo/summary?weeks=12
 * Taxas de menção / link / recomendação / exatidão por semana (com e sem busca) e por motor.
 * Indicadores medem COLETA e CITAÇÃO, nunca prova de recomendação (plano GEO §10.1).
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const weeks = Math.min(52, Math.max(1, Number(getQuery(event).weeks) || 12))
  const since = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString().slice(0, 10)

  const { data, error } = await getSupabaseAdminClient()
    .from('geo_probe_runs')
    .select('run_date, engine, search_enabled, brand_mentioned, brand_linked, recommended, price_correct, fiscal_correct')
    .gte('run_date', since)
    .limit(20000)

  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205'
    throw createError({
      statusCode: missing ? 503 : 500,
      statusMessage: missing ? 'Aplique a migration 20240101000103_create_geo_probe_runs.sql.' : 'Erro ao consultar a bateria'
    })
  }

  const rows = (data ?? []) as GeoRunRow[]
  const engines = [...new Set(rows.map(r => r.engine))].sort()
  return {
    weeks,
    overall: computeRates(rows),
    series: weeklySeries(rows),
    by_engine: engines.map(engine => ({ engine, ...computeRates(rows.filter(r => r.engine === engine)) }))
  }
})
