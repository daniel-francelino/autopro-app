import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import { fetchBonus, currentMonthStart } from '../../../utils/bonuses'

const validCommissionBases = ['revenue', 'profit', 'revenue_minus_parts', 'employee_net_profit']

/**
 * POST /api/bonuses/:id/value-versions
 * Appends a new value version — editing a bonus's value NEVER updates an
 * existing row (see docs/employee-bonus-feature-design.md §4.2). The
 * unique(bonus_id, effective_from) constraint rejects a second version
 * starting the same month.
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

  if (!validCommissionBases.includes(body?.commissionBase)) {
    throw createError({ statusCode: 400, statusMessage: 'commissionBase inválido' })
  }
  const goalAmount = Number(body?.goalAmount)
  const bonusAmount = Number(body?.bonusAmount)
  if (!Number.isFinite(goalAmount) || goalAmount <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'goalAmount deve ser um número maior que zero' })
  }
  if (!Number.isFinite(bonusAmount) || bonusAmount <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'bonusAmount deve ser um número maior que zero' })
  }

  const effectiveFrom = typeof body?.effectiveFrom === 'string' && body.effectiveFrom.trim()
    ? body.effectiveFrom.trim()
    : currentMonthStart()

  const { data, error } = await supabase
    .from('bonus_value_versions')
    .insert({
      bonus_id: bonusId,
      commission_base: body.commissionBase,
      goal_amount: goalAmount,
      bonus_amount: bonusAmount,
      effective_from: effectiveFrom,
      created_by: authUser.email
    })
    .select()
    .single()

  if (error) {
    if (String(error.code) === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'Já existe um valor cadastrado a partir desse mês para este bônus.' })
    }
    throw createError({ statusCode: 500, statusMessage: `Failed to create bonus value version: ${error.message}` })
  }

  return { item: data }
})
