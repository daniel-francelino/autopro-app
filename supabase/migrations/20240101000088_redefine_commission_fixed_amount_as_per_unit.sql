-- =============================================================================
-- Migration: 20240101000088_redefine_commission_fixed_amount_as_per_unit
-- Description:
--   Follow-up to 20240101000085_create_employee_commission_plans. The
--   original schema required commission_base on every rule, including
--   'fixed_amount' ones. Reviewing it, "valor fixo" (fixed_amount) had no
--   well-defined unit at the category/plan level it now lives at — per item?
--   per order? per month (which would just duplicate the Bônus feature)?
--   The legacy engines never agreed on this either (see
--   docs/employee-multiple-commission-rules-analysis.md §2.3: one engine
--   prorates a fixed value across a order's eligible items, another treats
--   it as one flat value per order).
--
--   Decision: 'fixed_amount' now means precisely "flat R$ per unit matched
--   in the category" (commission_amount * quantity, independent of the
--   item's price — e.g. "R$20 per tire sold"). commission_base stops
--   applying to it entirely (a per-unit flat value has no revenue/profit
--   base), so the column becomes nullable: required for 'percentage',
--   NULL for 'fixed_amount', enforced by a new CHECK.
--
--   No data migration needed — this table has no real rows yet (the Financeiro
--   > Comissões feature hasn't shipped to users), so there's nothing to
--   backfill.
-- =============================================================================

ALTER TABLE public.employee_commission_rules
  ALTER COLUMN commission_base DROP NOT NULL;

ALTER TABLE public.employee_commission_rules
  DROP CONSTRAINT employee_commission_rules_commission_base_check;

ALTER TABLE public.employee_commission_rules
  ADD CONSTRAINT employee_commission_rules_commission_base_check
  CHECK (commission_base IS NULL OR commission_base IN ('revenue', 'profit'));

ALTER TABLE public.employee_commission_rules
  ADD CONSTRAINT employee_commission_rules_base_matches_type_check
  CHECK (
    (commission_type = 'percentage' AND commission_base IS NOT NULL)
    OR (commission_type = 'fixed_amount' AND commission_base IS NULL)
  );

COMMENT ON COLUMN public.employee_commission_rules.commission_amount IS
  'Percentage rules: rate (%) applied over commission_base. Fixed_amount rules: flat R$ per unit matched (not per order, not prorated) — commission_base is NULL for these.';
COMMENT ON COLUMN public.employee_commission_rules.commission_base IS
  'revenue | profit — required for commission_type=''percentage''. NULL for ''fixed_amount'' (a flat per-unit value has no base).';
