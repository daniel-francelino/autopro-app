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
--                  finance/commissions-manual-override.md) — picks an
--                  existing commission configuration (a plan, not a typed-in
--                  rate) and patches it over the employee's standard plan
--                  for this OS only: only the categories the chosen plan
--                  covers are affected, e.g. "use plan X's 15% on cabeçote
--                  because they stayed late on this job" while motor stays
--                  at the employee's usual 20%.
--              Each entry records who triggered it, when, why (required
--              reason), and the amount before/after. For override events it
--              also carries the applied plan's id and a name snapshot (stays
--              correct even if the plan is later renamed/deactivated) — see
--              docs/finance/commissions-manual-override.md §4 for the full
--              shape and how "current override state" is derived from this
--              log rather than stored separately.
-- =============================================================================

ALTER TABLE public.service_orders
  ADD COLUMN commission_manual_adjustments_log jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.service_orders.commission_manual_adjustments_log IS
  'Append-only audit trail of manual per-employee commission adjustments on '
  'this order: plain recalculations and manual plan overrides (apply/'
  'remove). Array of objects: { employee_id, employee_name, reason, '
  'previous_amount, new_amount, recalculated_by_email, recalculated_by_name, '
  'recalculated_at, override_action?, override_commission_plan_id?, '
  'override_commission_plan_name? }. The active override for an employee '
  '(if any) is derived by scanning for their last entry with override_action '
  'set, not stored as separate state; its plan is PATCHED over the '
  'employee''s standard rules (only the categories it covers), not a full '
  'replacement — see docs/finance/commissions-manual-override.md.';
