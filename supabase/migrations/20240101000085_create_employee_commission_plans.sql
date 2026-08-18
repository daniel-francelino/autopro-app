-- =============================================================================
-- Migration: 20240101000085_create_employee_commission_plans
-- Description: Step 2 of docs/finance/commissions-configuration-architecture.md
--              — new, standalone commission configuration entity, in the same
--              spirit as the bonus feature (20240101000078_create_bonuses.sql):
--              a "commission plan" is created once in Financeiro > Comissões,
--              can carry several rules (one per product category, plus an
--              optional catch-all default rule), is versioned (editing never
--              overwrites — it appends a new version), and is assigned to one
--              or more employees. Deliberately additive: nothing here is read
--              by the 4 legacy commission engines yet, and the legacy columns
--              on `employees` (has_commission/commission_type/commission_amount
--              /commission_base/commission_categories) are untouched. Only
--              Steps 1-6 of the design doc are in scope for this migration —
--              the legacy cutover (Steps 7-10) is a separate, later effort.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: employee_commission_plans
-- Identity of a commission configuration. Deliberately carries no rate/base —
-- those live in versioned rules below, because they're exactly what changes
-- over time (mirrors bonuses/bonus_value_versions).
-- -----------------------------------------------------------------------------
CREATE TABLE public.employee_commission_plans (
  id               uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid          NOT NULL,

  name             varchar(255)  NOT NULL,
  description      text,
  active           boolean       NOT NULL DEFAULT true,

  created_at       timestamptz   NOT NULL DEFAULT now(),
  created_by       varchar(200),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  updated_by       varchar(200),
  deleted_at       timestamptz,
  deleted_by       varchar(200),

  CONSTRAINT employee_commission_plans_pkey PRIMARY KEY (id),

  CONSTRAINT employee_commission_plans_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations (id)
    ON DELETE CASCADE,

  CONSTRAINT employee_commission_plans_organization_name_uq
    UNIQUE (organization_id, name)
);

COMMENT ON TABLE public.employee_commission_plans IS
  'A commission configuration''s identity (name/description/active). Rules are versioned in employee_commission_rule_versions, employees assigned via employee_commission_plan_assignments.';

-- -----------------------------------------------------------------------------
-- TABLE: employee_commission_plan_assignments
-- N:N — which employees a plan applies to. A plan can have many employees; an
-- employee can be assigned to many plans at once (category-conflict across
-- plans assigned to the same employee is validated in the application layer,
-- not by a DB constraint here — see server/utils/employee-commission-plans.ts).
-- -----------------------------------------------------------------------------
CREATE TABLE public.employee_commission_plan_assignments (
  id          uuid         NOT NULL DEFAULT gen_random_uuid(),
  plan_id     uuid         NOT NULL,
  employee_id uuid         NOT NULL,

  active      boolean      NOT NULL DEFAULT true,

  created_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  varchar(200),
  deleted_at  timestamptz,
  deleted_by  varchar(200),

  CONSTRAINT employee_commission_plan_assignments_pkey PRIMARY KEY (id),

  CONSTRAINT employee_commission_plan_assignments_plan_fk
    FOREIGN KEY (plan_id)
    REFERENCES public.employee_commission_plans (id)
    ON DELETE CASCADE,

  CONSTRAINT employee_commission_plan_assignments_employee_fk
    FOREIGN KEY (employee_id)
    REFERENCES public.employees (id)
    ON DELETE CASCADE,

  CONSTRAINT employee_commission_plan_assignments_plan_employee_uq
    UNIQUE (plan_id, employee_id)
);

COMMENT ON TABLE public.employee_commission_plan_assignments IS
  'Which employees a commission plan is assigned to. active=false means "unassigned but kept for history" without losing the trail on already-generated commissions.';

-- -----------------------------------------------------------------------------
-- TABLE: employee_commission_rule_versions
-- Append-only history of a plan's rule set. Editing a plan's rules NEVER
-- updates existing rows — it inserts a new version (and copies its rules).
-- The version effective for a date is the one with the greatest
-- effective_from <= that date, same resolution as bonus_value_versions.
-- -----------------------------------------------------------------------------
CREATE TABLE public.employee_commission_rule_versions (
  id              uuid         NOT NULL DEFAULT gen_random_uuid(),
  plan_id         uuid         NOT NULL,

  effective_from  date         NOT NULL,  -- month (day 1) from which this version applies
  notes           text,

  created_at      timestamptz  NOT NULL DEFAULT now(),
  created_by      varchar(200),

  CONSTRAINT employee_commission_rule_versions_pkey PRIMARY KEY (id),

  CONSTRAINT employee_commission_rule_versions_plan_fk
    FOREIGN KEY (plan_id)
    REFERENCES public.employee_commission_plans (id)
    ON DELETE CASCADE,

  CONSTRAINT employee_commission_rule_versions_plan_effective_from_uq
    UNIQUE (plan_id, effective_from)
);

COMMENT ON TABLE public.employee_commission_rule_versions IS
  'Append-only rule-set history for a plan. The version effective for a given date is the one with the greatest effective_from <= that date.';

-- -----------------------------------------------------------------------------
-- TABLE: employee_commission_rules
-- One rule within a version: a type/amount/base, optionally scoped to one or
-- more product categories via employee_commission_rule_categories below.
-- is_default = true marks the catch-all rule for that version.
-- -----------------------------------------------------------------------------
CREATE TABLE public.employee_commission_rules (
  id                 uuid           NOT NULL DEFAULT gen_random_uuid(),
  version_id         uuid           NOT NULL,

  name               varchar(255),
  commission_type    varchar(20)    NOT NULL,  -- 'percentage' | 'fixed_amount'
  commission_amount  numeric(15,2)  NOT NULL,  -- rate (%) or flat value (R$)
  commission_base    varchar(10)    NOT NULL,  -- 'revenue' | 'profit'
  is_default         boolean        NOT NULL DEFAULT false,
  sort_order         integer        NOT NULL DEFAULT 0,

  created_at         timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT employee_commission_rules_pkey PRIMARY KEY (id),

  CONSTRAINT employee_commission_rules_version_fk
    FOREIGN KEY (version_id)
    REFERENCES public.employee_commission_rule_versions (id)
    ON DELETE CASCADE,

  CONSTRAINT employee_commission_rules_commission_type_check
    CHECK (commission_type IN ('percentage', 'fixed_amount')),

  CONSTRAINT employee_commission_rules_commission_base_check
    CHECK (commission_base IN ('revenue', 'profit'))
);

COMMENT ON TABLE public.employee_commission_rules IS
  'One commission rule within a version. is_default=true is the catch-all, applied to items whose category (or lack of one) isn''t covered by another rule of the same version.';

-- At most one catch-all rule per version.
CREATE UNIQUE INDEX employee_commission_rules_one_default_per_version
  ON public.employee_commission_rules (version_id)
  WHERE is_default;

-- -----------------------------------------------------------------------------
-- TABLE: employee_commission_rule_categories
-- Which product categories a rule covers. "A category can't appear in two
-- rules of the same version" and "a category can't be covered by two plans
-- assigned to the same employee at once" are both validated in the
-- application layer (server/utils/employee-commission-plans.ts) rather than
-- by a DB constraint — the second check in particular spans assignments and
-- can't be expressed as a simple UNIQUE.
-- -----------------------------------------------------------------------------
CREATE TABLE public.employee_commission_rule_categories (
  rule_id      uuid  NOT NULL,
  category_id  uuid  NOT NULL,

  CONSTRAINT employee_commission_rule_categories_pkey PRIMARY KEY (rule_id, category_id),

  CONSTRAINT employee_commission_rule_categories_rule_fk
    FOREIGN KEY (rule_id)
    REFERENCES public.employee_commission_rules (id)
    ON DELETE CASCADE,

  CONSTRAINT employee_commission_rule_categories_category_fk
    FOREIGN KEY (category_id)
    REFERENCES public.product_categories (id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.employee_commission_rule_categories IS
  'Which product categories a commission rule covers. ON DELETE RESTRICT on category_id — a category referenced by a rule can''t be deleted out from under it (see Step 1, Categorias em Produtos).';

-- -----------------------------------------------------------------------------
-- INDEXES
-- -----------------------------------------------------------------------------
CREATE INDEX idx_employee_commission_plans_organization_id
  ON public.employee_commission_plans (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_employee_commission_plan_assignments_plan_id
  ON public.employee_commission_plan_assignments (plan_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_employee_commission_plan_assignments_employee_id
  ON public.employee_commission_plan_assignments (employee_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_employee_commission_rule_versions_plan_id
  ON public.employee_commission_rule_versions (plan_id);

CREATE INDEX idx_employee_commission_rules_version_id
  ON public.employee_commission_rules (version_id);

CREATE INDEX idx_employee_commission_rule_categories_rule_id
  ON public.employee_commission_rule_categories (rule_id);

CREATE INDEX idx_employee_commission_rule_categories_category_id
  ON public.employee_commission_rule_categories (category_id);

-- -----------------------------------------------------------------------------
-- AUTO-UPDATE TRIGGERS: updated_at
-- (rule_versions/rules/rule_categories are append-only logs — no updated_at)
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_employee_commission_plans_updated_at
  BEFORE UPDATE ON public.employee_commission_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.employee_commission_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_commission_plans_select_same_org"
  ON public.employee_commission_plans
  FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());

CREATE POLICY "employee_commission_plans_insert_same_org"
  ON public.employee_commission_plans
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_organization_id());

CREATE POLICY "employee_commission_plans_update_same_org"
  ON public.employee_commission_plans
  FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_organization_id())
  WITH CHECK (organization_id = public.current_user_organization_id());

CREATE POLICY "employee_commission_plans_delete_same_org"
  ON public.employee_commission_plans
  FOR DELETE TO authenticated
  USING (organization_id = public.current_user_organization_id());

-- Every table below has no organization_id of its own — tenant scoping is
-- derived through employee_commission_plans.organization_id via an EXISTS
-- subquery (same pattern used by bonus_value_versions -> bonuses).

ALTER TABLE public.employee_commission_plan_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_commission_plan_assignments_select_same_org"
  ON public.employee_commission_plan_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employee_commission_plans p
      WHERE p.id = plan_id
        AND p.organization_id = public.current_user_organization_id()
    )
  );

CREATE POLICY "employee_commission_plan_assignments_insert_same_org"
  ON public.employee_commission_plan_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employee_commission_plans p
      WHERE p.id = plan_id
        AND p.organization_id = public.current_user_organization_id()
    )
  );

CREATE POLICY "employee_commission_plan_assignments_update_same_org"
  ON public.employee_commission_plan_assignments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employee_commission_plans p
      WHERE p.id = plan_id
        AND p.organization_id = public.current_user_organization_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employee_commission_plans p
      WHERE p.id = plan_id
        AND p.organization_id = public.current_user_organization_id()
    )
  );

CREATE POLICY "employee_commission_plan_assignments_delete_same_org"
  ON public.employee_commission_plan_assignments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employee_commission_plans p
      WHERE p.id = plan_id
        AND p.organization_id = public.current_user_organization_id()
    )
  );

ALTER TABLE public.employee_commission_rule_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_commission_rule_versions_select_same_org"
  ON public.employee_commission_rule_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employee_commission_plans p
      WHERE p.id = plan_id
        AND p.organization_id = public.current_user_organization_id()
    )
  );

CREATE POLICY "employee_commission_rule_versions_insert_same_org"
  ON public.employee_commission_rule_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employee_commission_plans p
      WHERE p.id = plan_id
        AND p.organization_id = public.current_user_organization_id()
    )
  );

ALTER TABLE public.employee_commission_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_commission_rules_select_same_org"
  ON public.employee_commission_rules
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employee_commission_rule_versions v
      JOIN public.employee_commission_plans p ON p.id = v.plan_id
      WHERE v.id = version_id
        AND p.organization_id = public.current_user_organization_id()
    )
  );

CREATE POLICY "employee_commission_rules_insert_same_org"
  ON public.employee_commission_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.employee_commission_rule_versions v
      JOIN public.employee_commission_plans p ON p.id = v.plan_id
      WHERE v.id = version_id
        AND p.organization_id = public.current_user_organization_id()
    )
  );

ALTER TABLE public.employee_commission_rule_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_commission_rule_categories_select_same_org"
  ON public.employee_commission_rule_categories
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employee_commission_rules r
      JOIN public.employee_commission_rule_versions v ON v.id = r.version_id
      JOIN public.employee_commission_plans p ON p.id = v.plan_id
      WHERE r.id = rule_id
        AND p.organization_id = public.current_user_organization_id()
    )
  );

CREATE POLICY "employee_commission_rule_categories_insert_same_org"
  ON public.employee_commission_rule_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.employee_commission_rules r
      JOIN public.employee_commission_rule_versions v ON v.id = r.version_id
      JOIN public.employee_commission_plans p ON p.id = v.plan_id
      WHERE r.id = rule_id
        AND p.organization_id = public.current_user_organization_id()
    )
  );

-- -----------------------------------------------------------------------------
-- employee_financial_records: traceability columns back to the plan/rule that
-- produced a commission (nullable — unrelated for every other record).
-- -----------------------------------------------------------------------------
ALTER TABLE public.employee_financial_records
  ADD COLUMN IF NOT EXISTS commission_plan_id uuid,
  ADD COLUMN IF NOT EXISTS commission_rule_id uuid,
  ADD COLUMN IF NOT EXISTS commission_rule_version_id uuid,
  ADD COLUMN IF NOT EXISTS commission_rule_name varchar(255),
  ADD COLUMN IF NOT EXISTS commission_amount_snapshot numeric(15,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_financial_records_commission_plan_fk'
  ) THEN
    ALTER TABLE public.employee_financial_records
      ADD CONSTRAINT employee_financial_records_commission_plan_fk
      FOREIGN KEY (commission_plan_id)
      REFERENCES public.employee_commission_plans (id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_financial_records_commission_rule_fk'
  ) THEN
    ALTER TABLE public.employee_financial_records
      ADD CONSTRAINT employee_financial_records_commission_rule_fk
      FOREIGN KEY (commission_rule_id)
      REFERENCES public.employee_commission_rules (id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_financial_records_commission_rule_version_fk'
  ) THEN
    ALTER TABLE public.employee_financial_records
      ADD CONSTRAINT employee_financial_records_commission_rule_version_fk
      FOREIGN KEY (commission_rule_version_id)
      REFERENCES public.employee_commission_rule_versions (id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.employee_financial_records.commission_plan_id IS
  'FK to employee_commission_plans.id — traces a generated commission back to the plan that produced it (new model, Step 2+ of docs/finance/commissions-configuration-architecture.md).';
COMMENT ON COLUMN public.employee_financial_records.commission_rule_name IS
  'Snapshot of the rule''s name/label at generation time, kept even if the rule''s version is later superseded.';
COMMENT ON COLUMN public.employee_financial_records.commission_amount_snapshot IS
  'Snapshot of the rule''s commission_amount used for this record, independent of the legacy commission_percentage snapshot column.';
