import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'roles.delete', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  const { data: existing } = await supabase
    .from('roles').select('id, is_system_role').eq('id', id).eq('organization_id', organizationId).is('deleted_at', null).maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Registro não encontrado' })

  if (existing.is_system_role)
    throw createError({ statusCode: 400, statusMessage: 'Papéis de sistema não podem ser excluídos' })

  const { count: inUse } = await supabase
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role_id', id)
    .eq('organization_id', organizationId)
  if (inUse && inUse > 0)
    throw createError({ statusCode: 409, statusMessage: 'Este papel está em uso por usuários. Troque o papel deles antes de excluir.' })

  const { error } = await supabase
    .from('roles')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: authUser.email
    })
    .eq('id', id)

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
