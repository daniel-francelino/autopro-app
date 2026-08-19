import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import { resolveEmployeeCommissionRules } from '../../../utils/employee-commission-plans'
import { currentCommissionMonthStart, toCommissionMonthStart } from '../../../../lib/utils/employee-commission-engine'

/**
 * GET /api/employees/:id/commission-rules?referenceDate=YYYY-MM-DD
 * Flat list of ResolvedCommissionRule for this employee, resolved for
 * referenceDate (defaults to today). Powers the live OS commission preview
 * (app/utils/service-orders.ts, Step 8 cutover —
 * docs/finance/commissions-step8-engine-cutover.md §7.1) so it runs the
 * exact same rule-matching/amount math as the server engines, without
 * duplicating the resolve-plan-assignment logic client-side.
 *
 * Deliberately NOT gated by requireOrgPermission('commissions.read') — the
 * legacy preview this replaces has always read commission_type/amount
 * straight off the employees list embedded in the OS create/edit form,
 * available to anyone who can create an OS regardless of Financeiro
 * permissions. Gating this endpoint would regress that (e.g. a mechanic role
 * without Financeiro access losing their own commission preview while
 * filling out an OS). Same reasoning as GET /api/product-categories.
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
  const referenceDate = typeof query.referenceDate === 'string' && query.referenceDate.trim()
    ? toCommissionMonthStart(query.referenceDate.trim())
    : currentCommissionMonthStart()

  const rules = await resolveEmployeeCommissionRules(supabase, organizationId, employeeId, referenceDate)

  return { items: rules }
})
