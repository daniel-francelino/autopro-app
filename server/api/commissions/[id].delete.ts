import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchCommissionPlan } from '../../utils/employee-commission-plans'

/**
 * DELETE /api/commissions/:id
 * Soft-deletes a commission plan. Version/rule history and any
 * employee_financial_records already generated from it are untouched — the
 * trail back to "which plan produced this commission" never disappears.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'commissions.delete')
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

  const { error } = await supabase
    .from('employee_commission_plans')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: authUser.email,
      updated_by: authUser.email
    })
    .eq('id', planId)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to delete commission plan: ${error.message}` })
  }

  return { success: true }
})
