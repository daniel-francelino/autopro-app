import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireAuthUser } from '../../../../utils/require-auth'
import { resolveOrganizationId } from '../../../../utils/organization'
import { recalculateServiceOrderPaymentStatus } from '../../../../utils/service-order-payment-status'
import { releaseServiceOrderCommissions } from '../../../../utils/service-order-commissions'

function roundMoney(value: number) {
  return Number(value.toFixed(2))
}

/**
 * DELETE /api/service-orders/:id/financial-transactions/:transactionId
 * Reverses a single receipt against this order — e.g. to fix a wrong entry
 * (amount, account, or method) without touching anything else already
 * received. Reverts just that transaction's effect on the bank balance,
 * then re-derives the linked installment's status and the order's
 * payment_status / released commission from what's left.
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
    .maybeSingle()

  if (transactionError || !transaction) {
    throw createError({ statusCode: 404, statusMessage: 'Recebimento não encontrado' })
  }

  if (transaction.type !== 'income') {
    throw createError({ statusCode: 409, statusMessage: 'Este lançamento não é um recebimento' })
  }

  // Same guard as cancelling the whole order's payment: never silently
  // revert money that's already left the bank to pay an employee's
  // commission. A simple blanket check (any paid commission at all on this
  // order) rather than simulating exactly how much this specific receipt
  // contributed — consistent with the policy already in payment.delete.ts.
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

  // Revert the bank balance using the statement's own recorded previous
  // balance, then remove the statement and the transaction.
  const { data: statements } = await supabase
    .from('bank_account_statements')
    .select('*')
    .eq('financial_transaction_id', transactionId)
    .eq('organization_id', organizationId)

  for (const statement of statements || []) {
    if (statement.bank_account_id) {
      await supabase
        .from('bank_accounts')
        .update({ current_balance: statement.previous_balance, updated_by: authUser.email })
        .eq('id', statement.bank_account_id)
        .eq('organization_id', organizationId)
    }
    await supabase.from('bank_account_statements').delete().eq('id', statement.id)
  }

  await supabase.from('financial_transactions').delete().eq('id', transactionId)

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

      const stillReceived = roundMoney((remainingTransactions || []).reduce((sum, row) => sum + Number(row.amount || 0), 0))
      const installmentAmount = roundMoney(Number(installment.amount || 0))
      const nextStatus = stillReceived <= 0.01 ? 'pending' : stillReceived >= installmentAmount - 0.01 ? 'paid' : 'partial'

      const installmentUpdate: Record<string, unknown> = {
        status: nextStatus,
        updated_by: authUser.email
      }
      if (nextStatus !== 'paid') installmentUpdate.payment_date = null
      if (installment.financial_transaction_id === transactionId) installmentUpdate.financial_transaction_id = null

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
    userEmail: authUser.email
  })

  const commissionResult = await releaseServiceOrderCommissions({
    supabase,
    organizationId,
    orderId,
    userEmail: authUser.email
  })

  return { success: true, warnings: commissionResult.warnings }
})
