import { getSupabaseAdminClient } from '../../../../../utils/supabase'
import { requireAuthUser } from '../../../../../utils/require-auth'
import { resolveOrganizationId } from '../../../../../utils/organization'
import { recalculateServiceOrderPaymentStatus } from '../../../../../utils/service-order-payment-status'
import { createIncomeTransaction } from '../../../../../utils/financial-income'
import { releaseServiceOrderCommissions } from '../../../../../utils/service-order-commissions'

function roundMoney(value: number) {
  return Number(value.toFixed(2))
}

/**
 * POST /api/service-orders/:id/installments/:installmentId/pay
 * Settles money received against a single installment — in full, or
 * partially across more than one call. Updates the linked financial
 * transaction(s), adjusts the bank account balance, recalculates the
 * service order payment_status, and releases commission proportionally.
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

  const body = await readBody(event)
  const paymentDate: string = body?.payment_date || new Date().toISOString().split('T')[0]
  const requestedAmountRaw = body?.amount
  const requestedBankAccountId: string | null = body?.bank_account_id || null
  const requestedPaymentMethod: string | null = body?.payment_method || null
  const requestedPaymentTerminalId: string | null = body?.payment_terminal_id || null

  // Load installment
  const { data: installment, error: installmentError } = await supabase
    .from('service_order_installments')
    .select('*')
    .eq('id', installmentId)
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (installmentError || !installment) {
    throw createError({ statusCode: 404, statusMessage: 'Parcela não encontrada' })
  }

  if (installment.status === 'paid') {
    throw createError({ statusCode: 409, statusMessage: 'Parcela já foi paga' })
  }

  const installmentAmount = roundMoney(Number(installment.amount || 0))

  // An installment created before Phase 4 already carries a pending
  // placeholder transaction sized for the full amount — splitting that into
  // partial receipts isn't supported, so this path stays full-settlement
  // only, exactly as it always was.
  if (installment.financial_transaction_id) {
    if (requestedAmountRaw != null) {
      const requested = Number(requestedAmountRaw)
      if (Number.isFinite(requested) && Math.abs(requested - installmentAmount) > 0.01) {
        throw createError({ statusCode: 400, statusMessage: 'Pagamento parcial não é suportado para esta parcela' })
      }
    }

    const { data: existingTransaction, error: txError } = await supabase
      .from('financial_transactions')
      .update({
        status: 'paid',
        due_date: paymentDate,
        service_order_installment_id: installmentId,
        updated_by: authUser.email
      })
      .eq('id', installment.financial_transaction_id)
      .eq('organization_id', organizationId)
      .select()
      .single()

    if (txError || !existingTransaction) {
      throw createError({ statusCode: 500, statusMessage: txError?.message || 'Erro ao atualizar transação financeira' })
    }

    const bankAccountId = installment.bank_account_id
    if (bankAccountId) {
      const { data: account, error: accountError } = await supabase
        .from('bank_accounts')
        .select('id, current_balance')
        .eq('id', bankAccountId)
        .eq('organization_id', organizationId)
        .maybeSingle()

      if (accountError || !account) {
        throw createError({ statusCode: 500, statusMessage: 'Conta bancária não encontrada' })
      }

      const previousBalance = Number(account.current_balance || 0)
      const nextBalance = previousBalance + installmentAmount

      const { error: balanceError } = await supabase
        .from('bank_accounts')
        .update({ current_balance: nextBalance, updated_by: authUser.email })
        .eq('id', bankAccountId)
        .eq('organization_id', organizationId)

      if (balanceError) {
        throw createError({ statusCode: 500, statusMessage: balanceError.message })
      }

      const { error: statementError } = await supabase
        .from('bank_account_statements')
        .insert({
          organization_id: organizationId,
          bank_account_id: bankAccountId,
          financial_transaction_id: existingTransaction.id,
          transaction_date: paymentDate,
          description: existingTransaction.description,
          transaction_type: 'income',
          amount: installmentAmount,
          previous_balance: previousBalance,
          balance_after: nextBalance,
          created_by: authUser.email
        })

      if (statementError) {
        // Rollback balance
        await supabase
          .from('bank_accounts')
          .update({ current_balance: previousBalance, updated_by: authUser.email })
          .eq('id', bankAccountId)
          .eq('organization_id', organizationId)
        throw createError({ statusCode: 500, statusMessage: statementError.message })
      }
    }

    const { error: updateInstallmentError } = await supabase
      .from('service_order_installments')
      .update({ status: 'paid', payment_date: paymentDate, updated_by: authUser.email })
      .eq('id', installmentId)

    if (updateInstallmentError) {
      throw createError({ statusCode: 500, statusMessage: updateInstallmentError.message })
    }
  } else {
    // No transaction exists yet for this installment — it can be settled in
    // full or in parts, possibly across more than one call. How much has
    // already been received against it is whatever's already linked here.
    const { data: priorTransactions } = await supabase
      .from('financial_transactions')
      .select('amount')
      .eq('service_order_installment_id', installmentId)
      .eq('organization_id', organizationId)
      .eq('status', 'paid')
      .is('deleted_at', null)

    const alreadyReceived = roundMoney((priorTransactions || []).reduce((sum, row) => sum + Number(row.amount || 0), 0))
    const remainingBalance = roundMoney(installmentAmount - alreadyReceived)

    if (remainingBalance <= 0.01) {
      throw createError({ statusCode: 409, statusMessage: 'Esta parcela já foi totalmente recebida' })
    }

    let requestedAmount = remainingBalance
    if (requestedAmountRaw != null) {
      const parsed = Number(requestedAmountRaw)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'Informe um valor maior que zero' })
      }
      if (parsed > remainingBalance + 0.01) {
        throw createError({ statusCode: 400, statusMessage: `O valor não pode ser maior que o saldo restante da parcela (${remainingBalance.toFixed(2)})` })
      }
      requestedAmount = roundMoney(parsed)
    }

    const { data: order } = await supabase
      .from('service_orders')
      .select('number')
      .eq('id', orderId)
      .eq('organization_id', organizationId)
      .maybeSingle()

    // Each receipt against this installment can use its own method/account —
    // a partial payment doesn't have to come in the same way the rest of it
    // is expected to. Falls back to what the installment was planned with.
    const transaction = await createIncomeTransaction({
      supabase,
      organizationId,
      orderId,
      description: `Recebimento parcela ${installment.installment_number ?? ''} - #${order?.number ?? ''}`,
      amount: requestedAmount,
      dueDate: paymentDate,
      status: 'paid',
      bankAccountId: requestedBankAccountId || installment.bank_account_id,
      paymentMethod: requestedPaymentMethod || installment.payment_method,
      paymentTerminalId: requestedPaymentTerminalId || installment.payment_terminal_id,
      serviceOrderInstallmentId: installmentId,
      notes: `Pagamento da parcela ${installment.installment_number ?? ''} da ordem de serviço #${order?.number ?? ''}`,
      userEmail: authUser.email
    })

    const newReceivedTotal = roundMoney(alreadyReceived + requestedAmount)
    const isFullySettled = newReceivedTotal >= installmentAmount - 0.01

    const installmentUpdate: Record<string, unknown> = {
      status: isFullySettled ? 'paid' : 'partial',
      updated_by: authUser.email
    }
    if (isFullySettled) installmentUpdate.payment_date = paymentDate
    // Only safe to point the installment at a single transaction when
    // there's ever been exactly one — once a second receipt exists, the
    // installment can have many transactions, and there's no single right
    // answer to link here; financial_transactions.service_order_installment_id
    // is the complete picture from then on.
    if (alreadyReceived === 0 && isFullySettled) installmentUpdate.financial_transaction_id = transaction.id

    const { error: updateInstallmentError } = await supabase
      .from('service_order_installments')
      .update(installmentUpdate)
      .eq('id', installmentId)

    if (updateInstallmentError) {
      throw createError({ statusCode: 500, statusMessage: updateInstallmentError.message })
    }
  }

  // Recalculate service order payment_status from all installments
  await recalculateServiceOrderPaymentStatus({
    supabase,
    organizationId,
    orderId,
    userEmail: authUser.email
  })

  // This payment increased the order's received total — release whatever
  // commission that newly justifies.
  const commissionResult = await releaseServiceOrderCommissions({
    supabase,
    organizationId,
    orderId,
    userEmail: authUser.email,
    triggeringInstallmentId: installmentId
  })

  return { success: true, warnings: commissionResult.warnings }
})
