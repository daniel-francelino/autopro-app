-- =============================================================================
-- Migration: 20240101000091_backfill_legacy_employee_commissions
-- Description: Step 7 of docs/finance/commissions-configuration-architecture.md
--   — data-only backfill, no schema changes. Translates every employee's
--   legacy commission config (employees.has_commission/commission_type/
--   commission_amount/commission_base/commission_categories) into the new
--   standalone model (employee_commission_plans + one initial rule_version +
--   one rule + rule_categories + a plan assignment), so the new engine
--   (server/utils/employee-commission-plans.ts, Step 6) has real data to
--   evaluate. The 4 legacy calculation engines are NOT touched — that cutover
--   is Steps 8-10, still separate and later.
--
--   Grouping: employees within the same organization whose legacy config is
--   IDENTICAL (same commission_type, commission_amount, commission_base, and
--   set of commission_categories) share ONE plan — "agrupar em planos
--   compartilhados quando configurações forem idênticas". Everyone else gets
--   their own single-employee plan.
--
--   Translation rules:
--     - commission_categories empty/null (legacy "applies to every category")
--       becomes a single is_default=true (catch-all) rule with no category
--       rows — matches getApplicableCommissionRule()'s fallback semantics.
--     - commission_categories non-empty becomes ONE non-default rule covering
--       exactly those categories (one rule per legacy config, not one rule
--       per category — the legacy model only ever had a single rate applying
--       to an allowlist of categories).
--     - commission_base is only ever copied for commission_type='percentage'
--       (forced NULL for 'fixed_amount'), matching the
--       employee_commission_rules_base_matches_type_check constraint added
--       by 20240101000088.
--     - A commission_categories id that no longer resolves to a live,
--       non-deleted product_categories row in the same org (stale/dangling
--       reference) is silently dropped from the rule instead of failing the
--       migration — rule_categories.category_id has ON DELETE RESTRICT, and
--       re-attaching a soft-deleted category to a brand-new rule would be
--       wrong anyway.
--     - effective_from is pinned to 2000-01-01 — an "always effective"
--       sentinel, not today's date — precisely so resolveEffectiveVersion()
--       picks this backfilled version for ANY reference date, including past
--       service orders. That's what lets this step's "comparação entre
--       legado e novo motor retorna os mesmos valores para casos conhecidos"
--       hold for historical data, not just from-now-on.
--
--   Skipped on purpose (left for manual review, see the diagnostic query at
--   the bottom of this file):
--     - has_commission=true employees with a NULL/invalid commission_type,
--       a NULL commission_amount, or commission_type='percentage' with a
--       NULL commission_base — nothing well-formed to translate.
--     - Employees that already have an active commission plan assignment
--       (e.g. an org that started configuring Financeiro > Comissões by hand
--       before this backfill ran) — never overwrites or duplicates existing
--       new-model configuration. This also makes the migration idempotent:
--       safe to re-run, already-migrated employees are skipped the second
--       time.
--
--   Plan/version/rule ids are generated up front into a temp table so every
--   INSERT below is a plain set-based statement (no per-row procedural loop),
--   consistent with 20240101000072's backfill style.
-- =============================================================================

CREATE TEMP TABLE _commission_backfill_groups ON COMMIT DROP AS
WITH raw_categories AS (
  SELECT e.id AS employee_id, elem AS id_text
  FROM public.employees e,
       LATERAL jsonb_array_elements_text(COALESCE(e.commission_categories, '[]'::jsonb)) AS elem
),
live_categories AS (
  SELECT rc.employee_id, pc.id AS category_id
  FROM raw_categories rc
  JOIN public.employees e ON e.id = rc.employee_id
  JOIN public.product_categories pc
    ON pc.organization_id = e.organization_id
   AND pc.deleted_at IS NULL
   AND rc.id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND pc.id = rc.id_text::uuid
),
eligible_employees AS (
  SELECT
    e.id AS employee_id,
    e.organization_id,
    e.name AS employee_name,
    e.commission_type,
    e.commission_amount,
    CASE WHEN e.commission_type = 'percentage' THEN e.commission_base ELSE NULL END AS commission_base,
    COALESCE(
      (SELECT array_agg(DISTINCT lc.category_id ORDER BY lc.category_id) FROM live_categories lc WHERE lc.employee_id = e.id),
      ARRAY[]::uuid[]
    ) AS category_ids
  FROM public.employees e
  WHERE e.has_commission = true
    AND e.deleted_at IS NULL
    AND e.commission_amount IS NOT NULL
    AND (
      e.commission_type = 'fixed_amount'
      OR (e.commission_type = 'percentage' AND e.commission_base IS NOT NULL)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.employee_commission_plan_assignments a
      WHERE a.employee_id = e.id AND a.active = true AND a.deleted_at IS NULL
    )
),
grouped AS (
  SELECT
    organization_id,
    commission_type,
    commission_amount,
    commission_base,
    category_ids,
    array_agg(employee_id ORDER BY employee_name) AS employee_ids,
    array_agg(employee_name ORDER BY employee_name) AS employee_names,
    count(*) AS employee_count
  FROM eligible_employees
  GROUP BY organization_id, commission_type, commission_amount, commission_base, category_ids
),
numbered AS (
  SELECT
    gen_random_uuid() AS plan_id,
    gen_random_uuid() AS version_id,
    gen_random_uuid() AS rule_id,
    g.*,
    row_number() OVER (
      PARTITION BY organization_id
      ORDER BY commission_type, commission_amount, commission_base NULLS FIRST, category_ids::text
    ) AS org_seq
  FROM grouped g
)
SELECT
  plan_id,
  version_id,
  rule_id,
  organization_id,
  commission_type,
  commission_amount,
  commission_base,
  category_ids,
  employee_ids,
  employee_names,
  employee_count,
  CASE
    WHEN employee_count = 1 THEN 'Comissão — ' || employee_names[1] || ' (#' || org_seq || ')'
    ELSE 'Comissão compartilhada — '
      || CASE
           WHEN commission_type = 'percentage' THEN commission_amount::text || '% (' || commission_base || ')'
           ELSE 'R$ ' || commission_amount::text || ' por unidade'
         END
      || ' (#' || org_seq || ')'
  END AS plan_name,
  'Criado automaticamente pela migração de backfill da configuração legada (Step 7 de docs/finance/commissions-configuration-architecture.md). Funcionário(s) originalmente configurado(s): '
    || array_to_string(employee_names, ', ') || '.' AS plan_description
FROM numbered;

-- 1. Plan identity.
INSERT INTO public.employee_commission_plans (id, organization_id, name, description, active, created_by, updated_by)
SELECT plan_id, organization_id, plan_name, plan_description, true, 'migration', 'migration'
FROM _commission_backfill_groups;

-- 2. First (and only) rule version, pinned to an "always effective" date.
INSERT INTO public.employee_commission_rule_versions (id, plan_id, effective_from, notes, created_by)
SELECT version_id, plan_id, DATE '2025-01-01', 'Versão inicial gerada pelo backfill da configuração legada (Step 7).', 'migration'
FROM _commission_backfill_groups;

-- 3. The single rule that carries the legacy type/amount/base. is_default
--    when the legacy config had no category allowlist (applied to everything).
INSERT INTO public.employee_commission_rules (id, version_id, name, commission_type, commission_amount, commission_base, is_default, sort_order)
SELECT
  rule_id,
  version_id,
  NULL,
  commission_type,
  commission_amount,
  commission_base,
  (COALESCE(array_length(category_ids, 1), 0) = 0),
  0
FROM _commission_backfill_groups;

-- 4. Category coverage, only for groups that had a non-empty allowlist.
INSERT INTO public.employee_commission_rule_categories (rule_id, category_id)
SELECT rule_id, unnest(category_ids)
FROM _commission_backfill_groups
WHERE COALESCE(array_length(category_ids, 1), 0) > 0;

-- 5. Assign the plan to every employee it was built from.
INSERT INTO public.employee_commission_plan_assignments (plan_id, employee_id, active, created_by)
SELECT plan_id, unnest(employee_ids), true, 'migration'
FROM _commission_backfill_groups;

-- -----------------------------------------------------------------------------
-- Diagnostic (not executed): has_commission=true employees left unmigrated —
-- either already had a plan assigned, or their legacy config is incomplete
-- (NULL commission_type/amount, or a 'percentage' row with no
-- commission_base). Run by hand after applying this migration:
--
--   SELECT e.id, e.name, e.organization_id, e.commission_type,
--          e.commission_amount, e.commission_base
--   FROM public.employees e
--   WHERE e.has_commission = true
--     AND e.deleted_at IS NULL
--     AND NOT EXISTS (
--       SELECT 1 FROM public.employee_commission_plan_assignments a
--       WHERE a.employee_id = e.id AND a.active = true AND a.deleted_at IS NULL
--     );
-- -----------------------------------------------------------------------------
