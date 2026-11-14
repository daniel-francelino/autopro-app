import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import { recordAudit } from '../../../utils/audit/record'
import { releaseServiceOrderCommissions } from '../../../utils/service-order-commissions'
import { recalculateServiceOrderPaymentStatus } from '../../../utils/service-order-payment-status'
import { createIncomeTransaction } from '../../../utils/financial-income'
import { getNextInstallmentNumber } from '../../../utils/service-order-installments'
import { OS_EVENT_KEYS, OS_SOURCE_POLICIES, historyContext, loadBankAccountName, planIsAfterRemoval, osEvent, recordWithContext, snapshotDate, snapshotMethod, snapshotMoney } from '../../../utils/os-history/events'

/**
 * Aligns the order's commission release mode with the organization's setting,
 * only while the order has no released commission (any employee_financial_records
 * commission row counts, the same key the release engine uses). Once commission
 * was released the order keeps its own mode. Must run after all request
 * validations and before the first release call. No history event by design.
 */
async function syncOrderReleaseModeFromOrg(params: {
  supabase: ReturnType<typeof getSupabaseAdminClient>
  organizationId: string
  orderId: string
  currentMode: string | null
  userEmail: string | null
}) {
  const { supabase, organizationId, orderId, currentMode, userEmail } = params

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('commission_release_mode')
    .eq('id', organizationId)
    .single()

  if (orgError || !org?.commission_release_mode) {
    throw createError({ statusCode: 500, statusMessage: 'Não foi possível ler o modo de liberação de comissão da organização' })
  }

  const orgMode = org.commission_release_mode as string
  if (orgMode === currentMode) return

  const { count, error: countError } = await supabase
    .from('employee_financial_records')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('service_order_id', orderId)
    .eq('record_type', 'commission')

  if (countError) {
    throw createError({ statusCode: 500, statusMessage: countError.message })
  }
  if ((count ?? 0) > 0) return

  const { error: updateError } = await supabase
    .from('service_orders')
    .update({ commission_release_mode: orgMode, updated_by: userEmail })
    .eq('id', orderId)
    .eq('organization_id', organizationId)
    .neq('commission_release_mode', orgMode)

  if (updateError) {
    throw createError({ statusCode: 500, statusMessage: updateError.message })
  }
}

/**
 * POST /api/service-orders/:id/process-payment
 * Creates the payment plan for the remainder of a completed service order:
 * installments, the transactions for any of them already paid, and
 * commissions. Reconciles against down payments (sinal) already received
 * before the order was completed, if any.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'orders.pay', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const history = historyContext(event, OS_SOURCE_POLICIES.osDetail)
  const orderId = getRouterParam(event, 'id')

  if (!orderId) {
    throw createError({ statusCode: 400, statusMessage: 'orderId is required' })
  }

  const body = await readBody(event)
  const {
    paymentMethod,
    bankAccountId,
    paymentTerminalId,
    installments: installmentsData,
    paymentDate
  } = body || {}

  const warnings: string[] = []
  const VALID_INSTALLMENT_KINDS = ['down_payment', 'installment', 'extra']

  function amountOf(value: unknown) {
    const parsed = Number(value || 0)
    return Number.isFinite(parsed) ? parsed : 0
  }

  function kindOf(value: unknown) {
    return VALID_INSTALLMENT_KINDS.includes(String(value)) ? String(value) : 'installment'
  }

  function roundMoney(value: number) {
    return Number(value.toFixed(2))
  }

  // Fetch order
  const { data: order, error: orderError } = await supabase
    .from('service_orders')
    .select('*')
    .eq('id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (orderError || !order) {
    throw createError({ statusCode: 404, statusMessage: 'Service order not found' })
  }

  if (order.status !== 'completed') {
    throw createError({ statusCode: 409, statusMessage: 'Only completed service orders can receive payment' })
  }

  // Existing plan rows for this order. A down payment (sinal) may already
  // exist from before the order was completed — that's expected and gets
  // reconciled below, not blocked. Any other kind already existing means
  // the remainder plan was already created.
  const { data: existingInstallments } = await supabase
    .from('service_order_installments')
    .select('kind, amount')
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)

  const existingRows = existingInstallments || []

  if (existingRows.some(row => row.kind !== 'down_payment')) {
    throw createError({ statusCode: 409, statusMessage: 'Esta ordem de serviço já tem um plano de pagamento registrado' })
  }

  const priorDownPayments = roundMoney(existingRows.reduce((sum, row) => sum + amountOf(row.amount), 0))
  const totalAmount = Number(order.total_amount || 0)
  const balanceDue = roundMoney(totalAmount - priorDownPayments)
  const effectiveDate = paymentDate || new Date().toISOString().split('T')[0]

  if (balanceDue < -0.01) {
    throw createError({
      statusCode: 409,
      statusMessage: `O adiantamento já recebido (${priorDownPayments.toFixed(2)}) é maior que o valor final da OS (${totalAmount.toFixed(2)}). Cancele o pagamento registrado e devolva a diferença ao cliente antes de continuar.`
    })
  }

  // The down payment(s) already cover the full order — nothing left to
  // collect, just reconcile payment_status from what's already there.
  if (balanceDue <= 0.01) {
    await syncOrderReleaseModeFromOrg({ supabase, organizationId, orderId, currentMode: order.commission_release_mode ?? null, userEmail: authUser.email })

    await recalculateServiceOrderPaymentStatus({ supabase, organizationId, orderId, userEmail: authUser.email, history })

    const commissionResult = await releaseServiceOrderCommissions({ supabase, organizationId, orderId, userEmail: authUser.email, history })
    warnings.push(...commissionResult.warnings)

    const { data: updatedOrder } = await supabase.from('service_orders').select('*').eq('id', orderId).single()

    recordAudit(event, { before: order as Record<string, unknown>, after: updatedOrder as Record<string, unknown> | null, extra: { reconciled_only: true } })

    return {
      data: {
        order: updatedOrder,
        commissions: commissionResult.commissions,
        totalCommission: commissionResult.totalCommission,
        warnings
      }
    }
  }

  if (!Array.isArray(installmentsData) || installmentsData.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Informe ao menos uma linha de pagamento' })
  }

  const submittedTotal = installmentsData.reduce((sum: number, inst: { amount?: unknown }) => sum + amountOf(inst.amount), 0)
  if (Math.abs(submittedTotal - balanceDue) > 0.01) {
    throw createError({ statusCode: 400, statusMessage: 'A soma das linhas de pagamento precisa ser igual ao saldo restante da ordem de serviço' })
  }

  // Last point before any write: all validations passed, no installment persisted yet.
  await syncOrderReleaseModeFromOrg({ supabase, organizationId, orderId, currentMode: order.commission_release_mode ?? null, userEmail: authUser.email })

  let parentTransactionId: string | null = null
  const installmentNumberOffset = (await getNextInstallmentNumber({ supabase, organizationId, orderId })) - 1
  const paidInstallmentIdsThisCall: string[] = []
  const paidReceiptsForHistory: Array<{ installmentId: string, transactionId: string, number: number, amount: number, method: string | null, bankAccountId: string | null }> = []

  for (let i = 0; i < installmentsData.length; i++) {
    const inst = installmentsData[i]
    const installmentNumber = installmentNumberOffset + i + 1
    const installmentAmount = amountOf(inst.amount)
    const installmentDate = inst.due_date || effectiveDate
    const installmentStatus = inst.status === 'paid' ? 'paid' : 'pending'
    const installmentBankAccountId = inst.bank_account_id || bankAccountId || null
    const installmentTerminalId = inst.payment_terminal_id || paymentTerminalId || null
    const description = `Recebimento ${i + 1}/${installmentsData.length} - #${order.number}`
    const notes = `Pagamento da ordem de serviço #${order.number}`

    // Create the installment record first. A pending installment gets no
    // financial transaction yet — one is only created when it's actually
    // paid (here, if it's already paid; otherwise later via the
    // installment "pay" endpoint), so a plan never has placeholder
    // transactions for money that hasn't arrived.
    const { data: installmentRow, error: installmentError } = await supabase
      .from('service_order_installments')
      .insert({
        organization_id: organizationId,
        service_order_id: orderId,
        installment_number: installmentNumber,
        kind: kindOf(inst.kind),
        amount: installmentAmount,
        due_date: installmentDate,
        payment_date: installmentStatus === 'paid' ? effectiveDate : null,
        status: installmentStatus,
        payment_method: inst.payment_method || paymentMethod,
        bank_account_id: installmentBankAccountId,
        payment_terminal_id: installmentTerminalId,
        created_by: authUser.email,
        updated_by: authUser.email
      })
      .select()
      .single()

    if (installmentError || !installmentRow) {
      throw createError({ statusCode: 500, statusMessage: installmentError?.message || 'Failed to create installment' })
    }

    if (installmentStatus === 'paid') {
      paidInstallmentIdsThisCall.push(installmentRow.id)

      const transaction = await createIncomeTransaction({
        supabase,
        organizationId,
        orderId,
        description,
        amount: installmentAmount,
        dueDate: installmentDate,
        status: installmentStatus,
        bankAccountId: installmentBankAccountId,
        paymentMethod: inst.payment_method || paymentMethod || null,
        paymentTerminalId: installmentTerminalId,
        isInstallment: installmentsData.length > 1,
        installmentCount: installmentsData.length,
        currentInstallment: i + 1,
        parentTransactionId,
        serviceOrderInstallmentId: installmentRow.id,
        notes,
        userEmail: authUser.email
      })

      if (!parentTransactionId) {
        parentTransactionId = transaction.id
      }

      paidReceiptsForHistory.push({
        installmentId: installmentRow.id,
        transactionId: transaction.id,
        number: installmentNumber,
        amount: installmentAmount,
        method: inst.payment_method || paymentMethod || null,
        bankAccountId: installmentBankAccountId
      })

      const { error: linkError } = await supabase
        .from('service_order_installments')
        .update({ financial_transaction_id: transaction.id })
        .eq('id', installmentRow.id)

      if (linkError) {
        throw createError({ statusCode: 500, statusMessage: linkError.message })
      }
    }
  }

  // Update order fields; payment_status is recalculated from the
  // installments that were just persisted, not from the request body.
  // is_installment marks "this order has a payment plan in
  // service_order_installments" — true even for a single line — so
  // reports that branch on it (e.g. debtors) don't also count the order
  // via its own total_amount and double the pending amount.
  await supabase
    .from('service_orders')
    .update({
      payment_method: paymentMethod,
      is_installment: true,
      installment_count: installmentsData.length,
      updated_by: authUser.email
    })
    .eq('id', orderId)

  // Histórico da OS: causa (plano/recebimentos) antes dos efeitos em cascata (status, comissões); falha aqui nunca derruba a operação.
  // "Regenerar pagamentos" = payment.deleted (outra requisição) seguido deste plano; `after_removal` liga os dois.
  await recordWithContext(history, supabase, async () => {
    const afterRemoval = await planIsAfterRemoval(supabase, organizationId, orderId)
    const events = [osEvent('payment.plan_created', {
      organizationId,
      serviceOrderId: orderId,
      entityType: 'service_order',
      entityId: orderId,
      idempotencyKey: OS_EVENT_KEYS.planCreated(orderId, history.scope!)
    }, {
      installment_count: installmentsData.length,
      total_amount: snapshotMoney(balanceDue),
      paid_count: paidReceiptsForHistory.length,
      payment_method: snapshotMethod(paymentMethod),
      after_removal: afterRemoval
    })]
    for (const r of paidReceiptsForHistory) {
      events.push(osEvent('installment.paid', {
        organizationId,
        serviceOrderId: orderId,
        entityType: 'installment',
        entityId: r.installmentId,
        idempotencyKey: OS_EVENT_KEYS.installmentPaid(r.installmentId, r.transactionId)
      }, {
        installment_number: r.number,
        amount: snapshotMoney(r.amount),
        payment_method: snapshotMethod(r.method),
        payment_date: snapshotDate(effectiveDate),
        bank_account_name: await loadBankAccountName(supabase, organizationId, r.bankAccountId),
        partial: false
      }))
    }
    return events
  })

  await recalculateServiceOrderPaymentStatus({
    supabase,
    organizationId,
    orderId,
    userEmail: authUser.email,
    history
  })

  const commissionResult = await releaseServiceOrderCommissions({
    supabase,
    organizationId,
    orderId,
    userEmail: authUser.email,
    triggeringInstallmentId: paidInstallmentIdsThisCall.length === 1 ? paidInstallmentIdsThisCall[0] : null,
    history
  })

  warnings.push(...commissionResult.warnings)

  // Fetch updated order
  const { data: updatedOrder } = await supabase
    .from('service_orders')
    .select('*')
    .eq('id', orderId)
    .single()

  recordAudit(event, {
    before: order as Record<string, unknown>, after: updatedOrder as Record<string, unknown> | null,
    extra: { paymentMethod, bankAccountId, installments: installmentsData, paid_installment_ids: paidInstallmentIdsThisCall, totalCommission: commissionResult.totalCommission }
  })

  return {
    data: {
      order: updatedOrder,
      commissions: commissionResult.commissions,
      totalCommission: commissionResult.totalCommission,
      warnings
    }
  }
})
