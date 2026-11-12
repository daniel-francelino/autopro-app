import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'products.create', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)
  const {
    name,
    code,
    type,
    category_id,
    track_inventory,
    initial_stock_quantity,
    notes,
    unit_sale_price,
    unit_cost_price,
    group_items
  } = body

  if (!name || !code || !type)
    throw createError({ statusCode: 400, statusMessage: 'name, code e type são obrigatórios' })

  const productCode = Number(code)
  if (!Number.isSafeInteger(productCode) || productCode <= 0)
    throw createError({ statusCode: 400, statusMessage: 'O código do produto deve ser um número inteiro positivo' })

  const { data: item, error } = await supabase
    .from('products')
    .insert({
      organization_id: organizationId,
      name,
      code: productCode,
      type,
      category_id,
      track_inventory,
      initial_stock_quantity,
      notes,
      unit_sale_price,
      unit_cost_price,
      group_items,
      created_by: authUser.email,
      updated_by: authUser.email
    })
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  // Create parts for group items with track_inventory = true
  if (item.type === 'group' && Array.isArray(group_items)) {
    const partsToCreate = (group_items as {
      description: string
      track_inventory?: boolean
      initial_stock_quantity?: number
      sale_price?: number
      cost_price?: number
    }[])
      .map((gi, idx) => ({ gi, idx }))
      .filter(({ gi }) => gi.track_inventory === true)
      .map(({ gi, idx }) => ({
        organization_id: organizationId,
        product_id: item.id,
        code: `${item.code}-ITEM-${idx + 1}`,
        description: gi.description,
        stock_quantity: gi.initial_stock_quantity ?? 0,
        sale_price: gi.sale_price ?? 0,
        cost_price: gi.cost_price ?? 0,
        created_by: authUser.email,
        updated_by: authUser.email
      }))

    if (partsToCreate.length > 0)
      await supabase.from('parts').insert(partsToCreate)
  }

  return { item }
})
