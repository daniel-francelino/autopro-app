-- =============================================================================
-- Migration: 20240101000078_create_bonuses
-- Description: Creates the goal-based employee bonus feature — a bonus is a
--              standalone entity (not tied to a single employee record),
--              assignable to one or more employees, with an append-only
--              history of value versions and a log of every "generate"
--              action per employee/month. Deliberately independent from the
--              per-item/category commission engine (server/utils/
--              service-order-commissions.ts and friends) — a bonus is
--              evaluated as a simple monthly revenue/profit sum, not a
--              per-item calculation. See docs/employee-bonus-feature-design.md
--              for the full design rationale.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE: bonuses
-- The bonus identity (name/description/active). Deliberately does NOT carry
-- goal_amount/bonus_amount/commission_base — those are versioned in
-- bonus_value_versions below, because they're exactly what changes over time.
-- -----------------------------------------------------------------------------
CREATE TABLE public.bonuses (
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

  CONSTRAINT bonuses_pkey PRIMARY KEY (id),

  CONSTRAINT bonuses_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations (id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.bonuses IS
  'A goal-based employee bonus: identity only. Values are versioned in bonus_value_versions, assignments in bonus_employee_assignments.';

-- -----------------------------------------------------------------------------
-- TABLE: bonus_value_versions
-- Append-only history of a bonus's (base, goal, amount). Editing a bonus's
-- value NEVER updates a row here — it always inserts a new one. The history
-- requested by the client is, literally, "every row in this table" — no
-- separate audit log needed. No updated_at/deleted_at on purpose: rows are
-- immutable historical facts, not editable records.
-- -----------------------------------------------------------------------------
CREATE TABLE public.bonus_value_versions (
  id               uuid           NOT NULL DEFAULT gen_random_uuid(),
  bonus_id         uuid           NOT NULL,

  commission_base  varchar(10)    NOT NULL,  -- 'revenue' | 'profit'
  goal_amount      numeric(15,2)  NOT NULL,  -- sales target to hit
  bonus_amount     numeric(15,2)  NOT NULL,  -- amount paid if the goal is met

  -- The month (always day 1) from which this version is the effective one.
  -- "Effective for month X" = the version with the greatest effective_from
  -- <= X, not necessarily the most recently created row — this lets an edit
  -- be scheduled for a future month without touching the current month's
  -- live progress calculation.
  effective_from   date           NOT NULL,

  created_at       timestamptz    NOT NULL DEFAULT now(),
  created_by       varchar(200),

  CONSTRAINT bonus_value_versions_pkey PRIMARY KEY (id),

  CONSTRAINT bonus_value_versions_bonus_fk
    FOREIGN KEY (bonus_id)
    REFERENCES public.bonuses (id)
    ON DELETE CASCADE,

  CONSTRAINT bonus_value_versions_commission_base_check
    CHECK (commission_base IN ('revenue', 'profit')),

  CONSTRAINT bonus_value_versions_bonus_effective_from_unique
    UNIQUE (bonus_id, effective_from)
);

COMMENT ON TABLE public.bonus_value_versions IS
  'Append-only value history for a bonus. The version effective for a given month is the one with the greatest effective_from <= that month.';
COMMENT ON COLUMN public.bonus_value_versions.effective_from IS
  'Month (day 1) from which this version applies. Chain is open-ended: a version is valid until superseded by the next version''s effective_from.';

-- -----------------------------------------------------------------------------
-- TABLE: bonus_employee_assignments
-- N:N — which employees a bonus applies to. A bonus can have many employees;
-- an employee can be assigned to many bonuses at once.
-- -----------------------------------------------------------------------------
CREATE TABLE public.bonus_employee_assignments (
  id           uuid         NOT NULL DEFAULT gen_random_uuid(),
  bonus_id     uuid         NOT NULL,
  employee_id  uuid         NOT NULL,

  active       boolean      NOT NULL DEFAULT true,

  created_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   varchar(200),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  updated_by   varchar(200),
  deleted_at   timestamptz,
  deleted_by   varchar(200),

  CONSTRAINT bonus_employee_assignments_pkey PRIMARY KEY (id),

  CONSTRAINT bonus_employee_assignments_bonus_fk
    FOREIGN KEY (bonus_id)
    REFERENCES public.bonuses (id)
    ON DELETE CASCADE,

  CONSTRAINT bonus_employee_assignments_employee_fk
    FOREIGN KEY (employee_id)
    REFERENCES public.employees (id)
    ON DELETE CASCADE,

  CONSTRAINT bonus_employee_assignments_bonus_employee_unique
    UNIQUE (bonus_id, employee_id)
);

COMMENT ON TABLE public.bonus_employee_assignments IS
  'Which employees a bonus is assigned to. active=false means "unassigned but kept for history" without losing past bonus_generations rows.';

-- -----------------------------------------------------------------------------
-- TABLE: bonus_generations
-- One row per "generate" action per (bonus, employee, month). Does three
-- jobs at once: (1) duplicate guard via the unique constraint below — bonus
-- has no "amount already received" concept to recompute a delta against like
-- commissions do, so it needs its own explicit lock; (2) frozen snapshot for
-- history, so a later value-version change or backfilled order doesn't alter
-- what already happened; (3) source of the "X/Y" progress display for
-- already-processed months (the current, not-yet-generated month is instead
-- computed live). financial_record_id is NULL when the goal wasn't met and
-- nothing was released — achieved_amount/goal_amount are still recorded, so
-- the reason a month was skipped is always visible without extra columns.
-- No updated_at/deleted_at: rows are an immutable log, never edited.
-- -----------------------------------------------------------------------------
CREATE TABLE public.bonus_generations (
  id                    uuid           NOT NULL DEFAULT gen_random_uuid(),
  bonus_id              uuid           NOT NULL,
  employee_id           uuid           NOT NULL,

  reference_month       date           NOT NULL,  -- always day 1 of the generated month

  -- Snapshot of the bonus_value_versions row used for this generation.
  commission_base       varchar(10)    NOT NULL,
  goal_amount           numeric(15,2)  NOT NULL,
  bonus_amount          numeric(15,2)  NOT NULL,

  achieved_amount       numeric(15,2)  NOT NULL,  -- what the employee actually sold that month
  goal_met              boolean        NOT NULL,

  financial_record_id   uuid,  -- NULL if goal wasn't met and nothing was released

  created_at            timestamptz    NOT NULL DEFAULT now(),
  created_by            varchar(200),

  CONSTRAINT bonus_generations_pkey PRIMARY KEY (id),

  CONSTRAINT bonus_generations_bonus_fk
    FOREIGN KEY (bonus_id)
    REFERENCES public.bonuses (id)
    ON DELETE CASCADE,

  CONSTRAINT bonus_generations_employee_fk
    FOREIGN KEY (employee_id)
    REFERENCES public.employees (id)
    ON DELETE CASCADE,

  CONSTRAINT bonus_generations_financial_record_fk
    FOREIGN KEY (financial_record_id)
    REFERENCES public.employee_financial_records (id)
    ON DELETE SET NULL,

  CONSTRAINT bonus_generations_commission_base_check
    CHECK (commission_base IN ('revenue', 'profit')),

  CONSTRAINT bonus_generations_bonus_employee_month_unique
    UNIQUE (bonus_id, employee_id, reference_month)
);

COMMENT ON TABLE public.bonus_generations IS
  'Immutable log of every bonus generation attempt per (bonus, employee, month) — duplicate guard, frozen snapshot, and progress source all in one.';
COMMENT ON COLUMN public.bonus_generations.financial_record_id IS
  'employee_financial_records row created when the goal was met (record_type=bonus). NULL when the goal was not met and nothing was released.';

-- -----------------------------------------------------------------------------
-- INDEXES
-- -----------------------------------------------------------------------------
CREATE INDEX idx_bonuses_organization_id
  ON public.bonuses (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_bonus_value_versions_bonus_id
  ON public.bonus_value_versions (bonus_id);

CREATE INDEX idx_bonus_employee_assignments_bonus_id
  ON public.bonus_employee_assignments (bonus_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_bonus_employee_assignments_employee_id
  ON public.bonus_employee_assignments (employee_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_bonus_generations_bonus_id
  ON public.bonus_generations (bonus_id);

CREATE INDEX idx_bonus_generations_employee_month
  ON public.bonus_generations (employee_id, reference_month);

-- -----------------------------------------------------------------------------
-- AUTO-UPDATE TRIGGERS: updated_at
-- (only on tables that carry updated_at — value versions and generations are
-- append-only logs, they don't get one)
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_bonuses_updated_at
  BEFORE UPDATE ON public.bonuses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_bonus_employee_assignments_updated_at
  BEFORE UPDATE ON public.bonus_employee_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.bonuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bonuses_select_same_org"
  ON public.bonuses
  FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());

CREATE POLICY "bonuses_insert_same_org"
  ON public.bonuses
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_organization_id());

CREATE POLICY "bonuses_update_same_org"
  ON public.bonuses
  FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_organization_id())
  WITH CHECK (organization_id = public.current_user_organization_id());

CREATE POLICY "bonuses_delete_same_org"
  ON public.bonuses
  FOR DELETE TO authenticated
  USING (organization_id = public.current_user_organization_id());

-- bonus_value_versions, bonus_employee_assignments and bonus_generations have
-- no organization_id of their own — tenant scoping is derived through
-- bonuses.organization_id via an EXISTS subquery (same pattern used by
-- role_actions -> roles).

ALTER TABLE public.bonus_value_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bonus_value_versions_select_same_org"
  ON public.bonus_value_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bonuses b
      WHERE b.id = bonus_id
        AND b.organization_id = public.current_user_organization_id()
    )
  );

CREATE POLICY "bonus_value_versions_insert_same_org"
  ON public.bonus_value_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bonuses b
      WHERE b.id = bonus_id
        AND b.organization_id = public.current_user_organization_id()
    )
  );

ALTER TABLE public.bonus_employee_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bonus_employee_assignments_select_same_org"
  ON public.bonus_employee_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bonuses b
      WHERE b.id = bonus_id
        AND b.organization_id = public.current_user_organization_id()
    )
  );

CREATE POLICY "bonus_employee_assignments_insert_same_org"
  ON public.bonus_employee_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bonuses b
      WHERE b.id = bonus_id
        AND b.organization_id = public.current_user_organization_id()
    )
  );

CREATE POLICY "bonus_employee_assignments_update_same_org"
  ON public.bonus_employee_assignments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bonuses b
      WHERE b.id = bonus_id
        AND b.organization_id = public.current_user_organization_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bonuses b
      WHERE b.id = bonus_id
        AND b.organization_id = public.current_user_organization_id()
    )
  );

CREATE POLICY "bonus_employee_assignments_delete_same_org"
  ON public.bonus_employee_assignments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bonuses b
      WHERE b.id = bonus_id
        AND b.organization_id = public.current_user_organization_id()
    )
  );

ALTER TABLE public.bonus_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bonus_generations_select_same_org"
  ON public.bonus_generations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bonuses b
      WHERE b.id = bonus_id
        AND b.organization_id = public.current_user_organization_id()
    )
  );

CREATE POLICY "bonus_generations_insert_same_org"
  ON public.bonus_generations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bonuses b
      WHERE b.id = bonus_id
        AND b.organization_id = public.current_user_organization_id()
    )
  );

-- -----------------------------------------------------------------------------
-- employee_financial_records: traceability column back to the bonus that
-- produced a record_type='bonus' row (nullable — unrelated for every other
-- record_type).
-- -----------------------------------------------------------------------------
ALTER TABLE public.employee_financial_records
  ADD COLUMN IF NOT EXISTS bonus_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employee_financial_records_bonus_fk'
  ) THEN
    ALTER TABLE public.employee_financial_records
      ADD CONSTRAINT employee_financial_records_bonus_fk
      FOREIGN KEY (bonus_id)
      REFERENCES public.bonuses (id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.employee_financial_records.bonus_id IS
  'FK to bonuses.id when record_type=bonus — traces a generated payout back to the bonus that produced it.';
