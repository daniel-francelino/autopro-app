-- =============================================================================
-- Migration: 20240101000075_add_deletion_audit_to_financial_transactions
-- Description: Adds an audit trail for deletions of financial_transactions.
--
--              deletion_reason: free-text reason. Required at the app layer
--              when a human explicitly deletes an entry (financial.manual_delete);
--              auto-filled with a fixed message for system-triggered reversals
--              (cancelling an order, reverting a payment, rollback on error).
--
--              deletion_source: which code path performed the delete, so the
--              row's history is traceable without grepping the codebase.
--              See server/utils/financial-transaction-deletion.ts for the
--              canonical list of values.
--
--              This migration also converts every remaining hard-delete of
--              financial_transactions to soft-delete (application-side change,
--              paired with this migration) so nothing bypasses the audit trail
--              by disappearing from the table before a reason can be recorded.
-- =============================================================================

ALTER TABLE public.financial_transactions
    ADD COLUMN deletion_reason text,
    ADD COLUMN deletion_source varchar(100);

COMMENT ON COLUMN public.financial_transactions.deletion_reason IS
    'Why this transaction was deleted. Required for user-initiated deletes; auto-filled for system reversals. NULL for rows never deleted.';

COMMENT ON COLUMN public.financial_transactions.deletion_source IS
    'Which endpoint/flow performed the delete (e.g. financial.manual_delete, service_orders.cancel). See server/utils/financial-transaction-deletion.ts.';
