import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireAuthUser } from '../../../../utils/require-auth'
import { resolveOrganizationId } from '../../../../utils/organization'
import { FINANCIAL_TRANSACTION_DELETION_SOURCES } from '../../../../utils/financial-transaction-deletion'
import { reverseServiceOrderReceipt } from '../../../../utils/service-order-receipt-reversal'

/**
 * DELETE /api/service-orders/:id/financial-transactions/:transactionId
 * Reverses a single receipt against this order — e.g. to fix a wrong entry
 * (amount, account, or method) without touching anything else already
 * received. See server/utils/service-order-receipt-reversal.ts for what
 * "reverse" means (bank balance, linked installment, order payment_status,
 * released commission) — shared with the generic Financeiro delete so the
 * same receipt undoes the same way regardless of which screen it's deleted
 * from.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const orderId = getRouterParam(event, 'id')
  const transactionId = getRouterParam(event, 'transactionId')

  if (!orderId || !transactionId) {
    throw createError({ statusCode: 400, statusMessage: 'Parâmetros obrigatórios ausentes' })
  }

  const { data: transaction, error: transactionError } = await supabase
    .from('financial_transactions')
    .select('*')
    .eq('id', transactionId)
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (transactionError || !transaction) {
    throw createError({ statusCode: 404, statusMessage: 'Recebimento não encontrado' })
  }

  const { warnings } = await reverseServiceOrderReceipt({
    supabase,
    organizationId,
    transaction,
    reason: 'Estorno automático: recebimento revertido pelo usuário',
    source: FINANCIAL_TRANSACTION_DELETION_SOURCES.SERVICE_ORDER_RECEIPT_REVERSAL,
    userEmail: authUser.email
  })

  return { success: true, warnings }
})
