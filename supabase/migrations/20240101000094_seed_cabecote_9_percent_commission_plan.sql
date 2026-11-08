-- =============================================================================
-- Migration: 20240101000094_seed_cabecote_9_percent_commission_plan
-- Description:
--   Data seed for organization fda7436b-a384-5fd6-9f98-74b1547d0e61: creates a
--   new commission plan "Cabeçote 9%", mirroring the existing "Cabeçote 15%"
--   plan (id bea4670b-3b5a-415f-a97a-bbe2079fa72e) but at 9% instead of 15%,
--   and with no employees assigned — assign via Financeiro > Comissões in the
--   UI when ready. One version (effective_from 2025-01-01), one non-default
--   rule scoped to the "Cabeçote" product category
--   (9582d150-ca34-54ff-95c4-95fc033d5bb6), same shape as
--   20240101000085_create_employee_commission_plans.sql.
--
--   Guarded by a NOT EXISTS check on (organization_id, name), mirroring the
--   partial unique index from 20240101000092, so re-running this migration is
--   safe.
-- =============================================================================

DO $$
DECLARE
  v_org_id      uuid := 'fda7436b-a384-5fd6-9f98-74b1547d0e61';
  v_category_id uuid := '9582d150-ca34-54ff-95c4-95fc033d5bb6';
  v_created_by  varchar(200) := 'danielsoaresf@hotmail.com';
  v_plan_id     uuid;
  v_version_id  uuid;
  v_rule_id     uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.employee_commission_plans
    WHERE organization_id = v_org_id
      AND name = 'Cabeçote 9%'
      AND deleted_at IS NULL
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.employee_commission_plans (organization_id, name, description, active, created_by, updated_by)
  VALUES (v_org_id, 'Cabeçote 9%', NULL, true, v_created_by, v_created_by)
  RETURNING id INTO v_plan_id;

  INSERT INTO public.employee_commission_rule_versions (plan_id, effective_from, notes, created_by)
  VALUES (v_plan_id, '2025-01-01', NULL, v_created_by)
  RETURNING id INTO v_version_id;

  INSERT INTO public.employee_commission_rules (version_id, name, commission_type, commission_amount, commission_base, is_default, sort_order)
  VALUES (v_version_id, NULL, 'percentage', 9, 'profit', false, 0)
  RETURNING id INTO v_rule_id;

  INSERT INTO public.employee_commission_rule_categories (rule_id, category_id)
  VALUES (v_rule_id, v_category_id);

  -- Deliberately no employee_commission_plan_assignments rows here — the
  -- plan is created unassigned, per request.
END $$;
