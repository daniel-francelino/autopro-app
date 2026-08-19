import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import {
  fetchCommissionPlan,
  fetchCommissionRuleVersions,
  fetchCommissionRulesForVersion,
  findCommissionConflicts,
  resolveEmployeeCommissionRules
} from '../../../utils/employee-commission-plans'
import { currentCommissionMonthStart, resolveEffectiveCommissionVersion } from '../../../../shared/utils/employee-commission-engine'

/**
 * POST /api/commissions/:id/assignments
 * Assigns an employee to a commission plan. Before assigning, checks that
 * the plan's current rules don't conflict with what's already effective
 * across the employee's OTHER active plan assignments (same category
 * covered twice, or two catch-all rules) — this is the check that can't be
 * expressed as a DB constraint (see the migration's comment on
 * employee_commission_rule_categories).
 *
 * employee_commission_plan_assignments has a unique(plan_id, employee_id)
 * constraint that doesn't care about active/deleted_at, so a
 * previously-unassigned employee is reactivated (UPDATE) instead of
 * inserted again — same pattern as POST /api/bonuses/:id/assignments.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'commissions.update')
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

  const body = await readBody(event)
  const employeeId = String(body?.employeeId || '').trim()
  if (!employeeId) {
    throw createError({ statusCode: 400, statusMessage: 'employeeId é obrigatório' })
  }

  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (employeeError || !employee) {
    throw createError({ statusCode: 404, statusMessage: 'Funcionário não encontrado' })
  }

  const referenceDate = currentCommissionMonthStart()
  const versions = await fetchCommissionRuleVersions(supabase, planId)
  const effectiveVersion = resolveEffectiveCommissionVersion(versions, referenceDate)
  const candidateRules = effectiveVersion ? await fetchCommissionRulesForVersion(supabase, effectiveVersion.id) : []

  const existingRules = await resolveEmployeeCommissionRules(supabase, organizationId, employeeId, referenceDate)
  const conflicts = findCommissionConflicts(candidateRules, existingRules)

  if (conflicts.length > 0) {
    const hasCategoryConflict = conflicts.some(conflict => conflict.type === 'category')
    const hasDefaultConflict = conflicts.some(conflict => conflict.type === 'default')

    let message = 'Esta configuração conflita com outra já atribuída a este funcionário.'
    if (hasCategoryConflict && !hasDefaultConflict) {
      const categoryIds = conflicts.map(conflict => conflict.categoryId).filter((id): id is string => Boolean(id))
      const { data: categories } = await supabase.from('product_categories').select('name').in('id', categoryIds)
      const names = (categories || []).map(category => category.name).join(', ')
      message = `Categoria já coberta por outra configuração deste funcionário: ${names || 'categoria em conflito'}.`
    } else if (hasDefaultConflict && !hasCategoryConflict) {
      message = 'Este funcionário já tem outra configuração com regra padrão ativa.'
    }

    throw createError({ statusCode: 409, statusMessage: message })
  }

  const { data: existing, error: existingError } = await supabase
    .from('employee_commission_plan_assignments')
    .select('*')
    .eq('plan_id', planId)
    .eq('employee_id', employeeId)
    .maybeSingle()

  if (existingError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to check existing assignment: ${existingError.message}` })
  }

  if (existing && existing.active && !existing.deleted_at) {
    throw createError({ statusCode: 409, statusMessage: 'Funcionário já está atribuído a esta configuração.' })
  }

  if (existing) {
    const { data, error } = await supabase
      .from('employee_commission_plan_assignments')
      .update({ active: true, deleted_at: null, deleted_by: null })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) {
      throw createError({ statusCode: 500, statusMessage: `Failed to reactivate assignment: ${error.message}` })
    }
    return { item: data }
  }

  const { data, error } = await supabase
    .from('employee_commission_plan_assignments')
    .insert({
      plan_id: planId,
      employee_id: employeeId,
      active: true,
      created_by: authUser.email
    })
    .select()
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to create assignment: ${error.message}` })
  }

  return { item: data }
})
