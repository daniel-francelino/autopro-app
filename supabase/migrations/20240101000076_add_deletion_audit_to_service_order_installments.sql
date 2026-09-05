-- =============================================================================
-- Migration: 20240101000076_add_deletion_audit_to_service_order_installments.sql
-- Description: Adds deletion_reason/deletion_source audit columns to
--              service_order_installments, mirroring migration
--              20240101000075 (same audit trail for financial_transactions).
--              service_order_installments already has deleted_at/deleted_by
--              since its creation (migration 20240101000019), but no code
--              path has ever soft-deleted it — this migration is the
--              prerequisite for the "delete an installment with mandatory
--              reason" feature (docs/service-orders/delete-paid-installment.md),
--              which is the first caller to actually use soft delete here.
-- =============================================================================

ALTER TABLE public.service_order_installments
    ADD COLUMN deletion_reason text,
    ADD COLUMN deletion_source varchar(100);

COMMENT ON COLUMN public.service_order_installments.deletion_reason IS
    'Why this installment was deleted. Always required in the delete flow, regardless of the installment status at the time (pending, overdue, partial or paid). NULL for rows never deleted.';
COMMENT ON COLUMN public.service_order_installments.deletion_source IS
    'Which endpoint/flow performed the delete. Today only one value: service_orders.installment_delete. See server/api/service-orders/[id]/installments/[installmentId].delete.ts.';
