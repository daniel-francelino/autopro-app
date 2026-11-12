import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'inventory.update', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  const { data: existing } = await supabase
    .from('parts').select('id').eq('id', id).eq('organization_id', organizationId).is('deleted_at', null).maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Registro não encontrado' })

  const body = await readBody(event)
  const {
    product_id,
    code,
    description,
    stock_quantity,
    sale_price,
    brand,
    category,
    minimum_quantity,
    cost_price,
    supplier_name,
    location,
    notes
  } = body

  const { data: item, error } = await supabase
    .from('parts')
    .update({
      ...(product_id !== undefined && { product_id }),
      ...(code !== undefined && { code }),
      ...(description !== undefined && { description }),
      ...(stock_quantity !== undefined && { stock_quantity }),
      ...(sale_price !== undefined && { sale_price }),
      ...(brand !== undefined && { brand }),
      ...(category !== undefined && { category }),
      ...(minimum_quantity !== undefined && { minimum_quantity }),
      ...(cost_price !== undefined && { cost_price }),
      ...(supplier_name !== undefined && { supplier_name }),
      ...(location !== undefined && { location }),
      ...(notes !== undefined && { notes }),
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
