import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireAuthUser } from '../../../../utils/require-auth'
import { resolveOrganizationId } from '../../../../utils/organization'
import { recalculateServiceOrderPaymentStatus } from '../../../../utils/service-order-payment-status'
import { releaseServiceOrderCommissions } from '../../../../utils/service-order-commissions'
import { softDeleteFinancialTransaction, FINANCIAL_TRANSACTION_DELETION_SOURCES } from '../../../../utils/financial-transaction-deletion'

/**
 * DELETE /api/service-orders/:id/installments/:installmentId
 * Removes a line from the payment plan — any status (pending, overdue,
 * partial, paid). A motive is always required, regardless of status: it's
 * the only thing distinguishing "delete" from a silent data-loss action.
 *
 * If the installment has money received against it (partial/paid), every
 * linked financial_transactions row is reversed first (bank balance +
 * statement + soft delete with the same user-supplied reason) — same
 * guard/mechanics as financial-transactions/[transactionId].delete.ts,
 * repeated per transaction instead of a single one. A pending/overdue
 * installment has no linked transactions, so that step is a no-op.
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

  const body = (await readBody(event).catch(() => null)) || {}
  const reason = String(body?.reason || '').trim()
  if (!reason) {
    throw createError({ statusCode: 400, statusMessage: 'O motivo da exclusão é obrigatório' })
  }

  const { data: installment, error: installmentError } = await supabase
    .from('service_order_installments')
    .select('*')
    .eq('id', installmentId)
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (installmentError || !installment) {
    throw createError({ statusCode: 404, statusMessage: 'Parcela não encontrada' })
  }

  // Any receipt still linked to this installment — via the new
  // service_order_installment_id FK or the legacy financial_transaction_id
  // column (dedupe by id). Empty for a pending/overdue line.
  const linkedIds = new Set<string>()
  const { data: linkedByFk } = await supabase
    .from('financial_transactions')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('service_order_installment_id', installmentId)
    .eq('status', 'paid')
    .is('deleted_at', null)

  const linkedTransactions = [...(linkedByFk || [])]
  for (const tx of linkedTransactions) linkedIds.add(tx.id)

  if (installment.financial_transaction_id && !linkedIds.has(installment.financial_transaction_id)) {
    const { data: legacyTransaction } = await supabase
      .from('financial_transactions')
      .select('*')
      .eq('id', installment.financial_transaction_id)
      .eq('organization_id', organizationId)
      .eq('status', 'paid')
      .is('deleted_at', null)
      .maybeSingle()

    if (legacyTransaction) {
      linkedTransactions.push(legacyTransaction)
      linkedIds.add(legacyTransaction.id)
    }
  }

  if (linkedTransactions.length > 0) {
    // Same guard as cancelling the whole order's payment / undoing a single
    // receipt: never silently revert money that's already left the bank to
    // pay an employee's commission.
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
        statusMessage: 'Não é possível excluir esta parcela: existe comissão já paga a funcionário(s) nesta OS. Resolva isso manualmente antes de continuar.'
      })
    }

    for (const transaction of linkedTransactions) {
      const { data: statements } = await supabase
        .from('bank_account_statements')
        .select('*')
        .eq('financial_transaction_id', transaction.id)
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

      await softDeleteFinancialTransaction({
        supabase,
        id: transaction.id,
        organizationId,
        reason,
        source: FINANCIAL_TRANSACTION_DELETION_SOURCES.SERVICE_ORDER_INSTALLMENT_DELETE,
        userEmail: authUser.email
      })
    }
  }

  const { error: deleteError } = await supabase
    .from('service_order_installments')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: authUser.email,
      deletion_reason: reason,
      deletion_source: FINANCIAL_TRANSACTION_DELETION_SOURCES.SERVICE_ORDER_INSTALLMENT_DELETE
    })
    .eq('id', installmentId)

  if (deleteError) {
    throw createError({ statusCode: 500, statusMessage: deleteError.message })
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
