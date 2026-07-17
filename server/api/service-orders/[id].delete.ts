import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { softDeleteFinancialTransaction, FINANCIAL_TRANSACTION_DELETION_SOURCES } from '../../utils/financial-transaction-deletion'

/**
 * DELETE /api/service-orders/:id
 * Deletes a service order and all related records (cascade soft-delete).
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

  let deletedStatements = 0
  let deletedTransactions = 0
  let deletedCommissions = 0
  let deletedInstallments = 0

  // Helper to delete bank statements and revert balances
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

  // 1. Delete commissions and linked financial entries
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
        reason: `Estorno automático: OS #${order.number} excluída (comissão revertida)`,
        source: FINANCIAL_TRANSACTION_DELETION_SOURCES.SERVICE_ORDER_DELETE,
        userEmail: authUser.email
      })
      if (!error) deletedTransactions++
    }
    await supabase.from('employee_financial_records').delete().eq('id', commission.id)
    deletedCommissions++
  }

  // 2. Delete installments and linked financial entries
  const { data: installments } = await supabase
    .from('service_order_installments')
    .select('*')
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)

  for (const installment of installments || []) {
    if (installment.financial_transaction_id) {
      await deleteStatementsAndRevert(installment.financial_transaction_id)
      const { error } = await softDeleteFinancialTransaction({
        supabase,
        id: installment.financial_transaction_id,
        organizationId,
        reason: `Estorno automático: OS #${order.number} excluída (parcela revertida)`,
        source: FINANCIAL_TRANSACTION_DELETION_SOURCES.SERVICE_ORDER_DELETE,
        userEmail: authUser.email
      })
      if (!error) deletedTransactions++
    }
    await supabase.from('service_order_installments').delete().eq('id', installment.id)
    deletedInstallments++
  }

  // 3. Delete financial entries directly linked to the order
  const { data: directTransactions } = await supabase
    .from('financial_transactions')
    .select('id')
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)

  for (const tx of directTransactions || []) {
    await deleteStatementsAndRevert(tx.id)
    const { error } = await softDeleteFinancialTransaction({
      supabase,
      id: tx.id,
      organizationId,
      reason: `Estorno automático: OS #${order.number} excluída`,
      source: FINANCIAL_TRANSACTION_DELETION_SOURCES.SERVICE_ORDER_DELETE,
      userEmail: authUser.email
    })
    if (!error) deletedTransactions++
  }

  // 4. Soft-delete the order
  const { error: deleteError } = await supabase
    .from('service_orders')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: authUser.email
    })
    .eq('id', orderId)

  if (deleteError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to delete service order: ${deleteError.message}` })
  }

  return {
    data: {
      orderId,
      orderNumber: order.number,
      deleted: {
        statements: deletedStatements,
        transactions: deletedTransactions,
        commissions: deletedCommissions,
        installments: deletedInstallments
      },
      warnings
    }
  }
})
