import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import { recordAudit } from '../../../utils/audit/record'
import { OS_EVENT_KEYS, OS_SOURCE_POLICIES, buildCommissionPaidEvent, historyContext, osEvent, recordWithContext, resolveEntryOsLink, snapshotMoney } from '../../../utils/os-history/events'

/**
 * POST /api/financial/:id/pay
 * Mark a financial transaction as paid.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'financial.update', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const history = historyContext(event, OS_SOURCE_POLICIES.financialEntries)
  const id = getRouterParam(event, 'id')

  const { data: existing } = await supabase
    .from('financial_transactions')
    .select('id, status, type, amount, bank_account_id, due_date, description')
    .eq('id', id!)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Lançamento não encontrado' })
  if (existing.status === 'paid') throw createError({ statusCode: 400, statusMessage: 'Lançamento já está marcado como pago' })

  // Conta bancária: mesmo comportamento do pagamento em lote (saldo + extrato), sem duplicar extrato.
  let createdStatementId: string | null = null
  let accountId: string | null = null
  let previousBalance: number | null = null
  if (existing.bank_account_id) {
    const { data: account } = await supabase
      .from('bank_accounts')
      .select('id, current_balance')
      .eq('id', existing.bank_account_id)
      .eq('organization_id', organizationId)
      .maybeSingle()

    const { data: existingStatements } = account
      ? await supabase
          .from('bank_account_statements')
          .select('id')
          .eq('financial_transaction_id', existing.id)
          .eq('organization_id', organizationId)
      : { data: null }

    if (account && !(existingStatements && existingStatements.length > 0)) {
      const amount = Number(existing.amount || 0)
      previousBalance = Number(account.current_balance || 0)
      const balanceAfter = Math.round((existing.type === 'income' ? previousBalance + amount : previousBalance - amount) * 100) / 100

      const { data: statement, error: statementError } = await supabase
        .from('bank_account_statements')
        .insert({
          organization_id: organizationId,
          bank_account_id: account.id,
          financial_transaction_id: existing.id,
          transaction_date: existing.due_date || new Date().toISOString().slice(0, 10),
          description: existing.description || `Lançamento (${existing.id})`,
          transaction_type: existing.type || 'expense',
          amount,
          previous_balance: previousBalance,
          balance_after: balanceAfter,
          notes: `Ref. ao lançamento financeiro: ${String(existing.description || '')}`,
          created_by: authUser.email
        })
        .select('id')
        .single()
      if (statementError) throw createError({ statusCode: 500, statusMessage: statementError.message })
      createdStatementId = statement?.id ?? null

      const { error: balanceError } = await supabase
        .from('bank_accounts')
        .update({ current_balance: balanceAfter, updated_by: authUser.email })
        .eq('id', account.id)
        .eq('organization_id', organizationId)
      if (balanceError) {
        if (createdStatementId) await supabase.from('bank_account_statements').delete().eq('id', createdStatementId)
        throw createError({ statusCode: 500, statusMessage: balanceError.message })
      }
      accountId = account.id
    }
  }

  const { data: item, error } = await supabase
    .from('financial_transactions')
    .update({ status: 'paid', updated_by: authUser.email })
    .eq('id', id!)
    .eq('organization_id', organizationId)
    .select()
    .single()

  if (error) {
    // Desfaz saldo/extrato para não deixar a conta movimentada com o lançamento ainda pendente.
    if (createdStatementId) await supabase.from('bank_account_statements').delete().eq('id', createdStatementId)
    if (accountId && previousBalance !== null) {
      await supabase.from('bank_accounts').update({ current_balance: previousBalance }).eq('id', accountId).eq('organization_id', organizationId)
    }
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  recordAudit(event, { before: { status: existing.status }, after: { status: 'paid' } })

  // Histórico da OS: só lançamento ligado a OS/comissão. D13 (fora de escopo): este handler NÃO sincroniza o
  // registro da comissão; o evento registra isso (record_synced=false) em vez de afirmar que a comissão foi paga.
  await recordWithContext(history, supabase, async () => {
    const link = await resolveEntryOsLink(supabase, organizationId, item as Record<string, unknown>)
    if (!link) return []
    if (link.kind === 'commission') {
      return [await buildCommissionPaidEvent(supabase, {
        organizationId,
        serviceOrderId: link.serviceOrderId,
        recordId: link.recordId,
        employeeName: link.employeeName,
        amount: existing.amount,
        paymentDate: existing.due_date,
        bankAccountId: existing.bank_account_id,
        transactionId: String(existing.id),
        viaEntry: true,
        recordSynced: false
      })]
    }
    return [osEvent('entry.paid_outside_os', {
      organizationId,
      serviceOrderId: link.serviceOrderId,
      entityType: 'financial_transaction',
      entityId: String(existing.id),
      idempotencyKey: OS_EVENT_KEYS.entryPaid(String(existing.id), history.scope!)
    }, { amount: snapshotMoney(existing.amount), entry_type: existing.type === 'income' ? 'income' : 'expense' })]
  })

  return item
})
