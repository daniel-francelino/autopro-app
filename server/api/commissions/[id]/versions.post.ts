import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import {
  fetchCommissionPlan,
  insertCommissionRuleVersion,
  parseCommissionRulesInput
} from '../../../utils/employee-commission-plans'
import { currentCommissionMonthStart } from '../../../../shared/utils/employee-commission-engine'

/**
 * POST /api/commissions/:id/versions
 * Appends a new rule version to a plan — editing rules NEVER updates an
 * existing version, it always creates a new one (mirrors POST
 * /api/bonuses/:id/value-versions). Rejects with 409 if a version already
 * starts in the same effectiveFrom month, instead of silently creating a
 * second one.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'commissions.update')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const planId = getRouterParam(event, 'id')
  if (!planId) {
    throw createError({ statusCode: 400, statusMessage: 'Plan id is required' })
  }

  const plan = await fetchCommissionPlan(supabase, organizationId, planId)
  if (!plan) {
    throw createError({ statusCode: 404, statusMessage: 'Configuração de comissão não encontrada' })
  }

  const body = await readBody(event)

  let parsedRules
  try {
    parsedRules = parseCommissionRulesInput(body?.rules)
  } catch (parseError) {
    throw createError({ statusCode: 400, statusMessage: (parseError as Error).message })
  }

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

  const effectiveFrom = typeof body?.effectiveFrom === 'string' && body.effectiveFrom.trim()
    ? body.effectiveFrom.trim()
    : currentCommissionMonthStart()

  const { data: existingVersion } = await supabase
    .from('employee_commission_rule_versions')
    .select('id')
    .eq('plan_id', planId)
    .eq('effective_from', effectiveFrom)
    .maybeSingle()

  if (existingVersion) {
    throw createError({ statusCode: 409, statusMessage: 'Já existe uma versão desta configuração começando neste mês.' })
  }

  try {
    const { version, rules } = await insertCommissionRuleVersion(
      supabase,
      planId,
      { effectiveFrom, notes: body?.notes ?? null, createdBy: authUser.email },
      parsedRules
    )
    return { item: { ...version, rules } }
  } catch (error) {
    throw createError({ statusCode: 500, statusMessage: (error as Error).message })
  }
})
