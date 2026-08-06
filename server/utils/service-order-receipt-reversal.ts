import { createError } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { softDeleteFinancialTransaction, type FinancialTransactionDeletionSource } from './financial-transaction-deletion'
import { recalculateServiceOrderPaymentStatus } from './service-order-payment-status'
import { releaseServiceOrderCommissions } from './service-order-commissions'

type ReceiptTransaction = {
  id: string
  type?: string | null
  service_order_id?: string | null
  service_order_installment_id?: string | null
}

type ReverseServiceOrderReceiptParams = {
  supabase: SupabaseClient
  organizationId: string
  transaction: ReceiptTransaction
  reason: string
  source: FinancialTransactionDeletionSource
  userEmail?: string | null
}

function roundMoney(value: number) {
  return Number(value.toFixed(2))
}

/**
 * Reverses everything a paid income receipt against a service order did —
 * bank balance, the installment it was settling, the order's
 * payment_status, and released commission — then soft-deletes the
 * transaction itself.
 *
 * Shared by the two places a user can delete one of these transactions: the
 * OS detail page's "cancelar recebimento" (server/api/service-orders/[id]/
 * financial-transactions/[transactionId].delete.ts) and the generic
 * Financeiro "excluir lançamento" (server/api/financial/[id].delete.ts). A
 * receipt created by a service order payment must undo the same way no
 * matter which screen the user deletes it from — before this was shared,
 * deleting it from Financeiro left the bank balance, the installment status
 * and the order's payment_status all stale (see the OS installment-delete
 * bug this mirrors).
 */
export async function reverseServiceOrderReceipt({
  supabase,
  organizationId,
  transaction,
  reason,
  source,
  userEmail
}: ReverseServiceOrderReceiptParams) {
  const orderId = transaction.service_order_id

  if (!orderId) {
    throw createError({ statusCode: 500, statusMessage: 'Este lançamento não está vinculado a uma ordem de serviço' })
  }

  if (transaction.type !== 'income') {
    throw createError({ statusCode: 409, statusMessage: 'Este lançamento não é um recebimento' })
  }

  // Same guard everywhere money tied to an order gets undone: never
  // silently revert cash that's already left the bank to pay an employee's
  // commission.
  const { data: paidCommissions } = await supabase
    .from('employee_financial_records')
    .select('id')
    .eq('service_order_id', orderId)
    .eq('record_type', 'commission')
    .eq('organization_id', organizationId)
    .eq('status', 'paid')
    .limit(1)

  if (paidCommissions && paidCommissions.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Não é possível cancelar este recebimento: existe comissão já paga a funcionário(s) nesta OS. Resolva isso manualmente antes de continuar.'
    })
  }

  // Revert the bank balance using each statement's own recorded previous
  // balance, then remove the statement and the transaction. A no-op if the
  // transaction was never `paid` (no statement was ever created for it).
  const { data: statements } = await supabase
    .from('bank_account_statements')
    .select('*')
    .eq('financial_transaction_id', transaction.id)
    .eq('organization_id', organizationId)

  for (const statement of statements || []) {
    if (statement.bank_account_id) {
      await supabase
        .from('bank_accounts')
        .update({ current_balance: statement.previous_balance, updated_by: userEmail || null })
        .eq('id', statement.bank_account_id)
        .eq('organization_id', organizationId)
    }
    await supabase.from('bank_account_statements').delete().eq('id', statement.id)
  }

  await softDeleteFinancialTransaction({
    supabase,
    id: transaction.id,
    organizationId,
    reason,
    source,
    userEmail
  })

  // Re-derive the installment this receipt was settling, if any.
  const installmentId = transaction.service_order_installment_id
  if (installmentId) {
    const { data: installment } = await supabase
      .from('service_order_installments')
      .select('*')
      .eq('id', installmentId)
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (installment) {
      const { data: remainingTransactions } = await supabase
        .from('financial_transactions')
        .select('amount')
        .eq('service_order_installment_id', installmentId)
        .eq('organization_id', organizationId)
        .eq('status', 'paid')
        .is('deleted_at', null)

      const stillReceived = roundMoney((remainingTransactions || []).reduce((sum, row) => sum + Number(row.amount || 0), 0))
      const installmentAmount = roundMoney(Number(installment.amount || 0))
      const nextStatus = stillReceived <= 0.01 ? 'pending' : stillReceived >= installmentAmount - 0.01 ? 'paid' : 'partial'

      const installmentUpdate: Record<string, unknown> = {
        status: nextStatus,
        updated_by: userEmail || null
      }
      if (nextStatus !== 'paid') installmentUpdate.payment_date = null
      if (installment.financial_transaction_id === transaction.id) installmentUpdate.financial_transaction_id = null

      await supabase
        .from('service_order_installments')
        .update(installmentUpdate)
        .eq('id', installmentId)
    }
  }

  await recalculateServiceOrderPaymentStatus({
    supabase,
    organizationId,
    orderId,
    userEmail
  })

  const commissionResult = await releaseServiceOrderCommissions({
    supabase,
    organizationId,
    orderId,
    userEmail
  })

  return { orderId, warnings: commissionResult.warnings }
}
