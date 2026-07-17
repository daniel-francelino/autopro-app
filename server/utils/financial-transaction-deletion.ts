import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Canonical list of what can delete a financial_transactions row. Kept as
 * one source of truth so `deletion_source` values are greppable and never
 * drift into ad-hoc strings per call site.
 */
export const FINANCIAL_TRANSACTION_DELETION_SOURCES = {
  MANUAL_DELETE: 'financial.manual_delete',
  SERVICE_ORDER_CANCEL: 'service_orders.cancel',
  SERVICE_ORDER_DELETE: 'service_orders.delete',
  SERVICE_ORDER_PAYMENT_DELETE: 'service_orders.payment_delete',
  SERVICE_ORDER_RECEIPT_REVERSAL: 'service_orders.financial_transactions.delete',
  PAY_COMMISSIONS_BULK_ROLLBACK: 'financial.pay_commissions_bulk.rollback',
  COMMISSION_PAY_ROLLBACK: 'reports.commissions.pay.rollback',
  INCOME_TRANSACTION_ROLLBACK: 'financial_income.rollback'
} as const

export type FinancialTransactionDeletionSource =
  typeof FINANCIAL_TRANSACTION_DELETION_SOURCES[keyof typeof FINANCIAL_TRANSACTION_DELETION_SOURCES]

type SoftDeleteFinancialTransactionParams = {
  supabase: SupabaseClient
  id: string
  organizationId: string
  reason: string
  source: FinancialTransactionDeletionSource
  userEmail?: string | null
}

/**
 * Single write path for deleting a financial_transactions row. Every
 * deletion — whether a user clicking "excluir" or the system reversing a
 * payment — goes through here so `deletion_reason`/`deletion_source` are
 * never skipped and rows always stay soft-deleted (never a hard DELETE),
 * keeping the audit trail intact.
 */
export async function softDeleteFinancialTransaction({
  supabase,
  id,
  organizationId,
  reason,
  source,
  userEmail
}: SoftDeleteFinancialTransactionParams) {
  return supabase
    .from('financial_transactions')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: userEmail || null,
      deletion_reason: reason,
      deletion_source: source
    })
    .eq('id', id)
    .eq('organization_id', organizationId)
}
