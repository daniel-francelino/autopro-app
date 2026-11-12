import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'orders.update', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  const { data: existing } = await supabase
    .from('master_products')
    .select('id')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Produto master não encontrado' })

  const body = await readBody(event)
  const name = body?.name !== undefined ? String(body.name).trim() : undefined
  const description = body?.description !== undefined ? String(body.description).trim() : undefined
  const notes = body?.notes !== undefined ? String(body.notes).trim() : undefined

  if (name !== undefined && !name) {
    throw createError({ statusCode: 400, statusMessage: 'Nome é obrigatório' })
  }

  const { data: item, error } = await supabase
    .from('master_products')
    .update({
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description: description || null }),
      ...(notes !== undefined && { notes: notes || null }),
      updated_by: authUser.email
    })
    .eq('id', id)
    .eq('organization_id', organizationId)
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  return { item }
})
