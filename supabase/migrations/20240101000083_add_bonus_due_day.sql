-- =============================================================================
-- Migration: 20240101000083_add_bonus_due_day
-- Description:
--   Lets a bonus configure which day of the month it becomes due when
--   generated, instead of always defaulting to the last day of the month.
--   NULL preserves the original behavior (last day of month) — this is an
--   opt-in override, not a required field.
--
--   A day that doesn't exist in a given month (e.g. due_day=31 in a
--   30-day month) is clamped to that month's last day at generation time
--   (see resolveDueDate() in server/utils/bonuses.ts) — no DB-level
--   handling needed here since due_day is just an integer, not a date.
-- =============================================================================

ALTER TABLE public.bonuses
  ADD COLUMN IF NOT EXISTS due_day smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bonuses_due_day_check'
  ) THEN
    ALTER TABLE public.bonuses
      ADD CONSTRAINT bonuses_due_day_check
      CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31));
  END IF;
END $$;

COMMENT ON COLUMN public.bonuses.due_day IS
  'Day of month (1-31) a generated bonus becomes due. NULL = last day of the reference month (default, original behavior).';
