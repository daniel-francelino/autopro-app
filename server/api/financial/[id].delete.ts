import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { softDeleteFinancialTransaction, FINANCIAL_TRANSACTION_DELETION_SOURCES } from '../../utils/financial-transaction-deletion'
import { reverseServiceOrderReceipt } from '../../utils/service-order-receipt-reversal'

/**
 * DELETE /api/financial/:id
 * Soft-delete a financial transaction. Requires a reason: this is the
 * user-facing "excluir lançamento" action, so unlike system-triggered
 * reversals the reason can't be inferred — the person deleting it has to say why.
 *
 * A transaction created by a service order payment (service_order_id set)
 * goes through reverseServiceOrderReceipt instead of a bare soft-delete —
 * same reversal (bank balance, linked installment, order payment_status,
 * released commission) as deleting it from the OS detail page. This
 * listing has no filter on service_order_id, so those receipts show up
 * here too and need to undo the same way regardless of which screen the
 * user deletes them from.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')

  const body = (await readBody(event).catch(() => null)) || {}
  const reason = String(body?.reason || '').trim()
  if (!reason) throw createError({ statusCode: 400, statusMessage: 'O motivo da exclusão é obrigatório' })

  const { data: existing } = await supabase
    .from('financial_transactions')
    .select('id, type, service_order_id, service_order_installment_id')
    .eq('id', id!)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Lançamento não encontrado' })

  if (existing.service_order_id) {
    const { warnings } = await reverseServiceOrderReceipt({
      supabase,
      organizationId,
      transaction: existing,
      reason,
      source: FINANCIAL_TRANSACTION_DELETION_SOURCES.SERVICE_ORDER_RECEIPT_REVERSAL,
      userEmail: authUser.email
    })

    return { success: true, warnings }
  }

  const { error } = await softDeleteFinancialTransaction({
    supabase,
    id: id!,
    organizationId,
    reason,
    source: FINANCIAL_TRANSACTION_DELETION_SOURCES.MANUAL_DELETE,
    userEmail: authUser.email
  })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
