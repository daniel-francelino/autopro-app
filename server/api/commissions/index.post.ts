import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import {
  insertCommissionRuleVersion,
  parseCommissionRulesInput
} from '../../utils/employee-commission-plans'
import { currentCommissionMonthStart } from '../../../shared/utils/employee-commission-engine'

/**
 * POST /api/commissions
 * Creates a new commission plan and its first rule version in one call — a
 * plan without at least one version can't be evaluated, so the two are
 * created together (mirrors POST /api/bonuses for bonus + first value version).
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'commissions.create')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)

  if (!body?.name?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'name é obrigatório' })
  }

  let parsedRules
  try {
    parsedRules = parseCommissionRulesInput(body?.rules)
  } catch (parseError) {
    throw createError({ statusCode: 400, statusMessage: (parseError as Error).message })
  }

  if (parsedRules.length > 0) {
    const categoryIds = [...new Set(parsedRules.flatMap(rule => rule.categoryIds))]
    if (categoryIds.length > 0) {
      const { data: categories, error: categoriesError } = await supabase
        .from('product_categories')
        .select('id')
        .eq('organization_id', organizationId)
        .in('id', categoryIds)

      if (categoriesError) {
        throw createError({ statusCode: 500, statusMessage: `Failed to validate categories: ${categoriesError.message}` })
      }
      if ((categories?.length ?? 0) !== categoryIds.length) {
        throw createError({ statusCode: 400, statusMessage: 'Uma ou mais categorias informadas são inválidas' })
      }
    }
  }

  const { data: plan, error: planError } = await supabase
    .from('employee_commission_plans')
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

  if (planError || !plan) {
    if (String(planError?.code) === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'Já existe uma configuração de comissão com esse nome.' })
    }
    throw createError({ statusCode: 500, statusMessage: `Failed to create commission plan: ${planError?.message}` })
  }

  const effectiveFrom = typeof body?.effectiveFrom === 'string' && body.effectiveFrom.trim()
    ? body.effectiveFrom.trim()
    : currentCommissionMonthStart()

  try {
    const { version, rules } = await insertCommissionRuleVersion(
      supabase,
      plan.id,
      { effectiveFrom, notes: body?.notes ?? null, createdBy: authUser.email },
      parsedRules
    )
    return { item: { ...plan, currentVersion: version, currentRules: rules } }
  } catch (error) {
    // Best-effort cleanup — a plan with no valid version is useless.
    await supabase.from('employee_commission_plans').delete().eq('id', plan.id)
    throw createError({ statusCode: 500, statusMessage: (error as Error).message })
  }
})
