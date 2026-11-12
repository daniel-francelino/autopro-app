import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'inventory.create', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)
  const {
    product_id,
    code,
    description,
    stock_quantity = 0,
    sale_price = 0,
    brand,
    category,
    minimum_quantity,
    cost_price,
    supplier_name,
    location,
    notes
  } = body

  if (!code || !description)
    throw createError({ statusCode: 400, statusMessage: 'code e description são obrigatórios' })

  const { data: item, error } = await supabase
    .from('parts')
    .insert({
      organization_id: organizationId,
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
      notes,
      created_by: authUser.email,
      updated_by: authUser.email
    })
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  return { item }
})
