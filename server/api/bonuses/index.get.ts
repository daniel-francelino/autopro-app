import { defineEventHandler, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { resolveEffectiveVersion, currentMonthStart } from '../../utils/bonuses'
import type { BonusRecord, BonusValueVersionRecord, BonusEmployeeAssignmentRecord } from '../../utils/bonuses'

/**
 * GET /api/bonuses
 * Lists bonuses for the organization, each with its currently effective
 * value (see docs/employee-bonus-feature-design.md §4.2) and how many
 * employees are actively assigned.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
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

  const versionsByBonus = new Map<string, BonusValueVersionRecord[]>()
  for (const version of (versionsResult.data || []) as BonusValueVersionRecord[]) {
    const list = versionsByBonus.get(version.bonus_id) ?? []
    list.push(version)
    versionsByBonus.set(version.bonus_id, list)
  }

  const assignmentCountByBonus = new Map<string, number>()
  for (const assignment of (assignmentsResult.data || []) as BonusEmployeeAssignmentRecord[]) {
    assignmentCountByBonus.set(assignment.bonus_id, (assignmentCountByBonus.get(assignment.bonus_id) ?? 0) + 1)
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
