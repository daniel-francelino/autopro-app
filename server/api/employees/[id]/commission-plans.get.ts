import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import {
  fetchCommissionRuleVersions,
  fetchCommissionRulesForVersion
} from '../../../utils/employee-commission-plans'
import type { CommissionPlanRecord } from '../../../utils/employee-commission-plans'
import { currentCommissionMonthStart, resolveEffectiveCommissionVersion } from '../../../../lib/utils/employee-commission-engine'

interface AssignmentRow {
  id: string
  plan_id: string
  employee_id: string
}

/**
 * GET /api/employees/:id/commission-plans
 * Every commission plan (new model, Step 2+ of
 * docs/finance/commissions-configuration-architecture.md) assigned to this
 * employee, with the version currently in effect. Read-only — powers the
 * "Comissões atribuídas" card on the employee detail page (Step 5). Editing
 * only happens in Financeiro > Comissões.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'commissions.read')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const employeeId = getRouterParam(event, 'id')
  if (!employeeId) {
    throw createError({ statusCode: 400, statusMessage: 'Employee id is required' })
  }

  const { data: assignments, error: assignmentsError } = await supabase
    .from('employee_commission_plan_assignments')
    .select('id, plan_id, employee_id')
    .eq('employee_id', employeeId)
    .eq('active', true)
    .is('deleted_at', null)

  if (assignmentsError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load commission assignments: ${assignmentsError.message}` })
  }

  const planIds = ((assignments || []) as AssignmentRow[]).map(assignment => assignment.plan_id)
  if (planIds.length === 0) return { items: [] }

  const { data: plans, error: plansError } = await supabase
    .from('employee_commission_plans')
    .select('*')
    .in('id', planIds)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)

  if (plansError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load commission plans: ${plansError.message}` })
  }

  const referenceDate = currentCommissionMonthStart()

  const rawItems = await Promise.all(((plans || []) as CommissionPlanRecord[]).map(async (plan) => {
    const versions = await fetchCommissionRuleVersions(supabase, plan.id)
    const effectiveVersion = resolveEffectiveCommissionVersion(versions, referenceDate)
    const rules = effectiveVersion ? await fetchCommissionRulesForVersion(supabase, effectiveVersion.id) : []
    return { plan, effectiveVersion, rules }
  }))

  const allCategoryIds = [...new Set(rawItems.flatMap(({ rules }) => rules.flatMap(rule => rule.category_ids)))]
  const categoryNameById = new Map<string, string>()
  if (allCategoryIds.length > 0) {
    const { data: categories, error: categoriesError } = await supabase
      .from('product_categories')
      .select('id, name')
      .in('id', allCategoryIds)

    if (categoriesError) {
      throw createError({ statusCode: 500, statusMessage: `Failed to load categories: ${categoriesError.message}` })
    }
    for (const category of categories || []) categoryNameById.set(category.id, category.name)
  }

  const items = rawItems.map(({ plan, effectiveVersion, rules }) => ({
    planId: plan.id,
    planName: plan.name,
    active: plan.active,
    effectiveFrom: effectiveVersion?.effective_from ?? null,
    rules: rules.map(rule => ({
      id: rule.id,
      name: rule.name,
      commissionType: rule.commission_type,
      commissionAmount: rule.commission_amount,
      commissionBase: rule.commission_base,
      isDefault: rule.is_default,
      categories: rule.category_ids.map(id => ({ id, name: categoryNameById.get(id) ?? null }))
    }))
  }))

  return { items }
})
