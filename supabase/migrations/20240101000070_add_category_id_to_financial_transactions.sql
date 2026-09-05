-- =============================================================================
-- Migration: 20240101000070_add_category_id_to_financial_transactions
-- Description: Phase 0 of the financial categories FK redesign (see
--              docs/finance/financial-categories-crud.md). Adds the FK column that
--              will replace the free-text `category` column once the
--              backfill and the application cutover are complete.
--              `category` (text) is kept and still written by the app during
--              the transition — see the doc for the phased plan to retire it.
-- =============================================================================

ALTER TABLE public.financial_transactions
    ADD COLUMN IF NOT EXISTS category_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'financial_transactions_category_fk'
    ) THEN
        ALTER TABLE public.financial_transactions
            ADD CONSTRAINT financial_transactions_category_fk
            FOREIGN KEY (category_id)
            REFERENCES public.financial_categories (id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_financial_transactions_category_id
    ON public.financial_transactions (category_id)
    WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.financial_transactions.category_id IS
    'References financial_categories(id). Nullable during the migration window (see docs/finance/financial-categories-crud.md) — becomes NOT NULL once the legacy `category` text column is retired.';
