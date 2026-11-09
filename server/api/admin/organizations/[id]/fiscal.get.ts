import { requireOwner } from '../../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireUuidParam } from '../../../../utils/admin-params'

/** GET /api/admin/organizations/:id/fiscal — status da integração e últimas chamadas/rejeições à Focus NFe. */
export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = requireUuidParam(event)
  const supabase = getSupabaseAdminClient()

  const [status, logs] = await Promise.all([
    supabase
      .from('fiscal_sync_status')
      .select('integration_status, is_company_synced, sync_status, sync_error_message, sync_error_code, last_synced_at, last_sync_attempt_at, selected_state')
      .eq('organization_id', id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('fiscal_integration_logs')
      .select('id, created_at, function_name, request_method, request_path, response_status, is_success, error_message, user_email')
      .eq('organization_id', id)
      .order('created_at', { ascending: false })
      .limit(30)
  ])

  if (status.error || logs.error) throw createError({ statusCode: 500, statusMessage: 'Erro ao carregar o fiscal' })
  return { sync_status: status.data ?? null, recent_calls: logs.data ?? [] }
})
