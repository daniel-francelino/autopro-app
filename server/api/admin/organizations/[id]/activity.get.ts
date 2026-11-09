import { requireOwner } from '../../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireUuidParam } from '../../../../utils/admin-params'

const COLUMNS = 'id, created_at, request_id, actor_email, actor_role, action, resource_type, resource_id, http_method, route_pattern, status_code, outcome, error_message'

/** GET /api/admin/organizations/:id/activity?page= — linha do tempo da oficina (audit_logs, 50 por página, últimos 31 dias). */
export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = requireUuidParam(event)
  const page = Math.max(1, Number(getQuery(event).page) || 1)
  const pageSize = 50

  const { data, error, count } = await getSupabaseAdminClient()
    .from('audit_logs')
    .select(COLUMNS, { count: 'exact' })
    .eq('organization_id', id)
    .gte('created_at', new Date(Date.now() - 31 * 86_400_000).toISOString())
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)

  if (error) throw createError({ statusCode: 500, statusMessage: 'Erro ao consultar a atividade' })
  return { data: data ?? [], total: count ?? 0, page, pageSize }
})
