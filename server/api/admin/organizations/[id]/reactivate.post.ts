import { requireOwner } from '../../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireReason, requireUuidParam } from '../../../../utils/admin-params'
import { recordAudit } from '../../../../utils/audit/record'
import { setAuditContext } from '../../../../utils/audit/context'

/** POST /api/admin/organizations/:id/reactivate  { reason } — tira a suspensão da oficina. */
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const id = requireUuidParam(event)
  const reason = requireReason(await readBody(event).catch(() => null))
  const supabase = getSupabaseAdminClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, suspended_at, suspended_reason')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!org) throw createError({ statusCode: 404, statusMessage: 'Oficina não encontrada' })
  if (!org.suspended_at) throw createError({ statusCode: 409, statusMessage: 'A oficina não está suspensa' })

  const { error } = await supabase
    .from('organizations')
    .update({ suspended_at: null, suspended_reason: null, suspended_by: null, updated_by: owner.email })
    .eq('id', id)

  if (error) throw createError({ statusCode: 500, statusMessage: 'Erro ao reativar a oficina' })

  setAuditContext(event, { organizationId: id })
  recordAudit(event, {
    resourceType: 'organization',
    resourceId: id,
    before: { suspended_at: org.suspended_at, suspended_reason: org.suspended_reason },
    after: { suspended_at: null },
    extra: { reason }
  })
  return { success: true }
})
