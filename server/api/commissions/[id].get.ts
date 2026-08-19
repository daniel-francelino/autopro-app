import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import {
  fetchCommissionPlan,
  fetchCommissionPlanAssignments,
  fetchCommissionRuleVersions,
  fetchCommissionRulesForPlan
} from '../../utils/employee-commission-plans'
import { currentCommissionMonthStart, resolveEffectiveCommissionVersion } from '../../../shared/utils/employee-commission-engine'

/**
 * GET /api/commissions/:id
 * Full detail: plan, every rule version (most recent first) with its rules
 * and category names, which version is effective today, and assigned
 * employees. Powers Financeiro > Comissões > detalhe (Step 4).
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
    fetchCommissionPlanAssignments(supabase, planId, false)
  ])

  const rulesByVersion = await fetchCommissionRulesForPlan(supabase, versions)

  const allCategoryIds = [...new Set([...rulesByVersion.values()].flatMap(rules => rules.flatMap(rule => rule.category_ids)))]
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

  const employeeIds = [...new Set(assignments.map(assignment => assignment.employee_id))]
  const employeeNameById = new Map<string, string>()
  const employeePhotoUrlById = new Map<string, string | null>()
  if (employeeIds.length > 0) {
    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select('id, name, photo_url')
      .in('id', employeeIds)

    if (employeesError) {
      throw createError({ statusCode: 500, statusMessage: `Failed to load employees: ${employeesError.message}` })
    }
    for (const employee of employees || []) {
      employeeNameById.set(employee.id, employee.name)
      employeePhotoUrlById.set(employee.id, employee.photo_url ?? null)
    }
  }

  const effectiveVersion = resolveEffectiveCommissionVersion(versions, currentCommissionMonthStart())

  const versionsPayload = versions.map(version => ({
    ...version,
    isEffective: version.id === effectiveVersion?.id,
    rules: (rulesByVersion.get(version.id) ?? []).map(rule => ({
      ...rule,
      categories: rule.category_ids.map(id => ({ id, name: categoryNameById.get(id) ?? null }))
    }))
  }))

  const assignmentsPayload = assignments.map(assignment => ({
    id: assignment.id,
    employeeId: assignment.employee_id,
    employeeName: employeeNameById.get(assignment.employee_id) ?? 'Funcionário',
    employeePhotoUrl: employeePhotoUrlById.get(assignment.employee_id) ?? null,
    active: assignment.active
  }))

  return {
    item: {
      ...plan,
      versions: versionsPayload,
      currentVersionId: effectiveVersion?.id ?? null,
      assignments: assignmentsPayload
    }
  }
})
