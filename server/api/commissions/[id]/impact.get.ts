import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import {
  currentMonthStart,
  fetchCommissionPlan,
  fetchCommissionPlanAssignments,
  fetchCommissionRuleVersions,
  fetchCommissionRulesForVersion,
  resolveEffectiveVersion
} from '../../../utils/employee-commission-plans'

/**
 * GET /api/commissions/:id/impact
 * A lightweight preview of what the plan's currently-effective version would
 * cover, to validate a rule "covers what's expected" before relying on it —
 * per-rule category names and how many active products currently sit in
 * those categories, plus how many employees are assigned. Does not touch
 * service order history (that's a heavier, optional follow-up) — this is
 * meant as a quick sanity check on the category setup itself.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'commissions.read')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const planId = getRouterParam(event, 'id')
  if (!planId) {
    throw createError({ statusCode: 400, statusMessage: 'Plan id is required' })
  }

  const plan = await fetchCommissionPlan(supabase, organizationId, planId)
  if (!plan) {
    throw createError({ statusCode: 404, statusMessage: 'Configuração de comissão não encontrada' })
  }

  const [versions, assignments] = await Promise.all([
    fetchCommissionRuleVersions(supabase, planId),
    fetchCommissionPlanAssignments(supabase, planId, true)
  ])

  const effectiveVersion = resolveEffectiveVersion(versions, currentMonthStart())
  const rules = effectiveVersion ? await fetchCommissionRulesForVersion(supabase, effectiveVersion.id) : []

  const allCategoryIds = [...new Set(rules.flatMap(rule => rule.category_ids))]
  const categoryNameById = new Map<string, string>()
  const productCountByCategory = new Map<string, number>()

  if (allCategoryIds.length > 0) {
    const { data: categories, error: categoriesError } = await supabase
      .from('product_categories')
      .select('id, name')
      .in('id', allCategoryIds)

    if (categoriesError) {
      throw createError({ statusCode: 500, statusMessage: `Failed to load categories: ${categoriesError.message}` })
    }
    for (const category of categories || []) categoryNameById.set(category.id, category.name)

    await Promise.all(allCategoryIds.map(async (categoryId) => {
      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('category_id', categoryId)
        .is('deleted_at', null)
      productCountByCategory.set(categoryId, count ?? 0)
    }))
  }

  const rulesImpact = rules.map(rule => ({
    ruleId: rule.id,
    name: rule.name,
    isDefault: rule.is_default,
    commissionType: rule.commission_type,
    commissionAmount: rule.commission_amount,
    commissionBase: rule.commission_base,
    categories: rule.category_ids.map(id => ({
      id,
      name: categoryNameById.get(id) ?? null,
      productCount: productCountByCategory.get(id) ?? 0
    }))
  }))

  return {
    data: {
      effectiveVersionId: effectiveVersion?.id ?? null,
      assignedEmployeeCount: assignments.length,
      rules: rulesImpact
    }
  }
})
