import { requireOwner } from '../../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireReason, requireUuidParam } from '../../../../utils/admin-params'
import { recordAudit } from '../../../../utils/audit/record'
import { setAuditContext } from '../../../../utils/audit/context'

/**
 * POST /api/admin/organizations/:id/suspend  { reason }
 * Suspende a oficina: toda a API dela passa a responder 403 (resolveOrganizationId / requireOrgPermission).
 * Motivo obrigatório; a ação fica no log de auditoria com a oficina afetada.
 */
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
  if (org.suspended_at) throw createError({ statusCode: 409, statusMessage: 'A oficina já está suspensa' })

  const suspendedAt = new Date().toISOString()
  const { error } = await supabase
    .from('organizations')
    .update({ suspended_at: suspendedAt, suspended_reason: reason, suspended_by: owner.email, updated_by: owner.email })
    .eq('id', id)

  if (error) throw createError({ statusCode: 500, statusMessage: 'Erro ao suspender a oficina' })

  setAuditContext(event, { organizationId: id })
  recordAudit(event, {
    resourceType: 'organization',
    resourceId: id,
    before: { suspended_at: null },
    after: { suspended_at: suspendedAt },
    extra: { reason }
  })
  return { success: true, suspended_at: suspendedAt }
})
