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
 * appended (with who/when) to the order's commission_manual_adjustments_log.
 *
 * An optional `override` alongside `employeeId`/`reason` applies or removes
 * a one-off commission rate for that employee on this order only (docs/
 * finance/commissions-manual-override.md) — e.g. 15% instead of their usual
 * 9%, just for this OS. It reuses the same recalculation path: the override
 * takes effect immediately in this same call (the entitlement is
 * recomputed under it) and is recorded in the same audit log entry.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const orderId = getRouterParam(event, 'id')
  const body = await readBody(event).catch(() => ({})) as {
    employeeId?: unknown
    reason?: unknown
    override?: {
      action?: unknown
      commissionType?: unknown
      commissionAmount?: unknown
      commissionBase?: unknown
    }
  }
  const employeeId = typeof body.employeeId === 'string' && body.employeeId.trim()
    ? body.employeeId.trim()
    : null
  const reason = typeof body.reason === 'string' ? body.reason.trim() : null

  const overrideAction = body.override?.action === 'apply' || body.override?.action === 'remove'
    ? body.override.action
    : null
  const overrideCommissionType = body.override?.commissionType === 'percentage' || body.override?.commissionType === 'fixed_amount'
    ? body.override.commissionType
    : null
  const overrideCommissionAmount = typeof body.override?.commissionAmount === 'number'
    ? body.override.commissionAmount
    : null
  const overrideCommissionBase = body.override?.commissionBase === 'revenue' || body.override?.commissionBase === 'profit'
    ? body.override.commissionBase
    : null

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
    reason,
    overrideAction,
    overrideCommissionType,
    overrideCommissionAmount,
    overrideCommissionBase
  })

  return {
    data: result
  }
})
