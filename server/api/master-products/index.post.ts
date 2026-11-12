import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'orders.create', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)
  const name = String(body?.name || '').trim()
  const description = String(body?.description || '').trim()
  const notes = String(body?.notes || '').trim()

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Nome é obrigatório' })
  }

  const { data: item, error } = await supabase
    .from('master_products')
    .insert({
      organization_id: organizationId,
      name,
      description: description || null,
      notes: notes || null,
      created_by: authUser.email,
      updated_by: authUser.email
    })
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  return { item }
})
