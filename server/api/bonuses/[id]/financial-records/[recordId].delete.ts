import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireAuthUser } from '../../../../utils/require-auth'
import { requireOrgPermission } from '../../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../../utils/organization'
import { fetchBonus } from '../../../../utils/bonuses'
import { softDeleteFinancialTransaction, FINANCIAL_TRANSACTION_DELETION_SOURCES } from '../../../../utils/financial-transaction-deletion'

interface EmployeeFinancialRecordRow {
  id: string
  status: string | null
  financial_transaction_id: string | null
}

/**
 * DELETE /api/bonuses/:id/financial-records/:recordId
 * body: { reason: string }
 *
 * Deletes a bonus payout row, following the same pattern as the generic
 * Financeiro "excluir lançamento" flow (server/api/financial/[id].delete.ts):
 * a non-empty reason is required, and the delete is always a soft delete
 * with an audit trail (deletion_reason/deletion_source).
 *
 * If the record was already paid (status=paid, financial_transaction_id
 * set), this also reverses the money movement it caused — restores the
 * bank account balance from the linked bank_account_statements row's own
 * previous_balance, removes that statement row, and soft-deletes the linked
 * financial_transactions row — mirroring reverseServiceOrderReceipt's
 * reversal logic (service-order-receipt-reversal.ts), just without any of
 * the service-order/installment cascading this bonus record never has.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'bonuses.delete')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const bonusId = getRouterParam(event, 'id')
  const recordId = getRouterParam(event, 'recordId')
  if (!bonusId || !recordId) {
    throw createError({ statusCode: 400, statusMessage: 'Bonus id and record id are required' })
  }

  const bonus = await fetchBonus(supabase, organizationId, bonusId)
  if (!bonus) {
    throw createError({ statusCode: 404, statusMessage: 'Bônus não encontrado' })
  }

  const body = (await readBody(event).catch(() => null)) || {}
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    throw createError({ statusCode: 400, statusMessage: 'O motivo da exclusão é obrigatório' })
  }

  const { data: record, error: recordError } = await supabase
    .from('employee_financial_records')
    .select('id, status, financial_transaction_id')
    .eq('id', recordId)
    .eq('bonus_id', bonusId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (recordError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load bonus payment: ${recordError.message}` })
  }
  if (!record) {
    throw createError({ statusCode: 404, statusMessage: 'Pagamento de bônus não encontrado' })
  }

  const typedRecord = record as EmployeeFinancialRecordRow

  if (typedRecord.status === 'paid' && typedRecord.financial_transaction_id) {
    const { data: transaction } = await supabase
      .from('financial_transactions')
      .select('id')
      .eq('id', typedRecord.financial_transaction_id)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle()

    if (transaction) {
      const { data: statements } = await supabase
        .from('bank_account_statements')
        .select('*')
        .eq('financial_transaction_id', transaction.id)
        .eq('organization_id', organizationId)

      for (const statement of statements || []) {
        if (statement.bank_account_id) {
          await supabase
            .from('bank_accounts')
            .update({ current_balance: statement.previous_balance, updated_by: authUser.email })
            .eq('id', statement.bank_account_id)
            .eq('organization_id', organizationId)
        }
        await supabase.from('bank_account_statements').delete().eq('id', statement.id)
      }

      await softDeleteFinancialTransaction({
        supabase,
        id: transaction.id,
        organizationId,
        reason,
        source: FINANCIAL_TRANSACTION_DELETION_SOURCES.EMPLOYEE_FINANCIAL_RECORD_DELETE,
        userEmail: authUser.email
      })
    }
  }

  const { error: deleteError } = await supabase
    .from('employee_financial_records')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: authUser.email,
      deletion_reason: reason,
      deletion_source: FINANCIAL_TRANSACTION_DELETION_SOURCES.EMPLOYEE_FINANCIAL_RECORD_DELETE,
      updated_by: authUser.email
    })
    .eq('id', recordId)
    .eq('organization_id', organizationId)

  if (deleteError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to delete bonus payment: ${deleteError.message}` })
  }

  return { success: true }
})
