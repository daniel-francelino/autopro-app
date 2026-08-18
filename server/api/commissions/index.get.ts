import { defineEventHandler, getQuery, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import {
  currentMonthStart,
  fetchCommissionRulesForPlan,
  resolveEffectiveVersion
} from '../../utils/employee-commission-plans'
import type { CommissionPlanRecord, CommissionRuleVersionRecord } from '../../utils/employee-commission-plans'

/**
 * GET /api/commissions?search=&activeOnly=true
 * Lists commission plans with a summary: current (effective-today) version,
 * its rule/category counts, and how many employees are assigned. Powers the
 * Financeiro > Comissões list (Step 4 of the design doc).
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'commissions.read')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const query = getQuery(event)
  const search = typeof query.search === 'string' ? query.search.trim() : ''
  const activeOnly = query.activeOnly === 'true'

  let plansQuery = supabase
    .from('employee_commission_plans')
    .select('*')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (search) plansQuery = plansQuery.ilike('name', `%${search}%`)
  if (activeOnly) plansQuery = plansQuery.eq('active', true)

  const { data: plans, error: plansError } = await plansQuery
  if (plansError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load commission plans: ${plansError.message}` })
  }

  const planList = (plans || []) as CommissionPlanRecord[]
  if (planList.length === 0) return { items: [] }

  const planIds = planList.map(plan => plan.id)
  const referenceDate = currentMonthStart()

  const [versionsResult, assignmentsResult] = await Promise.all([
    supabase
      .from('employee_commission_rule_versions')
      .select('*')
      .in('plan_id', planIds)
      .order('effective_from', { ascending: false }),
    supabase
      .from('employee_commission_plan_assignments')
      .select('plan_id')
      .in('plan_id', planIds)
      .eq('active', true)
      .is('deleted_at', null)
  ])

  if (versionsResult.error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load rule versions: ${versionsResult.error.message}` })
  }
  if (assignmentsResult.error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load assignments: ${assignmentsResult.error.message}` })
  }

  const versionsByPlan = new Map<string, CommissionRuleVersionRecord[]>()
  for (const version of (versionsResult.data || []) as CommissionRuleVersionRecord[]) {
    const list = versionsByPlan.get(version.plan_id) ?? []
    list.push(version)
    versionsByPlan.set(version.plan_id, list)
  }

  const assignedCountByPlan = new Map<string, number>()
  for (const row of (assignmentsResult.data || []) as { plan_id: string }[]) {
    assignedCountByPlan.set(row.plan_id, (assignedCountByPlan.get(row.plan_id) ?? 0) + 1)
  }

  const effectiveVersionByPlan = new Map<string, CommissionRuleVersionRecord | null>()
  for (const plan of planList) {
    effectiveVersionByPlan.set(plan.id, resolveEffectiveVersion(versionsByPlan.get(plan.id) ?? [], referenceDate))
  }

  const effectiveVersions = [...effectiveVersionByPlan.values()].filter((v): v is CommissionRuleVersionRecord => v !== null)
  const rulesByVersion = await fetchCommissionRulesForPlan(supabase, effectiveVersions)

  const items = planList.map((plan) => {
    const effectiveVersion = effectiveVersionByPlan.get(plan.id) ?? null
    const rules = effectiveVersion ? (rulesByVersion.get(effectiveVersion.id) ?? []) : []
    const categoryIds = new Set(rules.flatMap(rule => rule.category_ids))

    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      active: plan.active,
      updatedAt: plan.updated_at,
      assignedEmployeeCount: assignedCountByPlan.get(plan.id) ?? 0,
      currentVersion: effectiveVersion
        ? {
            id: effectiveVersion.id,
            effectiveFrom: effectiveVersion.effective_from,
            ruleCount: rules.length,
            categoryCount: categoryIds.size,
            hasDefault: rules.some(rule => rule.is_default)
          }
        : null
    }
  })

  return { items }
})
