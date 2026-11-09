import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'

/** GET /api/admin/geo/runs?date=YYYY-MM-DD — registros da bateria de uma data (padrão: a mais recente). */
export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const supabase = getSupabaseAdminClient()
  const requested = String(getQuery(event).date ?? '')

  let date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : null
  if (!date) {
    const { data: last } = await supabase.from('geo_probe_runs').select('run_date').order('run_date', { ascending: false }).limit(1).maybeSingle()
    date = (last?.run_date as string | undefined) ?? null
  }
  if (!date) return { date: null, data: [] }

  const { data, error } = await supabase
    .from('geo_probe_runs')
    .select('*')
    .eq('run_date', date)
    .order('question_id', { ascending: true })
    .order('engine', { ascending: true })

  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205'
    throw createError({
      statusCode: missing ? 503 : 500,
      statusMessage: missing ? 'Aplique a migration 20240101000103_create_geo_probe_runs.sql.' : 'Erro ao listar a bateria'
    })
  }
  return { date, data: data ?? [] }
})
