import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
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
  fetchCommissionRecordsForBonusProgress,
  resolveEffectiveVersion,
  sumAchievedAmount,
  resolveDueDate,
  currentMonthStart
} from '../../../utils/bonuses'

interface EmployeeNameRecord {
  id: string
  name?: string | null
}

type GenerateStatus = 'generated' | 'goal_not_met' | 'already_generated' | 'no_value_configured'

interface GenerateResultItem {
  employeeId: string
  employeeName: string
  status: GenerateStatus
  achievedAmount: number
  goalAmount: number | null
  bonusAmount: number | null
  financialRecordId: string | null
}

/**
 * POST /api/bonuses/:id/generate
 * body: { referenceMonth?: string, employeeId?: string }
 *
 * Bulk by default (every active assignment for the given month, default
 * current month); pass employeeId to generate just one employee in
 * isolation (retroactive fix, reprocessing) — same dedupe guard either way,
 * so calling both modes for the same (bonus, employee, month) never
 * duplicates (docs/finance/bonuses-feature-design.md §5).
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

  const body = (await readBody(event).catch(() => null)) || {}
  const referenceMonth = typeof body?.referenceMonth === 'string' && body.referenceMonth.trim()
    ? body.referenceMonth.trim()
    : currentMonthStart()
  const singleEmployeeId = typeof body?.employeeId === 'string' && body.employeeId.trim()
    ? body.employeeId.trim()
    : null

  const [versions, assignments, orders, commissionRecords, existingGenerationsResult] = await Promise.all([
    fetchBonusValueVersions(supabase, bonusId),
    fetchBonusAssignments(supabase, bonusId, true),
    fetchOrdersForBonusProgress(supabase as unknown as SupabaseClientLike, organizationId),
    fetchCommissionRecordsForBonusProgress(supabase as unknown as SupabaseClientLike, organizationId),
    supabase
      .from('bonus_generations')
      .select('employee_id')
      .eq('bonus_id', bonusId)
      .eq('reference_month', referenceMonth)
  ])

  if (existingGenerationsResult.error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to check existing generations: ${existingGenerationsResult.error.message}` })
  }

  const alreadyGeneratedEmployeeIds = new Set(
    ((existingGenerationsResult.data || []) as Array<{ employee_id: string }>).map(row => row.employee_id)
  )

  const targetAssignments = singleEmployeeId
    ? assignments.filter(assignment => assignment.employee_id === singleEmployeeId)
    : assignments

  if (singleEmployeeId && targetAssignments.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Funcionário não está atribuído a este bônus.' })
  }

  const effectiveVersion = resolveEffectiveVersion(versions, referenceMonth)

  const employeeIds = targetAssignments.map(assignment => assignment.employee_id)
  const { data: employeesData, error: employeesError } = employeeIds.length > 0
    ? await supabase.from('employees').select('id, name').in('id', employeeIds)
    : { data: [] as EmployeeNameRecord[], error: null }

  if (employeesError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load employees: ${employeesError.message}` })
  }

  const employeeNameById = new Map<string, string>(
    ((employeesData || []) as EmployeeNameRecord[]).map(employee => [employee.id, employee.name || 'Sem nome'])
  )

  const results: GenerateResultItem[] = []

  for (const assignment of targetAssignments) {
    const employeeId = assignment.employee_id
    const employeeName = employeeNameById.get(employeeId) || 'Funcionário'

    if (alreadyGeneratedEmployeeIds.has(employeeId)) {
      results.push({ employeeId, employeeName, status: 'already_generated', achievedAmount: 0, goalAmount: null, bonusAmount: null, financialRecordId: null })
      continue
    }

    if (!effectiveVersion) {
      results.push({ employeeId, employeeName, status: 'no_value_configured', achievedAmount: 0, goalAmount: null, bonusAmount: null, financialRecordId: null })
      continue
    }

    const goalAmount = Number(effectiveVersion.goal_amount)
    const bonusAmount = Number(effectiveVersion.bonus_amount)
    const achievedAmount = sumAchievedAmount(orders, employeeId, referenceMonth, effectiveVersion.commission_base, commissionRecords)
    const goalMet = achievedAmount >= goalAmount

    let financialRecordId: string | null = null

    if (goalMet) {
      const { data: financialRecord, error: financialRecordError } = await supabase
        .from('employee_financial_records')
        .insert({
          organization_id: organizationId,
          employee_id: employeeId,
          service_order_id: null,
          record_type: 'bonus',
          bonus_id: bonusId,
          status: 'pending',
          amount: bonusAmount,
          reference_date: resolveDueDate(referenceMonth, bonus.due_day),
          description: `Bônus - ${bonus.name} - ${referenceMonth}`,
          created_by: authUser.email,
          updated_by: authUser.email
        })
        .select()
        .single()

      if (financialRecordError || !financialRecord) {
        throw createError({ statusCode: 500, statusMessage: `Failed to release bonus for ${employeeName}: ${financialRecordError?.message}` })
      }
      financialRecordId = financialRecord.id
    }

    const { error: generationError } = await supabase
      .from('bonus_generations')
      .insert({
        bonus_id: bonusId,
        employee_id: employeeId,
        reference_month: referenceMonth,
        commission_base: effectiveVersion.commission_base,
        goal_amount: goalAmount,
        bonus_amount: bonusAmount,
        achieved_amount: achievedAmount,
        goal_met: goalMet,
        financial_record_id: financialRecordId,
        created_by: authUser.email
      })

    if (generationError) {
      throw createError({ statusCode: 500, statusMessage: `Failed to log bonus generation for ${employeeName}: ${generationError.message}` })
    }

    results.push({
      employeeId,
      employeeName,
      status: goalMet ? 'generated' : 'goal_not_met',
      achievedAmount,
      goalAmount,
      bonusAmount,
      financialRecordId
    })
  }

  const generatedCount = results.filter(result => result.status === 'generated').length
  const skippedCount = results.length - generatedCount

  return {
    data: {
      referenceMonth,
      generatedCount,
      skippedCount,
      results
    }
  }
})
