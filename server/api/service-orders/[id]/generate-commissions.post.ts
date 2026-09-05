import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import { releaseServiceOrderCommissions } from '../../../utils/service-order-commissions'

/**
 * POST /api/service-orders/:id/generate-commissions
 * Recomputes commission entitlement and release for a service order from
 * its current items, responsibles and amount already received.
 *
 * An optional `employeeId` in the body scopes the recalculation to a single
 * employee — only their records are created/adjusted, and it errors instead
 * of touching anything if that employee already has a paid commission on
 * this order. When `employeeId` is set, `reason` is required and gets
 * appended (with who/when) to the order's commission_recalculation_log.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const orderId = getRouterParam(event, 'id')
  const body = await readBody(event).catch(() => ({})) as { employeeId?: unknown, reason?: unknown }
  const employeeId = typeof body.employeeId === 'string' && body.employeeId.trim()
    ? body.employeeId.trim()
    : null
  const reason = typeof body.reason === 'string' ? body.reason.trim() : null

  if (!orderId) {
    throw createError({ statusCode: 400, statusMessage: 'orderId is required' })
  }

  const result = await releaseServiceOrderCommissions({
    supabase,
    organizationId,
    orderId,
    userEmail: authUser.email,
    userName: typeof authUser.user_metadata?.name === 'string' ? authUser.user_metadata.name : null,
    employeeId,
    reason
  })

  return {
    data: result
  }
})
