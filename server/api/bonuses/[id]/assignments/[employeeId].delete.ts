import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireAuthUser } from '../../../../utils/require-auth'
import { requireOrgPermission } from '../../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../../utils/organization'
import { fetchBonus } from '../../../../utils/bonuses'

/**
 * DELETE /api/bonuses/:id/assignments/:employeeId
 * Unassigns an employee from a bonus (active=false + soft delete). Past
 * bonus_generations rows for them are untouched — history doesn't
 * disappear just because the assignment ended (docs/employee-bonus-feature-design.md §9.4).
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'bonuses.update')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const bonusId = getRouterParam(event, 'id')
  const employeeId = getRouterParam(event, 'employeeId')
  if (!bonusId || !employeeId) {
    throw createError({ statusCode: 400, statusMessage: 'Bonus id and employee id are required' })
  }

  const bonus = await fetchBonus(supabase, organizationId, bonusId)
  if (!bonus) {
    throw createError({ statusCode: 404, statusMessage: 'Bônus não encontrado' })
  }

  const { data, error } = await supabase
    .from('bonus_employee_assignments')
    .update({
      active: false,
      deleted_at: new Date().toISOString(),
      deleted_by: authUser.email,
      updated_by: authUser.email
    })
    .eq('bonus_id', bonusId)
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
