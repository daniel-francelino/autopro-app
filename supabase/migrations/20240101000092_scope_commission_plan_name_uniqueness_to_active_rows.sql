-- =============================================================================
-- Migration: 20240101000092_scope_commission_plan_name_uniqueness_to_active_rows
-- Description:
--   employee_commission_plans_organization_name_uq (from 20240101000085) is a
--   plain UNIQUE (organization_id, name) constraint — it doesn't exclude
--   soft-deleted rows. That means renaming (or creating) a plan to a name
--   already used by a plan the user already deleted fails with "Já existe uma
--   configuração de comissão com esse nome", even though the deleted plan is
--   invisible everywhere in the UI. Same bug class already fixed for
--   installments in 20240101000077 (scope_installment_number_uniqueness_to_active_rows).
--
--   Fix: replace the full-table constraint with a partial unique index that
--   only applies to non-deleted rows, so a deleted plan's name frees up for
--   reuse immediately.
-- =============================================================================

ALTER TABLE public.employee_commission_plans
  DROP CONSTRAINT employee_commission_plans_organization_name_uq;

CREATE UNIQUE INDEX employee_commission_plans_organization_name_uq
  ON public.employee_commission_plans (organization_id, name)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX public.employee_commission_plans_organization_name_uq IS
  'Plan names are unique per organization only among non-deleted rows — a soft-deleted plan frees its name for reuse.';
