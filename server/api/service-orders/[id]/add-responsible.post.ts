import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import { addServiceOrderResponsible } from '../../../utils/service-order-responsible-admin'

/**
 * POST /api/service-orders/:id/add-responsible
 *
 * TEMPORARY data-cleanup endpoint — see
 * server/utils/service-order-responsible-admin.ts for what to delete along
 * with this file once it's no longer needed.
 *
 * Adds one employee to responsible_employees and computes/creates their
 * commission entitlement for this order's current items.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const orderId = getRouterParam(event, 'id')
  const body = await readBody(event).catch(() => ({})) as { employeeId?: unknown, reason?: unknown }
  const employeeId = typeof body.employeeId === 'string' ? body.employeeId.trim() : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  if (!orderId) {
    throw createError({ statusCode: 400, statusMessage: 'orderId is required' })
  }
  if (!employeeId) {
    throw createError({ statusCode: 400, statusMessage: 'employeeId is required' })
  }

  const result = await addServiceOrderResponsible({
    supabase,
    organizationId,
    orderId,
    employeeId,
    reason,
    userEmail: authUser.email,
    userName: typeof authUser.user_metadata?.name === 'string' ? authUser.user_metadata.name : null
  })

  return {
    data: result
  }
})
