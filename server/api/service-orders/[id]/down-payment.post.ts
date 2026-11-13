import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import { recordAudit } from '../../../utils/audit/record'
import { createIncomeTransaction } from '../../../utils/financial-income'
import { getNextInstallmentNumber } from '../../../utils/service-order-installments'
import { OS_SOURCE_POLICIES, OS_EVENT_KEYS, historyContext, loadBankAccountName, osEvent, recordWithContext, snapshotDate, snapshotMethod, snapshotMoney } from '../../../utils/os-history/events'

const ORDER_STATUSES_THAT_CAN_RECEIVE_A_DOWN_PAYMENT = ['open', 'in_progress', 'waiting_for_part']

/**
 * POST /api/service-orders/:id/down-payment
 * Registers a down payment (sinal) received before the order is completed
 * — i.e. before its total is final. Money is recorded immediately (bank
 * balance, ledger), but payment_status is deliberately left untouched: it
 * isn't meaningful to call an order "partial" or "paid" against a total
 * that can still change. The down payment is reconciled against the final
 * total by process-payment.post.ts once the order reaches `completed`.
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
  const { amount, paymentDate, paymentMethod, bankAccountId, paymentTerminalId } = body || {}

  const parsedAmount = Number(amount)
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Informe um valor de sinal maior que zero' })
  }

  if (!bankAccountId) {
    throw createError({ statusCode: 400, statusMessage: 'Selecione a conta bancária' })
  }

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

  if (!ORDER_STATUSES_THAT_CAN_RECEIVE_A_DOWN_PAYMENT.includes(order.status)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Só é possível receber sinal enquanto a OS está aberta ou em andamento. Para uma OS concluída, registre o pagamento normalmente.'
    })
  }

  const installmentNumber = await getNextInstallmentNumber({ supabase, organizationId, orderId })
  const effectiveDate = paymentDate || new Date().toISOString().split('T')[0]

  const { data: installmentRow, error: installmentError } = await supabase
    .from('service_order_installments')
    .insert({
      organization_id: organizationId,
      service_order_id: orderId,
      installment_number: installmentNumber,
      kind: 'down_payment',
      amount: parsedAmount,
      due_date: effectiveDate,
      payment_date: effectiveDate,
      status: 'paid',
      payment_method: paymentMethod || null,
      bank_account_id: bankAccountId,
      payment_terminal_id: paymentTerminalId || null,
      created_by: authUser.email,
      updated_by: authUser.email
    })
    .select()
    .single()

  if (installmentError || !installmentRow) {
    throw createError({ statusCode: 500, statusMessage: installmentError?.message || 'Failed to create down payment' })
  }

  const transaction = await createIncomeTransaction({
    supabase,
    organizationId,
    orderId,
    description: `Sinal recebido - #${order.number}`,
    amount: parsedAmount,
    dueDate: effectiveDate,
    status: 'paid',
    bankAccountId,
    paymentMethod: paymentMethod || null,
    paymentTerminalId: paymentTerminalId || null,
    serviceOrderInstallmentId: installmentRow.id,
    notes: `Sinal/entrada recebido antecipadamente da ordem de serviço #${order.number}`,
    userEmail: authUser.email
  })

  await supabase
    .from('service_order_installments')
    .update({ financial_transaction_id: transaction.id })
    .eq('id', installmentRow.id)

  const { data: updatedOrder } = await supabase
    .from('service_orders')
    .select('*')
    .eq('id', orderId)
    .single()

  recordAudit(event, { before: order as Record<string, unknown>, after: updatedOrder as Record<string, unknown> | null, extra: { installment_id: installmentRow.id, amount: installmentRow.amount, financial_transaction_id: transaction.id } })

  // Histórico da OS: depois do último passo de negócio; falha aqui nunca derruba o recebimento.
  await recordWithContext(history, supabase, async () => [osEvent('payment.down_payment_received', {
    organizationId,
    serviceOrderId: orderId,
    entityType: 'financial_transaction',
    entityId: transaction.id,
    idempotencyKey: OS_EVENT_KEYS.downPayment(transaction.id)
  }, {
    amount: snapshotMoney(parsedAmount),
    payment_method: snapshotMethod(paymentMethod),
    payment_date: snapshotDate(effectiveDate),
    bank_account_name: await loadBankAccountName(supabase, organizationId, bankAccountId)
  })])

  return {
    data: {
      order: updatedOrder,
      installment: { ...installmentRow, financial_transaction_id: transaction.id }
    }
  }
})
