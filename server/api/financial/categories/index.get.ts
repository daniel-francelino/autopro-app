import { defineEventHandler, getQuery, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import { ensureDefaultFinancialCategories } from '../../../utils/financial-category-defaults'

/**
 * GET /api/financial/categories
 * Returns every category (default + custom) for the organization. Defaults
 * are real rows (is_default=true) — see docs/financial-categories-crud.md.
 * Pass ?includeUsage=true to also get an exact usage_count per category
 * (used by the categories CRUD screen, skipped by default for callers like
 * FormModal.vue that only need the list for a dropdown).
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)
  const includeUsage = getQuery(event).includeUsage === 'true'

  // Self-healing safety net for organizations that, for whatever reason,
  // reached this endpoint without their 9 default rows yet (e.g. created in
  // a gap before the webhook change, or before the backfill ran).
  await ensureDefaultFinancialCategories(supabase, organizationId, 'financial-categories-get')

  const { data: categories, error } = await supabase
    .from('financial_categories')
    .select('id, name, type, icon, color, is_default')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  let withUsage = categories ?? []

  if (includeUsage) {
    const counts = await Promise.all(
      withUsage.map(async (category) => {
        const { count } = await supabase
          .from('financial_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('category_id', category.id)
          .is('deleted_at', null)
        return count ?? 0
      })
    )
    withUsage = withUsage.map((category, index) => ({ ...category, usage_count: counts[index] }))
  }

  return {
    defaults: withUsage.filter(c => c.is_default),
    custom: withUsage.filter(c => !c.is_default)
  }
})
