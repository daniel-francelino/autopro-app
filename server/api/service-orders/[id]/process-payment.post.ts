import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import { releaseServiceOrderCommissions } from '../../../utils/service-order-commissions'
import { recalculateServiceOrderPaymentStatus } from '../../../utils/service-order-payment-status'
import { createIncomeTransaction } from '../../../utils/financial-income'
import { getNextInstallmentNumber } from '../../../utils/service-order-installments'

/**
 * POST /api/service-orders/:id/process-payment
 * Creates the payment plan for the remainder of a completed service order:
 * installments, the transactions for any of them already paid, and
 * commissions. Reconciles against down payments (sinal) already received
 * before the order was completed, if any.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

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
    paymentDate,
    releaseCommissionsInFull
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

  // One-way switch: once set, this order releases 100% of employee
  // commission on every future call instead of proportionally to what's
  // been received (see server/utils/service-order-commissions.ts). Only
  // offered here, at plan-generation time, since this is the point where
  // the order's total is already locked (status === 'completed').
  if (releaseCommissionsInFull && order.commission_release_mode !== 'full') {
    const { error: releaseModeError } = await supabase
      .from('service_orders')
      .update({ commission_release_mode: 'full', updated_by: authUser.email })
      .eq('id', orderId)

    if (releaseModeError) {
      throw createError({ statusCode: 500, statusMessage: releaseModeError.message })
    }
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
    await recalculateServiceOrderPaymentStatus({ supabase, organizationId, orderId, userEmail: authUser.email })

    const commissionResult = await releaseServiceOrderCommissions({ supabase, organizationId, orderId, userEmail: authUser.email })
    warnings.push(...commissionResult.warnings)

    const { data: updatedOrder } = await supabase.from('service_orders').select('*').eq('id', orderId).single()

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

  let parentTransactionId: string | null = null
  const installmentNumberOffset = (await getNextInstallmentNumber({ supabase, organizationId, orderId })) - 1
  const paidInstallmentIdsThisCall: string[] = []

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
  await supabase
    .from('service_orders')
    .update({
      payment_method: paymentMethod,
      is_installment: installmentsData.length > 1,
      installment_count: installmentsData.length,
      updated_by: authUser.email
    })
    .eq('id', orderId)

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
    userEmail: authUser.email,
    triggeringInstallmentId: paidInstallmentIdsThisCall.length === 1 ? paidInstallmentIdsThisCall[0] : null
  })

  warnings.push(...commissionResult.warnings)

  // Fetch updated order
  const { data: updatedOrder } = await supabase
    .from('service_orders')
    .select('*')
    .eq('id', orderId)
    .single()

  return {
    data: {
      order: updatedOrder,
      commissions: commissionResult.commissions,
      totalCommission: commissionResult.totalCommission,
      warnings
    }
  }
})
