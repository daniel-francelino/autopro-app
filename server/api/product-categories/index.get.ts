import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'

/**
 * GET /api/product-categories?search=&includeUsage=true
 * includeUsage adds products_count and commission_rules_count per category —
 * used by Produtos > Categorias (Step 1 of
 * docs/finance/commissions-configuration-architecture.md) to warn before a
 * destructive edit and to block deleting a category still in use.
 *
 * Deliberately not gated by requireOrgPermission('product_categories.read'):
 * this endpoint is also used as a plain lookup by unrelated screens that
 * have their own permission gate (commission rule forms, employees settings,
 * products index/inventory) — those callers may not hold the
 * product_categories.* actions themselves. product_categories.* only guards
 * the dedicated Produtos > Categorias screen client-side (see
 * app/pages/app/products/categories.vue) and its own tab in Admin > Papéis.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const query = getQuery(event)

  let dbQuery = supabase
    .from('product_categories')
    .select('*')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)

  if (query.search) {
    dbQuery = dbQuery.ilike('name', `%${query.search}%`)
  }

  dbQuery = dbQuery.order('name', { ascending: true })

  const { data: items, error } = await dbQuery

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  if (query.includeUsage !== 'true' || !items?.length) {
    return { items }
  }

  const categoryIds = items.map(item => item.id)

  const [productsResult, commissionRulesResult] = await Promise.all([
    supabase
      .from('products')
      .select('category_id')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .in('category_id', categoryIds),
    supabase
      .from('employee_commission_rule_categories')
      .select('category_id')
      .in('category_id', categoryIds)
  ])

  if (productsResult.error)
    throw createError({ statusCode: 500, statusMessage: productsResult.error.message })
  if (commissionRulesResult.error)
    throw createError({ statusCode: 500, statusMessage: commissionRulesResult.error.message })

  const productsCountByCategory = new Map<string, number>()
  for (const row of productsResult.data || []) {
    if (!row.category_id) continue
    productsCountByCategory.set(row.category_id, (productsCountByCategory.get(row.category_id) ?? 0) + 1)
  }

  const rulesCountByCategory = new Map<string, number>()
  for (const row of commissionRulesResult.data || []) {
    rulesCountByCategory.set(row.category_id, (rulesCountByCategory.get(row.category_id) ?? 0) + 1)
  }

  const itemsWithUsage = items.map(item => ({
    ...item,
    products_count: productsCountByCategory.get(item.id) ?? 0,
    commission_rules_count: rulesCountByCategory.get(item.id) ?? 0
  }))

  return { items: itemsWithUsage }
})
