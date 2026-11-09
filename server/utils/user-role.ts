import type { H3Event } from 'h3'
import { getSupabaseAdminClient } from './supabase'
import { requireOrgPermission } from './require-org-permission'
import { resolveOrganizationId } from './organization'
import { recordAudit } from './audit/record'

/**
 * Troca o papel de um usuário DA MESMA oficina de quem chama.
 * Exige `roles.manage_members`; o papel de destino precisa ser da oficina (ou de sistema, sem oficina).
 * Nunca aceita organização, e-mail ou funcionário vindos do corpo (escalonamento de privilégio).
 */
export async function changeUserRole(event: H3Event, actor: { id: string, email: string | null }, targetProfileId: string, roleId: string) {
  await requireOrgPermission(actor.id, 'roles.manage_members', event)

  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, actor.id)

  const { data: target, error: targetError } = await supabase
    .from('user_profiles')
    .select('id, organization_id, role_id')
    .eq('id', targetProfileId)
    .maybeSingle()

  if (targetError || !target) {
    throw createError({ statusCode: 404, statusMessage: 'Usuário alvo não encontrado' })
  }
  if (target.organization_id !== organizationId) {
    throw createError({ statusCode: 403, statusMessage: 'Usuário não pertence à sua organização' })
  }

  const { data: role } = await supabase
    .from('roles')
    .select('id, organization_id')
    .eq('id', roleId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!role || (role.organization_id !== null && role.organization_id !== organizationId)) {
    throw createError({ statusCode: 404, statusMessage: 'Perfil não encontrado' })
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ role_id: roleId, updated_by: actor.email })
    .eq('id', targetProfileId)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Erro ao atualizar role do usuário' })
  }

  recordAudit(event, {
    resourceType: 'user',
    resourceId: targetProfileId,
    before: { role_id: target.role_id },
    after: { role_id: roleId }
  })
}
