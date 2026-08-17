import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import type { SupabaseClientLike } from '../../../utils/supabase-pagination'
import {
  fetchBonus,
  fetchBonusValueVersions,
  fetchBonusAssignments,
  fetchOrdersForBonusProgress,
  resolveEffectiveVersion,
  sumAchievedAmount,
  currentMonthStart
} from '../../../utils/bonuses'
import type { BonusGenerationRecord } from '../../../utils/bonuses'

interface EmployeeNameRecord {
  id: string
  name?: string | null
}

/**
 * GET /api/bonuses/:id/progress?referenceMonth=YYYY-MM-01
 * Per assigned employee: goal vs. achieved for the given month (default:
 * current month). If that month was already generated, returns the frozen
 * bonus_generations snapshot; otherwise computes achieved_amount live
 * against the value version effective for that month.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'bonuses.read')
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

  const query = getQuery(event)
  const referenceMonth = typeof query.referenceMonth === 'string' && query.referenceMonth.trim()
    ? query.referenceMonth.trim()
    : currentMonthStart()

  const [versions, assignments, orders, generationsResult] = await Promise.all([
    fetchBonusValueVersions(supabase, bonusId),
    fetchBonusAssignments(supabase, bonusId, true),
    fetchOrdersForBonusProgress(supabase as unknown as SupabaseClientLike, organizationId),
    supabase
      .from('bonus_generations')
      .select('*')
      .eq('bonus_id', bonusId)
      .eq('reference_month', referenceMonth)
  ])

  if (generationsResult.error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load bonus generations: ${generationsResult.error.message}` })
  }

  const generationByEmployee = new Map<string, BonusGenerationRecord>(
    ((generationsResult.data || []) as BonusGenerationRecord[]).map(generation => [generation.employee_id, generation])
  )

  const effectiveVersion = resolveEffectiveVersion(versions, referenceMonth)

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

  const items = assignments.map((assignment) => {
    const generation = generationByEmployee.get(assignment.employee_id)

    if (generation) {
      return {
        employeeId: assignment.employee_id,
        employeeName: employeeNameById.get(assignment.employee_id) || 'Funcionário',
        referenceMonth,
        commissionBase: generation.commission_base,
        goalAmount: Number(generation.goal_amount),
        bonusAmount: Number(generation.bonus_amount),
        achievedAmount: Number(generation.achieved_amount),
        goalMet: generation.goal_met,
        generated: true,
        financialRecordId: generation.financial_record_id
      }
    }

    const achievedAmount = effectiveVersion
      ? sumAchievedAmount(orders, assignment.employee_id, referenceMonth, effectiveVersion.commission_base)
      : 0

    return {
      employeeId: assignment.employee_id,
      employeeName: employeeNameById.get(assignment.employee_id) || 'Funcionário',
      referenceMonth,
      commissionBase: effectiveVersion?.commission_base ?? null,
      goalAmount: effectiveVersion ? Number(effectiveVersion.goal_amount) : null,
      bonusAmount: effectiveVersion ? Number(effectiveVersion.bonus_amount) : null,
      achievedAmount,
      goalMet: effectiveVersion ? achievedAmount >= Number(effectiveVersion.goal_amount) : false,
      generated: false,
      financialRecordId: null
    }
  })

  return { items }
})
