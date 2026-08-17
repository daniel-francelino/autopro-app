import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import { fetchBonus } from '../../../utils/bonuses'

/**
 * POST /api/bonuses/:id/assignments
 * Assigns an employee to a bonus. bonus_employee_assignments has a
 * unique(bonus_id, employee_id) constraint that doesn't care about
 * active/deleted_at, so a previously-unassigned employee is reactivated
 * (UPDATE) instead of inserted again.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'bonuses.update')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const bonusId = getRouterParam(event, 'id')
  if (!bonusId) {
    throw createError({ statusCode: 400, statusMessage: 'Bonus id is required' })
  }

  const bonus = await fetchBonus(supabase, organizationId, bonusId)
  if (!bonus) {
    throw createError({ statusCode: 404, statusMessage: 'Bônus não encontrado' })
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

  const { data: existing, error: existingError } = await supabase
    .from('bonus_employee_assignments')
    .select('*')
    .eq('bonus_id', bonusId)
    .eq('employee_id', employeeId)
    .maybeSingle()

  if (existingError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to check existing assignment: ${existingError.message}` })
  }

  if (existing && existing.active && !existing.deleted_at) {
    throw createError({ statusCode: 409, statusMessage: 'Funcionário já está atribuído a este bônus.' })
  }

  if (existing) {
    const { data, error } = await supabase
      .from('bonus_employee_assignments')
      .update({ active: true, deleted_at: null, deleted_by: null, updated_by: authUser.email })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) {
      throw createError({ statusCode: 500, statusMessage: `Failed to reactivate assignment: ${error.message}` })
    }
    return { item: data }
  }

  const { data, error } = await supabase
    .from('bonus_employee_assignments')
    .insert({
      bonus_id: bonusId,
      employee_id: employeeId,
      active: true,
      created_by: authUser.email,
      updated_by: authUser.email
    })
    .select()
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to create assignment: ${error.message}` })
  }

  return { item: data }
})
