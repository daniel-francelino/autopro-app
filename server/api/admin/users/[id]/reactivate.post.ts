import { requireOwner } from '../../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireReason, requireUuidParam } from '../../../../utils/admin-params'
import { recordAudit } from '../../../../utils/audit/record'
import { setAuditContext } from '../../../../utils/audit/context'

/** POST /api/admin/users/:id/reactivate  { reason } — reativa um usuário desativado. */
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const id = requireUuidParam(event)
  const reason = requireReason(await readBody(event).catch(() => null))
  const supabase = getSupabaseAdminClient()

  const { data: target } = await supabase
    .from('user_profiles')
    .select('id, user_id, organization_id, is_active, is_owner')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!target) throw createError({ statusCode: 404, statusMessage: 'Usuário não encontrado' })
  if (target.is_owner || target.user_id === owner.id) {
    throw createError({ statusCode: 409, statusMessage: 'Não é possível alterar um owner nem a si mesmo' })
  }
  if (target.is_active !== false) {
    throw createError({ statusCode: 409, statusMessage: 'O usuário já está ativo' })
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ is_active: true, updated_by: owner.email })
    .eq('id', id)

  if (error) throw createError({ statusCode: 500, statusMessage: 'Erro ao atualizar o usuário' })

  setAuditContext(event, { organizationId: (target.organization_id as string | null) ?? undefined })
  recordAudit(event, {
    resourceType: 'user',
    resourceId: id,
    before: { is_active: false },
    after: { is_active: true },
    extra: { reason }
  })
  return { success: true }
})
