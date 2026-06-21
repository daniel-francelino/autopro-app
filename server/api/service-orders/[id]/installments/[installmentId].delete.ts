import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireAuthUser } from '../../../../utils/require-auth'
import { resolveOrganizationId } from '../../../../utils/organization'
import { recalculateServiceOrderPaymentStatus } from '../../../../utils/service-order-payment-status'

/**
 * DELETE /api/service-orders/:id/installments/:installmentId
 * Removes a line from the payment plan that hasn't received any money yet
 * — e.g. to merge it into another installment when renegotiating overdue
 * payments (bump the other line's amount up via PATCH, then drop this one).
 * A line that's been paid or partially paid can't be removed this way;
 * cancel its receipt(s) first.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const orderId = getRouterParam(event, 'id')
  const installmentId = getRouterParam(event, 'installmentId')

  if (!orderId || !installmentId) {
    throw createError({ statusCode: 400, statusMessage: 'Parâmetros obrigatórios ausentes' })
  }

  const { data: installment, error: installmentError } = await supabase
    .from('service_order_installments')
    .select('id, status')
    .eq('id', installmentId)
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (installmentError || !installment) {
    throw createError({ statusCode: 404, statusMessage: 'Parcela não encontrada' })
  }

  if (installment.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'Só é possível remover uma parcela que ainda não recebeu nenhum pagamento' })
  }

  const { error: deleteError } = await supabase
    .from('service_order_installments')
    .delete()
    .eq('id', installmentId)

  if (deleteError) {
    throw createError({ statusCode: 500, statusMessage: deleteError.message })
  }

  // Removing a still-pending line can be the only thing keeping the order
  // from being fully settled (e.g. its amount was merged into another
  // line) — recompute payment_status from what's left.
  await recalculateServiceOrderPaymentStatus({
    supabase,
    organizationId,
    orderId,
    userEmail: authUser.email
  })

  return { success: true }
})
