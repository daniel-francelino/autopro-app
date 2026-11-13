import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { recordAudit } from '../../utils/audit/record'
import { softDeleteFinancialTransaction, FINANCIAL_TRANSACTION_DELETION_SOURCES } from '../../utils/financial-transaction-deletion'
import { reverseServiceOrderReceipt } from '../../utils/service-order-receipt-reversal'
import { OS_EVENT_KEYS, OS_SOURCE_POLICIES, historyContext, osEvent, recordWithContext, resolveEntryOsLink, snapshotMoney } from '../../utils/os-history/events'

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
  await requireOrgPermission(authUser.id, 'financial.delete', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const history = historyContext(event, OS_SOURCE_POLICIES.financialEntries)
  const id = getRouterParam(event, 'id')

  const body = (await readBody(event).catch(() => null)) || {}
  const reason = String(body?.reason || '').trim()
  if (!reason) throw createError({ statusCode: 400, statusMessage: 'O motivo da exclusão é obrigatório' })

  const { data: existing } = await supabase
    .from('financial_transactions')
    .select('*')
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
      userEmail: authUser.email,
      history
    })

    recordAudit(event, { before: existing, extra: { reason, reversed_service_order_receipt: true } })

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

  // Histórico da OS: lançamento de comissão excluído (o registro da comissão não é tocado por este handler).
  await recordWithContext(history, supabase, async () => {
    const link = await resolveEntryOsLink(supabase, organizationId, existing)
    if (!link || link.kind !== 'commission') return []
    return [osEvent('commission.entry_deleted', {
      organizationId,
      serviceOrderId: link.serviceOrderId,
      entityType: 'financial_transaction',
      entityId: String(id),
      idempotencyKey: OS_EVENT_KEYS.commissionEntryDeleted(String(id))
    }, { employee_name: link.employeeName, amount: snapshotMoney(existing.amount), reason })]
  })

  recordAudit(event, { before: existing, extra: { reason } })

  return { success: true }
})
