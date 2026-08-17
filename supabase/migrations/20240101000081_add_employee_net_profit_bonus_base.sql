-- =============================================================================
-- Migration: 20240101000081_add_employee_net_profit_bonus_base
-- Description:
--   Adds bonus calculation bases that use:
--     service order total - parts cost
--     service order total - parts cost - this employee's commission
--
--   This differs from:
--     revenue = service order total
--     profit  = service order total - parts cost
-- =============================================================================

ALTER TABLE public.bonus_value_versions
  ALTER COLUMN commission_base TYPE varchar(30);

ALTER TABLE public.bonus_generations
  ALTER COLUMN commission_base TYPE varchar(30);

ALTER TABLE public.bonus_value_versions
  DROP CONSTRAINT IF EXISTS bonus_value_versions_commission_base_check;

ALTER TABLE public.bonus_value_versions
  ADD CONSTRAINT bonus_value_versions_commission_base_check
  CHECK (commission_base IN ('revenue', 'profit', 'revenue_minus_parts', 'employee_net_profit'));

ALTER TABLE public.bonus_generations
  DROP CONSTRAINT IF EXISTS bonus_generations_commission_base_check;

ALTER TABLE public.bonus_generations
  ADD CONSTRAINT bonus_generations_commission_base_check
  CHECK (commission_base IN ('revenue', 'profit', 'revenue_minus_parts', 'employee_net_profit'));
