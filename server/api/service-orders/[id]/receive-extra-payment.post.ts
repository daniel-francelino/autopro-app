import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import { createIncomeTransaction } from '../../../utils/financial-income'
import { recalculateServiceOrderPaymentStatus } from '../../../utils/service-order-payment-status'
import { releaseServiceOrderCommissions } from '../../../utils/service-order-commissions'
import { getNextInstallmentNumber } from '../../../utils/service-order-installments'

/**
 * POST /api/service-orders/:id/receive-extra-payment
 * Registers an ad-hoc receipt against a completed order that doesn't need
 * to match any installment of the existing plan — e.g. the customer pays an
 * arbitrary amount on account. Always creates a matching `kind='extra'`
 * installment row in the same amount (already settled), so the plan and
 * what's actually been received stay reconcilable for reporting.
 *
 * Restricted to `completed` orders: before that, a down payment (sinal) via
 * /down-payment is the equivalent — `process-payment.post.ts`'s
 * reconciliation at completion time only expects `down_payment` rows to
 * exist ahead of it, so an `extra` row appearing earlier would be
 * misread as "a plan already exists" and block that reconciliation.
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
    throw createError({ statusCode: 400, statusMessage: 'Informe um valor maior que zero' })
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

  if (order.status !== 'completed') {
    throw createError({ statusCode: 409, statusMessage: 'Só é possível registrar um recebimento avulso em uma OS concluída' })
  }

  const installmentNumber = await getNextInstallmentNumber({ supabase, organizationId, orderId })
  const effectiveDate = paymentDate || new Date().toISOString().split('T')[0]

  const { data: installmentRow, error: installmentError } = await supabase
    .from('service_order_installments')
    .insert({
      organization_id: organizationId,
      service_order_id: orderId,
      installment_number: installmentNumber,
      kind: 'extra',
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
    throw createError({ statusCode: 500, statusMessage: installmentError?.message || 'Failed to create extra payment' })
  }

  const transaction = await createIncomeTransaction({
    supabase,
    organizationId,
    orderId,
    description: `Recebimento avulso - #${order.number}`,
    amount: parsedAmount,
    dueDate: effectiveDate,
    status: 'paid',
    bankAccountId,
    paymentMethod: paymentMethod || null,
    paymentTerminalId: paymentTerminalId || null,
    serviceOrderInstallmentId: installmentRow.id,
    notes: `Recebimento avulso da ordem de serviço #${order.number}`,
    userEmail: authUser.email
  })

  await supabase
    .from('service_order_installments')
    .update({ financial_transaction_id: transaction.id })
    .eq('id', installmentRow.id)

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
    triggeringInstallmentId: installmentRow.id
  })

  const { data: updatedOrder } = await supabase
    .from('service_orders')
    .select('*')
    .eq('id', orderId)
    .single()

  return {
    data: {
      order: updatedOrder,
      installment: { ...installmentRow, financial_transaction_id: transaction.id },
      warnings: commissionResult.warnings
    }
  }
})
