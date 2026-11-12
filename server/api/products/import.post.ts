import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

interface ImportRow {
  name: string
  code: string | number
  type: 'unit' | 'group'
  category?: string
  cost_price?: number
  sale_price?: number
  track_inventory?: boolean
  initial_stock?: number
  parent_product_code?: string | number
  item_description?: string
  item_quantity?: number
  item_cost_price?: number
  item_sale_price?: number
  item_track_inventory?: boolean
  item_initial_stock?: number
}

interface GroupItemData {
  description: string
  quantity: number
  unit: string
  cost_price: number
  sale_price: number
  track_inventory: boolean
  initial_stock_quantity: number
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'products.create', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)
  const rows: ImportRow[] = body?.rows

  if (!Array.isArray(rows) || rows.length === 0)
    throw createError({ statusCode: 400, statusMessage: 'Nenhuma linha para importar' })

  const created: string[] = []
  const errors: { row: number, message: string }[] = []

  // Separate product rows from item rows
  const productRows = rows.filter(r => r.name && r.code && r.type && !r.parent_product_code)
  const itemRows = rows.filter(r => r.parent_product_code)

  // Build group items map: code → items[]
  const groupItemsMap: Record<string, GroupItemData[]> = {}
  for (const itemRow of itemRows) {
    const code = String(itemRow.parent_product_code!)
    if (!groupItemsMap[code]) groupItemsMap[code] = []
    groupItemsMap[code].push({
      description: itemRow.item_description ?? '',
      quantity: Number(itemRow.item_quantity ?? 1),
      unit: 'un',
      cost_price: Number(itemRow.item_cost_price ?? 0),
      sale_price: Number(itemRow.item_sale_price ?? 0),
      track_inventory: itemRow.item_track_inventory === true || String(itemRow.item_track_inventory).toLowerCase() === 'true',
      initial_stock_quantity: Number(itemRow.item_initial_stock ?? 0)
    })
  }

  // Lookup category ids by name
  const categoryNames = [...new Set(productRows.map(r => r.category).filter(Boolean))] as string[]
  const categoryMap: Record<string, string> = {}
  if (categoryNames.length > 0) {
    const { data: cats } = await supabase
      .from('product_categories')
      .select('id, name')
      .eq('organization_id', organizationId)
      .in('name', categoryNames)
    for (const cat of cats ?? []) {
      categoryMap[cat.name] = cat.id
    }
  }

  for (let i = 0; i < productRows.length; i++) {
    const row = productRows[i]!
    try {
      const productCode = Number(row.code)
      if (!Number.isSafeInteger(productCode) || productCode <= 0) {
        errors.push({ row: i + 1, message: 'O código do produto deve ser um número inteiro positivo' })
        continue
      }

      const isGroup = row.type === 'group'
      const groupItems = isGroup ? (groupItemsMap[String(row.code)] ?? []) : null
      const trackInventory = isGroup ? false : (row.track_inventory === true || String(row.track_inventory).toLowerCase() === 'true')

      const { data: product, error } = await supabase
        .from('products')
        .insert({
          organization_id: organizationId,
          name: row.name,
          code: productCode,
          type: row.type,
          category_id: row.category ? (categoryMap[row.category] ?? null) : null,
          track_inventory: trackInventory,
          initial_stock_quantity: !isGroup && trackInventory ? Number(row.initial_stock ?? 0) : 0,
          unit_sale_price: !isGroup ? (row.sale_price ? Number(row.sale_price) : null) : null,
          unit_cost_price: !isGroup ? (row.cost_price ? Number(row.cost_price) : null) : null,
          group_items: groupItems,
          created_by: authUser.email,
          updated_by: authUser.email
        })
        .select()
        .single()

      if (error) {
        errors.push({ row: i + 1, message: error.message })
        continue
      }

      // Create parts for group items with track_inventory = true
      if (isGroup && groupItems && groupItems.length > 0) {
        const partsToCreate = groupItems
          .map((gi, idx) => ({ gi, idx }))
          .filter(({ gi }) => gi.track_inventory)
          .map(({ gi, idx }) => ({
            organization_id: organizationId,
            product_id: product.id,
            code: `${product.code}-ITEM-${idx + 1}`,
            description: gi.description,
            stock_quantity: gi.initial_stock_quantity,
            sale_price: gi.sale_price,
            cost_price: gi.cost_price,
            created_by: authUser.email,
            updated_by: authUser.email
          }))

        if (partsToCreate.length > 0)
          await supabase.from('parts').insert(partsToCreate)
      }

      created.push(product.id)
    } catch (err: unknown) {
      const e = err as Error
      errors.push({ row: i + 1, message: e.message ?? 'Erro desconhecido' })
    }
  }

  return {
    created: created.length,
    errors
  }
})
