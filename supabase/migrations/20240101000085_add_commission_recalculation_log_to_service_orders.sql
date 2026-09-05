-- =============================================================================
-- Migration: 20240101000085_add_commission_recalculation_log_to_service_orders
-- Description: Audit trail for the manual "Recalcular" action on the
--              Responsáveis e comissão card (per-employee commission
--              recalculation — server/utils/service-order-commissions.ts,
--              releaseServiceOrderCommissions() with an employeeId). Each
--              successful recalculation appends one entry recording who
--              triggered it, when, why (required reason typed into the
--              confirm modal), and the amount before/after — so staff can
--              see why a commission value changed after an employee's
--              configuration was edited.
-- =============================================================================

ALTER TABLE public.service_orders
  ADD COLUMN commission_recalculation_log jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.service_orders.commission_recalculation_log IS
  'Append-only audit trail of manual per-employee commission recalculations. '
  'Array of objects: { employee_id, employee_name, reason, previous_amount, '
  'new_amount, recalculated_by_email, recalculated_by_name, recalculated_at }.';
