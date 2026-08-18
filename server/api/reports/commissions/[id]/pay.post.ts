import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireAuthUser } from '../../../../utils/require-auth'
import { resolveOrganizationId } from '../../../../utils/organization'
import { resolveDefaultCategoryId } from '../../../../utils/financial-category-defaults'
import { softDeleteFinancialTransaction, FINANCIAL_TRANSACTION_DELETION_SOURCES } from '../../../../utils/financial-transaction-deletion'

function normalizeNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeIsoDateOrNull(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().split('T')[0]
}

/**
 * POST /api/reports/commissions/:id/pay
 * Marks a single employee_financial_record (commission) as paid, creating
 * the matching expense transaction and bank statement entry. Mirrors
 * /api/financial/pay-commissions-bulk for a single record — previously this
 * endpoint only flipped the status, never moving the bank balance.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')

  const { data: existing } = await supabase
    .from('employee_financial_records')
    .select('*')
    .eq('id', id!)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Comissão não encontrada' })
  if (existing.status === 'paid') throw createError({ statusCode: 400, statusMessage: 'Comissão já está marcada como paga' })

  const body = (await readBody(event).catch(() => null)) || {}
  const requestedAccountId = body?.bankAccountId ? String(body.bankAccountId) : null
  const paymentDate = normalizeIsoDateOrNull(body?.paymentDate) || new Date().toISOString().split('T')[0]

  let bankAccount: { id: string, current_balance: number | string | null } | null = null

  if (requestedAccountId) {
    const { data: account } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('id', requestedAccountId)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (!account) throw createError({ statusCode: 400, statusMessage: 'Conta bancária inválida ou acesso negado' })
    bankAccount = account
  } else {
    const { data: activeAccounts } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .limit(1)
    if (!activeAccounts || activeAccounts.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'Nenhuma conta bancária ativa encontrada. Configure uma conta bancária antes de pagar comissões.' })
    }
    bankAccount = activeAccounts[0]
  }

  const amount = normalizeNumber(existing.amount)
  const previousBalance = normalizeNumber(bankAccount.current_balance)
  const nextBalance = previousBalance - amount
  const description = existing.description || `Pagamento de comissão (${id})`
  const notes = `Pagamento de comissão - ${String(existing.employee_id || '')}`

  let transactionId: string | null = null
  let statementId: string | null = null
  let balanceUpdated = false

  try {
    const salariesCategory = await resolveDefaultCategoryId(supabase, organizationId, 'Salários', 'expense')

    const { data: transaction, error: transactionError } = await supabase
      .from('financial_transactions')
      .insert({
        description,
        amount,
        due_date: paymentDate,
        type: 'expense',
        status: 'paid',
        category: salariesCategory.name,
        category_id: salariesCategory.id,
        recurrence: 'non_recurring',
        bank_account_id: bankAccount.id,
        employee_financial_record_id: id,
        notes,
        organization_id: organizationId,
        created_by: authUser.email
      })
      .select()
      .single()

    if (transactionError || !transaction) throw new Error(transactionError?.message || 'Erro ao criar transação financeira')
    transactionId = transaction.id

    const { error: balanceError } = await supabase
      .from('bank_accounts')
      .update({ current_balance: nextBalance, updated_by: authUser.email })
      .eq('id', bankAccount.id)

    if (balanceError) throw new Error(balanceError.message)
    balanceUpdated = true

    const { data: statement, error: statementError } = await supabase
      .from('bank_account_statements')
      .insert({
        bank_account_id: bankAccount.id,
        financial_transaction_id: transactionId,
        transaction_date: paymentDate,
        description,
        transaction_type: 'expense',
        amount,
        previous_balance: previousBalance,
        balance_after: nextBalance,
        notes,
        organization_id: organizationId,
        created_by: authUser.email
      })
      .select()
      .single()

    if (statementError || !statement) throw new Error(statementError?.message || 'Erro ao criar extrato bancário')
    statementId = statement.id

    const { data: item, error: updateError } = await supabase
      .from('employee_financial_records')
      .update({
        status: 'paid',
        payment_date: paymentDate,
        financial_transaction_id: transactionId,
        updated_by: authUser.email
      })
      .eq('id', id!)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .select()
      .single()

    if (updateError) throw new Error(updateError.message)

    return { success: true, data: item }
  } catch (error: unknown) {
    // Best-effort rollback, same approach as pay-commissions-bulk
    try {
      if (statementId) await supabase.from('bank_account_statements').delete().eq('id', statementId)
    } catch { /* best-effort rollback */ }
    try {
      if (balanceUpdated && bankAccount) {
        await supabase.from('bank_accounts').update({ current_balance: previousBalance, updated_by: authUser.email }).eq('id', bankAccount.id)
      }
    } catch { /* best-effort rollback */ }
    try {
      if (transactionId) {
        const message = error instanceof Error ? error.message : String(error)
        await softDeleteFinancialTransaction({
          supabase,
          id: transactionId,
          organizationId,
          reason: `Rollback automático: falha ao pagar comissão (${message})`,
          source: FINANCIAL_TRANSACTION_DELETION_SOURCES.COMMISSION_PAY_ROLLBACK,
          userEmail: authUser.email
        })
      }
    } catch { /* best-effort rollback */ }

    const message = error instanceof Error ? error.message : String(error)
    throw createError({ statusCode: 500, statusMessage: message })
  }
})
