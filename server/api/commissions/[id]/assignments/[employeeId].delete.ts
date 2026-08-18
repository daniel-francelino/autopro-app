import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireAuthUser } from '../../../../utils/require-auth'
import { requireOrgPermission } from '../../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../../utils/organization'
import { fetchCommissionPlan } from '../../../../utils/employee-commission-plans'

/**
 * DELETE /api/commissions/:id/assignments/:employeeId
 * Unassigns an employee from a commission plan (active=false + soft
 * delete). Commissions already generated for them keep their snapshot
 * fields (commission_plan_id/commission_rule_id/...) untouched — history
 * doesn't disappear just because the assignment ended.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'commissions.update')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const planId = getRouterParam(event, 'id')
  const employeeId = getRouterParam(event, 'employeeId')
  if (!planId || !employeeId) {
    throw createError({ statusCode: 400, statusMessage: 'Plan id and employee id are required' })
  }

  const plan = await fetchCommissionPlan(supabase, organizationId, planId)
  if (!plan) {
    throw createError({ statusCode: 404, statusMessage: 'Configuração de comissão não encontrada' })
  }

  const { data, error } = await supabase
    .from('employee_commission_plan_assignments')
    .update({
      active: false,
      deleted_at: new Date().toISOString(),
      deleted_by: authUser.email
    })
    .eq('plan_id', planId)
    .eq('employee_id', employeeId)
    .select()
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to remove assignment: ${error.message}` })
  }
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Atribuição não encontrada' })
  }

  return { success: true }
})
