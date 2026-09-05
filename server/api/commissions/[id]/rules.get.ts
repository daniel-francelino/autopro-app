import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import { resolveCommissionPlanRules } from '../../../utils/employee-commission-plans'
import { currentCommissionMonthStart, toCommissionMonthStart } from '../../../../lib/utils/employee-commission-engine'

/**
 * GET /api/commissions/:id/rules?referenceDate=YYYY-MM-DD
 * Flat list of ResolvedCommissionRule for this plan (not a specific
 * employee), resolved for referenceDate (defaults to today). Mirrors
 * GET /api/employees/:id/commission-rules but keyed by plan instead of
 * employee — powers the manual commission override picker (docs/finance/
 * commissions-manual-override.md), which needs to preview/apply a plan's
 * rules regardless of whether it's assigned to the employee in question.
 *
 * Gated by commissions.read (unlike the employee endpoint) since it exposes
 * one plan's configured rates — same permission GET /api/commissions and
 * GET /api/commissions/:id already require.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'commissions.read')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const planId = getRouterParam(event, 'id')
  if (!planId) {
    throw createError({ statusCode: 400, statusMessage: 'Plan id is required' })
  }

  const query = getQuery(event)
  const referenceDate = typeof query.referenceDate === 'string' && query.referenceDate.trim()
    ? toCommissionMonthStart(query.referenceDate.trim())
    : currentCommissionMonthStart()

  const rules = await resolveCommissionPlanRules(supabase, organizationId, planId, referenceDate)

  return { items: rules }
})
