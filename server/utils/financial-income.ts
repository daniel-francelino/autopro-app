import { createError } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveDefaultCategoryId } from './financial-category-defaults'

type CreateIncomeTransactionParams = {
  supabase: SupabaseClient
  organizationId: string
  orderId: string
  description: string
  amount: number
  dueDate: string
  status: 'paid' | 'pending'
  bankAccountId: string | null
  paymentMethod: string | null
  paymentTerminalId: string | null
  isInstallment?: boolean
  installmentCount?: number | null
  currentInstallment?: number | null
  parentTransactionId?: string | null
  serviceOrderInstallmentId?: string | null
  notes?: string | null
  userEmail?: string | null
}

function amountOf(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Creates a `financial_transactions` income row for a service order and,
 * when it's already paid, updates the bank account balance and writes the
 * matching `bank_account_statements` entry (rolling back on any failure).
 * Shared by every endpoint that records money actually received against an
 * order — process-payment, the down-payment/sinal endpoint, and the
 * installment "pay" endpoint.
 */
export async function createIncomeTransaction({
  supabase,
  organizationId,
  orderId,
  description,
  amount,
  dueDate,
  status,
  bankAccountId,
  paymentMethod,
  paymentTerminalId,
  isInstallment = false,
  installmentCount = null,
  currentInstallment = null,
  parentTransactionId = null,
  serviceOrderInstallmentId = null,
  notes = null,
  userEmail
}: CreateIncomeTransactionParams) {
  const servicesCategory = await resolveDefaultCategoryId(supabase, organizationId, 'Serviços', 'income')

  const { data: transaction, error: transactionError } = await supabase
    .from('financial_transactions')
    .insert({
      organization_id: organizationId,
      description,
      amount,
      due_date: dueDate,
      type: 'income',
      status,
      category: servicesCategory.name,
      category_id: servicesCategory.id,
      recurrence: null,
      is_installment: isInstallment,
      installment_count: installmentCount,
      current_installment: currentInstallment,
      parent_transaction_id: parentTransactionId,
      payment_method: paymentMethod,
      service_order_id: orderId,
      service_order_installment_id: serviceOrderInstallmentId,
      bank_account_id: bankAccountId,
      payment_terminal_id: paymentTerminalId,
      notes,
      created_by: userEmail || null,
      updated_by: userEmail || null
    })
    .select()
    .single()

  if (transactionError || !transaction) {
    throw createError({ statusCode: 500, statusMessage: transactionError?.message || 'Failed to create financial transaction' })
  }

  if (status === 'paid' && bankAccountId) {
    const { data: account, error: accountError } = await supabase
      .from('bank_accounts')
      .select('id, current_balance')
      .eq('id', bankAccountId)
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (accountError || !account) {
      await supabase.from('financial_transactions').delete().eq('id', transaction.id)
      throw createError({ statusCode: 500, statusMessage: accountError?.message || 'Failed to load bank account' })
    }

    const previousBalance = amountOf(account.current_balance)
    const nextBalance = previousBalance + amount

    const { error: accountUpdateError } = await supabase
      .from('bank_accounts')
      .update({ current_balance: nextBalance, updated_by: userEmail || null })
      .eq('id', bankAccountId)
      .eq('organization_id', organizationId)

    if (accountUpdateError) {
      await supabase.from('financial_transactions').delete().eq('id', transaction.id)
      throw createError({ statusCode: 500, statusMessage: accountUpdateError.message })
    }

    const { error: statementError } = await supabase
      .from('bank_account_statements')
      .insert({
        organization_id: organizationId,
        bank_account_id: bankAccountId,
        financial_transaction_id: transaction.id,
        transaction_date: dueDate,
        description,
        transaction_type: 'income',
        amount,
        previous_balance: previousBalance,
        balance_after: nextBalance,
        notes,
        created_by: userEmail || null
      })

    if (statementError) {
      await supabase
        .from('bank_accounts')
        .update({ current_balance: previousBalance, updated_by: userEmail || null })
        .eq('id', bankAccountId)
        .eq('organization_id', organizationId)
      await supabase.from('financial_transactions').delete().eq('id', transaction.id)
      throw createError({ statusCode: 500, statusMessage: statementError.message })
    }
  }

  return transaction
}
