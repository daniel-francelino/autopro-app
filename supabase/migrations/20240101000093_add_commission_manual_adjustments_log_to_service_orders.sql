-- =============================================================================
-- Migration: 20240101000093_add_commission_manual_adjustments_log_to_service_orders
-- Description: Audit trail for manual commission adjustments on a service
--              order, made from the "Responsáveis e comissão" card
--              (server/utils/service-order-commissions.ts,
--              releaseServiceOrderCommissions() with an employeeId). Covers
--              two kinds of event, appended to the same array:
--                - a plain "Recalcular" (recompute an employee's entitlement
--                  from their standard plan, e.g. after their configuration
--                  changed);
--                - applying, editing or removing a one-off manual commission
--                  override for one employee on this specific order (docs/
--                  finance/commissions-manual-override.md) — a different
--                  rate/value than their standard plan, scoped to this OS
--                  only, e.g. "15% instead of the usual 9% because they
--                  stayed late on this job".
--              Each entry records who triggered it, when, why (required
--              reason), and the amount before/after. For override events it
--              also carries the applied type/amount/base — see
--              docs/finance/commissions-manual-override.md §4 for the full
--              shape and how "current override state" is derived from this
--              log rather than stored separately.
-- =============================================================================

ALTER TABLE public.service_orders
  ADD COLUMN commission_manual_adjustments_log jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.service_orders.commission_manual_adjustments_log IS
  'Append-only audit trail of manual per-employee commission adjustments on '
  'this order: plain recalculations and manual rate overrides (apply/edit/'
  'remove). Array of objects: { employee_id, employee_name, reason, '
  'previous_amount, new_amount, recalculated_by_email, recalculated_by_name, '
  'recalculated_at, override_action?, override_commission_type?, '
  'override_commission_amount?, override_commission_base? }. The active '
  'override for an employee (if any) is derived by scanning for their last '
  'entry with override_action set, not stored as separate state — see '
  'docs/finance/commissions-manual-override.md.';
