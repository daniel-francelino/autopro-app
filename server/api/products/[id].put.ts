import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'products.update', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  const { data: existing } = await supabase
    .from('products').select('id').eq('id', id).eq('organization_id', organizationId).is('deleted_at', null).maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Registro não encontrado' })

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

  const productCode = code === undefined ? undefined : Number(code)
  if (code !== undefined && (!Number.isSafeInteger(productCode) || productCode! <= 0))
    throw createError({ statusCode: 400, statusMessage: 'O código do produto deve ser um número inteiro positivo' })

  const { data: item, error } = await supabase
    .from('products')
    .update({
      ...(name !== undefined && { name }),
      ...(code !== undefined && { code: productCode }),
      ...(type !== undefined && { type }),
      ...(category_id !== undefined && { category_id }),
      ...(track_inventory !== undefined && { track_inventory }),
      ...(initial_stock_quantity !== undefined && { initial_stock_quantity }),
      ...(notes !== undefined && { notes }),
      ...(unit_sale_price !== undefined && { unit_sale_price }),
      ...(unit_cost_price !== undefined && { unit_cost_price }),
      ...(group_items !== undefined && { group_items }),
      updated_by: authUser.email
    })
    .eq('id', id)
    .eq('organization_id', organizationId)
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  // Create parts for new group items that have track_inventory = true
  if (item.type === 'group' && Array.isArray(group_items)) {
    const { data: existingParts } = await supabase
      .from('parts')
      .select('description')
      .eq('product_id', id)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)

    const existingDescriptions = new Set((existingParts ?? []).map((p: { description: string }) => p.description))

    const partsToCreate = (group_items as {
      description: string
      track_inventory?: boolean
      initial_stock_quantity?: number
      sale_price?: number
      cost_price?: number
    }[])
      .map((gi, idx) => ({ gi, idx }))
      .filter(({ gi }) => gi.track_inventory === true && !existingDescriptions.has(gi.description))
      .map(({ gi, idx }) => ({
        organization_id: organizationId,
        product_id: id,
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
