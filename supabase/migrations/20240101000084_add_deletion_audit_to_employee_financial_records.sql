-- =============================================================================
-- Migration: 20240101000084_add_deletion_audit_to_employee_financial_records
-- Description: Adds deletion_reason/deletion_source audit columns to
--              employee_financial_records, mirroring the same pattern
--              already used for financial_transactions (20240101000075) and
--              service_order_installments (20240101000076). Lets deleting a
--              commission/bonus record (e.g. from the bonus detail screen's
--              "Pagamentos" list) require and record a reason, same as the
--              Financeiro delete flow.
-- =============================================================================

ALTER TABLE public.employee_financial_records
    ADD COLUMN deletion_reason text,
    ADD COLUMN deletion_source varchar(100);

COMMENT ON COLUMN public.employee_financial_records.deletion_reason IS
    'Free-text reason. Required at the app layer when a user manually deletes a record.';
COMMENT ON COLUMN public.employee_financial_records.deletion_source IS
    'Which code path performed the delete, so the type of deletion is traceable.';
