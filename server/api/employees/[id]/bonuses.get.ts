import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import type { SupabaseClientLike } from '../../../utils/supabase-pagination'
import {
  fetchOrdersForBonusProgress,
  resolveEffectiveVersion,
  sumAchievedAmount,
  currentMonthStart
} from '../../../utils/bonuses'
import type { BonusRecord, BonusValueVersionRecord, BonusGenerationRecord } from '../../../utils/bonuses'

interface AssignmentRecord {
  id: string
  bonus_id: string
  employee_id: string
}

/**
 * GET /api/employees/:id/bonuses?referenceMonth=YYYY-MM-01
 * The reverse view of GET /api/bonuses/:id/progress — every bonus assigned
 * to this employee, with the same goal-vs-achieved progress for the given
 * month (default: current). Powers the read-only "Bônus atribuídos" card on
 * the employee detail page (docs/employee-bonus-feature-design.md §6.3).
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const employeeId = getRouterParam(event, 'id')
  if (!employeeId) {
    throw createError({ statusCode: 400, statusMessage: 'Employee id is required' })
  }

  const query = getQuery(event)
  const referenceMonth = typeof query.referenceMonth === 'string' && query.referenceMonth.trim()
    ? query.referenceMonth.trim()
    : currentMonthStart()

  const { data: assignments, error: assignmentsError } = await supabase
    .from('bonus_employee_assignments')
    .select('id, bonus_id, employee_id')
    .eq('employee_id', employeeId)
    .eq('active', true)
    .is('deleted_at', null)

  if (assignmentsError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load bonus assignments: ${assignmentsError.message}` })
  }

  const bonusIds = ((assignments || []) as AssignmentRecord[]).map(assignment => assignment.bonus_id)
  if (bonusIds.length === 0) {
    return { items: [] }
  }

  const [bonusesResult, versionsResult, generationsResult, orders] = await Promise.all([
    supabase.from('bonuses').select('*').in('id', bonusIds).eq('organization_id', organizationId).is('deleted_at', null),
    supabase.from('bonus_value_versions').select('*').in('bonus_id', bonusIds),
    supabase.from('bonus_generations').select('*').in('bonus_id', bonusIds).eq('employee_id', employeeId).eq('reference_month', referenceMonth),
    fetchOrdersForBonusProgress(supabase as unknown as SupabaseClientLike, organizationId)
  ])

  if (bonusesResult.error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load bonuses: ${bonusesResult.error.message}` })
  }
  if (versionsResult.error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load bonus values: ${versionsResult.error.message}` })
  }
  if (generationsResult.error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load bonus generations: ${generationsResult.error.message}` })
  }

  const bonusById = new Map<string, BonusRecord>(
    ((bonusesResult.data || []) as BonusRecord[]).map(bonus => [bonus.id, bonus])
  )

  const versionsByBonus = new Map<string, BonusValueVersionRecord[]>()
  for (const version of (versionsResult.data || []) as BonusValueVersionRecord[]) {
    const list = versionsByBonus.get(version.bonus_id) ?? []
    list.push(version)
    versionsByBonus.set(version.bonus_id, list)
  }

  const generationByBonus = new Map<string, BonusGenerationRecord>(
    ((generationsResult.data || []) as BonusGenerationRecord[]).map(generation => [generation.bonus_id, generation])
  )

  const items = ((assignments || []) as AssignmentRecord[])
    .map((assignment) => {
      const bonus = bonusById.get(assignment.bonus_id)
      if (!bonus || !bonus.active) return null

      const generation = generationByBonus.get(assignment.bonus_id)
      if (generation) {
        return {
          bonusId: bonus.id,
          bonusName: bonus.name,
          referenceMonth,
          commissionBase: generation.commission_base,
          goalAmount: Number(generation.goal_amount),
          bonusAmount: Number(generation.bonus_amount),
          achievedAmount: Number(generation.achieved_amount),
          goalMet: generation.goal_met,
          generated: true
        }
      }

      const effectiveVersion = resolveEffectiveVersion(versionsByBonus.get(bonus.id) ?? [], referenceMonth)
      const achievedAmount = effectiveVersion
        ? sumAchievedAmount(orders, employeeId, referenceMonth, effectiveVersion.commission_base)
        : 0

      return {
        bonusId: bonus.id,
        bonusName: bonus.name,
        referenceMonth,
        commissionBase: effectiveVersion?.commission_base ?? null,
        goalAmount: effectiveVersion ? Number(effectiveVersion.goal_amount) : null,
        bonusAmount: effectiveVersion ? Number(effectiveVersion.bonus_amount) : null,
        achievedAmount,
        goalMet: effectiveVersion ? achievedAmount >= Number(effectiveVersion.goal_amount) : false,
        generated: false
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return { items }
})
