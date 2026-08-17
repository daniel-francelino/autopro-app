import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { currentMonthStart } from '../../utils/bonuses'

/**
 * POST /api/bonuses
 * Creates a new bonus and its first value version in one call — a bonus
 * without at least one value version can't be evaluated, so the two are
 * created together rather than requiring a follow-up call.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'bonuses.create')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)

  if (!body?.name?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'name é obrigatório' })
  }
  if (!['revenue', 'profit'].includes(body?.commissionBase)) {
    throw createError({ statusCode: 400, statusMessage: 'commissionBase deve ser "revenue" ou "profit"' })
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

  const { data: bonus, error: bonusError } = await supabase
    .from('bonuses')
    .insert({
      organization_id: organizationId,
      name: body.name.trim(),
      description: body?.description?.trim() || null,
      active: true,
      created_by: authUser.email,
      updated_by: authUser.email
    })
    .select()
    .single()

  if (bonusError || !bonus) {
    throw createError({ statusCode: 500, statusMessage: `Failed to create bonus: ${bonusError?.message}` })
  }

  const { data: version, error: versionError } = await supabase
    .from('bonus_value_versions')
    .insert({
      bonus_id: bonus.id,
      commission_base: body.commissionBase,
      goal_amount: goalAmount,
      bonus_amount: bonusAmount,
      effective_from: effectiveFrom,
      created_by: authUser.email
    })
    .select()
    .single()

  if (versionError) {
    // Best-effort cleanup — a bonus with no value version is useless.
    await supabase.from('bonuses').delete().eq('id', bonus.id)
    throw createError({ statusCode: 500, statusMessage: `Failed to create bonus value: ${versionError.message}` })
  }

  return { item: { ...bonus, currentValue: version } }
})
