-- =============================================================================
-- Migration: 20240101000093_drop_legacy_employee_commission_columns
-- Description: Step 10 (final) of docs/finance/commissions-configuration-architecture.md
--   — removes the 5 legacy commission columns from `employees` now that every
--   calculation engine and every UI surface reads exclusively from the new
--   model (employee_commission_plans -> ...rule_versions -> ...rules ->
--   ...rule_categories -> ...plan_assignments, Steps 2-9, cutover detailed in
--   docs/finance/commissions-step8-engine-cutover.md):
--     has_commission, commission_type, commission_amount, commission_base,
--     commission_categories
--
--   has_commission is dropped too, not kept as an operational flag — after
--   the Step 10 code cleanup (removing the legacy fallback branches from the
--   4 former calculation engines and the "Comissionado" badge on the
--   employee detail page, which now reads assignedCommissionPlans.length > 0
--   instead), nothing in the codebase reads it anymore. Re-deriving it as a
--   generated/cached column would just reintroduce a second source of truth
--   this whole migration exists to eliminate.
--
--   PREREQUISITE — do not apply until:
--     1. The application code that stopped reading/writing these 5 columns
--        is deployed. Done in the same session as this migration:
--        server/utils/service-order-item-commissions.ts,
--        service-order-commissions.ts, sales-item-commissions.ts (legacy
--        recompute path intentionally left as a graceful no-op fallback for
--        pre-cutover orders, see its own header comment),
--        app/utils/service-orders.ts, server/api/service-orders/index.post.ts,
--        server/api/employees/index.post.ts + [id].put.ts,
--        server/utils/employee-report.ts, employee-commission-report.ts,
--        server/api/reports/sales-items.get.ts,
--        server/api/reports/commissions/[id].get.ts, plus the frontend
--        (app/pages/app/settings/employees/*, service-orders components,
--        app/types/service-orders.ts). Applying this migration before that
--        code is live will break every one of those endpoints with a
--        Postgres "column does not exist" error.
--     2. Step 7's backfill (20240101000091) has been applied and its
--        diagnostic query re-checked — see the safety guard below, which
--        refuses to run while any employee with has_commission = true still
--        has no active assignment in the new model. If it raises, resolve
--        those employees first (assign them a plan in Financeiro >
--        Comissões, or confirm their legacy config was never meaningful)
--        rather than forcing the drop.
--
--   IRREVERSIBLE: DROP COLUMN discards the data outright — this is not a
--   soft-delete. Take a backup/snapshot before applying if there is any
--   doubt about the guard below being sufficient.
-- =============================================================================

DO $$
DECLARE
  unmigrated_count integer;
BEGIN
  SELECT count(*) INTO unmigrated_count
  FROM public.employees e
  WHERE e.has_commission = true
    AND e.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.employee_commission_plan_assignments a
      WHERE a.employee_id = e.id AND a.active = true AND a.deleted_at IS NULL
    );

  IF unmigrated_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop legacy commission columns: % employee(s) still have has_commission = true with no active plan assignment in the new model. Resolve them first (see the diagnostic query at the bottom of 20240101000091_backfill_legacy_employee_commissions.sql) before re-running this migration.',
      unmigrated_count;
  END IF;
END $$;

ALTER TABLE public.employees
  DROP COLUMN has_commission,
  DROP COLUMN commission_type,
  DROP COLUMN commission_amount,
  DROP COLUMN commission_base,
  DROP COLUMN commission_categories;
