import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import { createIncomeTransaction } from '../../../utils/financial-income'
import { getNextInstallmentNumber } from '../../../utils/service-order-installments'

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
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

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

  return {
    data: {
      order: updatedOrder,
      installment: { ...installmentRow, financial_transaction_id: transaction.id }
    }
  }
})
