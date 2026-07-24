import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import { softDeleteFinancialTransaction, FINANCIAL_TRANSACTION_DELETION_SOURCES } from '../../../utils/financial-transaction-deletion'

/**
 * POST /api/service-orders/:id/cancel
 * Cancels a service order: deletes commissions/financial entries, sets status to cancelled.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const orderId = getRouterParam(event, 'id')

  if (!orderId) {
    throw createError({ statusCode: 400, statusMessage: 'orderId is required' })
  }

  const warnings: string[] = []

  // Fetch order and verify access
  const { data: order, error: orderError } = await supabase
    .from('service_orders')
    .select('*')
    .eq('id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (orderError || !order) {
    throw createError({ statusCode: 404, statusMessage: 'Service order not found or access denied' })
  }

  // Idempotent: if already cancelled, return success
  if (order.status === 'cancelled') {
    return {
      data: {
        orderId,
        orderNumber: order.number,
        deleted: { statements: 0, transactions: 0, commissions: 0 },
        updatedOrder: order,
        warnings
      }
    }
  }

  // Guard: cannot cancel if payment was registered
  if (order.payment_status !== 'pending') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Cannot cancel a service order with registered payment. Cancel the payment first.'
    })
  }

  // Check for existing installments
  const { data: installments } = await supabase
    .from('service_order_installments')
    .select('id')
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .limit(1)

  if (installments && installments.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Cannot cancel a service order with registered payment. Cancel the payment first.'
    })
  }

  // Check for existing cash payment entries
  if (order.number) {
    const { data: cashEntries } = await supabase
      .from('financial_transactions')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('type', 'income')
      .ilike('description', `%OS #${order.number}%`)
      .is('deleted_at', null)
      .limit(1)

    if (cashEntries && cashEntries.length > 0) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Cannot cancel a service order with registered payment. Cancel the payment first.'
      })
    }
  }

  let deletedStatements = 0
  let deletedTransactions = 0
  let deletedCommissions = 0

  // Helper to delete bank statements and revert balances for a transaction
  const deleteStatementsAndRevert = async (transactionId: string) => {
    const { data: statements } = await supabase
      .from('bank_account_statements')
      .select('*')
      .eq('financial_transaction_id', transactionId)
      .eq('organization_id', organizationId)

    for (const stmt of statements || []) {
      try {
        if (stmt.bank_account_id) {
          await supabase
            .from('bank_accounts')
            .update({ current_balance: stmt.previous_balance, updated_by: authUser.email })
            .eq('id', stmt.bank_account_id)
            .eq('organization_id', organizationId)
        }
        await supabase.from('bank_account_statements').delete().eq('id', stmt.id)
        deletedStatements++
      } catch (err: any) {
        warnings.push(`Failed to delete statement ${stmt.id}: ${err.message}`)
      }
    }
  }

  // Delete commissions and linked financial entries
  const { data: commissions } = await supabase
    .from('employee_financial_records')
    .select('*')
    .eq('service_order_id', orderId)
    .eq('record_type', 'commission')
    .eq('organization_id', organizationId)

  for (const commission of commissions || []) {
    if (commission.financial_transaction_id) {
      await deleteStatementsAndRevert(commission.financial_transaction_id)
      const { error } = await softDeleteFinancialTransaction({
        supabase,
        id: commission.financial_transaction_id,
        organizationId,
        reason: `Estorno automático: OS #${order.number} cancelada (comissão revertida)`,
        source: FINANCIAL_TRANSACTION_DELETION_SOURCES.SERVICE_ORDER_CANCEL,
        userEmail: authUser.email
      })
      if (!error) deletedTransactions++
    }
    await supabase.from('employee_financial_records').delete().eq('id', commission.id)
    deletedCommissions++
  }

  // Update order status to cancelled
  const { data: updatedOrder } = await supabase
    .from('service_orders')
    .update({
      status: 'cancelled',
      commission_amount: 0,
      updated_by: authUser.email
    })
    .eq('id', orderId)
    .select()
    .single()

  return {
    data: {
      orderId,
      orderNumber: order.number,
      deleted: {
        statements: deletedStatements,
        transactions: deletedTransactions,
        commissions: deletedCommissions
      },
      updatedOrder,
      warnings
    }
  }
})
