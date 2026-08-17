import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchBonus, fetchBonusValueVersions, fetchBonusAssignments, resolveEffectiveVersion, currentMonthStart } from '../../utils/bonuses'

interface EmployeeNameRecord {
  id: string
  name?: string | null
}

/**
 * GET /api/bonuses/:id
 * Full detail for the bonus screen: identity, the complete (append-only)
 * value history, and assigned employees with their names resolved.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bonus id is required' })
  }

  const bonus = await fetchBonus(supabase, organizationId, id)
  if (!bonus) {
    throw createError({ statusCode: 404, statusMessage: 'Bônus não encontrado' })
  }

  const [versions, assignments] = await Promise.all([
    fetchBonusValueVersions(supabase, id),
    fetchBonusAssignments(supabase, id, false)
  ])

  const employeeIds = assignments.map(assignment => assignment.employee_id)
  const { data: employeesData, error: employeesError } = employeeIds.length > 0
    ? await supabase.from('employees').select('id, name').in('id', employeeIds)
    : { data: [] as EmployeeNameRecord[], error: null }

  if (employeesError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load assigned employees: ${employeesError.message}` })
  }

  const employeeNameById = new Map<string, string>(
    ((employeesData || []) as EmployeeNameRecord[]).map(employee => [employee.id, employee.name || 'Sem nome'])
  )

  const currentValue = resolveEffectiveVersion(versions, currentMonthStart())

  return {
    item: {
      id: bonus.id,
      name: bonus.name,
      description: bonus.description,
      active: bonus.active,
      currentValue: currentValue
        ? {
            commissionBase: currentValue.commission_base,
            goalAmount: Number(currentValue.goal_amount),
            bonusAmount: Number(currentValue.bonus_amount),
            effectiveFrom: currentValue.effective_from
          }
        : null,
      valueHistory: versions.map(version => ({
        id: version.id,
        commissionBase: version.commission_base,
        goalAmount: Number(version.goal_amount),
        bonusAmount: Number(version.bonus_amount),
        effectiveFrom: version.effective_from,
        createdAt: version.created_at,
        createdBy: version.created_by
      })),
      assignments: assignments.map(assignment => ({
        id: assignment.id,
        employeeId: assignment.employee_id,
        employeeName: employeeNameById.get(assignment.employee_id) || 'Funcionário',
        active: assignment.active
      }))
    }
  }
})
