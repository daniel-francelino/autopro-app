import { defineEventHandler, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { resolveEffectiveVersion, currentMonthStart } from '../../utils/bonuses'
import type { BonusRecord, BonusValueVersionRecord, BonusEmployeeAssignmentRecord } from '../../utils/bonuses'

interface BonusEmployeeRecord {
  id: string
  name?: string | null
  photo_url?: string | null
}

/**
 * GET /api/bonuses
 * Lists bonuses for the organization, each with its currently effective
 * value (see docs/finance/bonuses-feature-design.md §4.2) and how many
 * employees are actively assigned.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'bonuses.read')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const { data: bonuses, error: bonusesError } = await supabase
    .from('bonuses')
    .select('*')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (bonusesError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load bonuses: ${bonusesError.message}` })
  }

  const bonusIds = (bonuses || []).map((bonus: BonusRecord) => bonus.id)

  const [versionsResult, assignmentsResult] = await Promise.all([
    bonusIds.length > 0
      ? supabase.from('bonus_value_versions').select('*').in('bonus_id', bonusIds)
      : Promise.resolve({ data: [] as BonusValueVersionRecord[], error: null }),
    bonusIds.length > 0
      ? supabase.from('bonus_employee_assignments').select('*').in('bonus_id', bonusIds).is('deleted_at', null).eq('active', true)
      : Promise.resolve({ data: [] as BonusEmployeeAssignmentRecord[], error: null })
  ])

  if (versionsResult.error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load bonus values: ${versionsResult.error.message}` })
  }
  if (assignmentsResult.error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load bonus assignments: ${assignmentsResult.error.message}` })
  }

  const assignments = (assignmentsResult.data || []) as BonusEmployeeAssignmentRecord[]
  const employeeIds = [...new Set(assignments.map(assignment => assignment.employee_id))]
  const { data: employeesData, error: employeesError } = employeeIds.length > 0
    ? await supabase
        .from('employees')
        .select('id, name, photo_url')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .in('id', employeeIds)
    : { data: [] as BonusEmployeeRecord[], error: null }

  if (employeesError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load assigned employees: ${employeesError.message}` })
  }

  const employeeById = new Map<string, BonusEmployeeRecord>(
    ((employeesData || []) as BonusEmployeeRecord[]).map(employee => [employee.id, employee])
  )

  const versionsByBonus = new Map<string, BonusValueVersionRecord[]>()
  for (const version of (versionsResult.data || []) as BonusValueVersionRecord[]) {
    const list = versionsByBonus.get(version.bonus_id) ?? []
    list.push(version)
    versionsByBonus.set(version.bonus_id, list)
  }

  const assignmentCountByBonus = new Map<string, number>()
  const assignedEmployeesByBonus = new Map<string, Array<{ id: string, name: string, photoUrl: string | null }>>()
  for (const assignment of assignments) {
    assignmentCountByBonus.set(assignment.bonus_id, (assignmentCountByBonus.get(assignment.bonus_id) ?? 0) + 1)

    const employee = employeeById.get(assignment.employee_id)
    const list = assignedEmployeesByBonus.get(assignment.bonus_id) ?? []
    list.push({
      id: assignment.employee_id,
      name: employee?.name || 'Funcionário',
      photoUrl: employee?.photo_url || null
    })
    assignedEmployeesByBonus.set(assignment.bonus_id, list)
  }

  const month = currentMonthStart()

  const items = ((bonuses || []) as BonusRecord[]).map((bonus) => {
    const currentValue = resolveEffectiveVersion(versionsByBonus.get(bonus.id) ?? [], month)
    return {
      id: bonus.id,
      name: bonus.name,
      description: bonus.description,
      active: bonus.active,
      assignedEmployeesCount: assignmentCountByBonus.get(bonus.id) ?? 0,
      assignedEmployees: (assignedEmployeesByBonus.get(bonus.id) ?? [])
        .sort((employeeA, employeeB) => employeeA.name.localeCompare(employeeB.name, 'pt-BR')),
      currentValue: currentValue
        ? {
            commissionBase: currentValue.commission_base,
            goalAmount: Number(currentValue.goal_amount),
            bonusAmount: Number(currentValue.bonus_amount),
            effectiveFrom: currentValue.effective_from
          }
        : null
    }
  })

  return { items }
})
