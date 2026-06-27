-- =============================================================================
-- Migration: 20240101000071_change_financial_categories_color_to_hex
-- Description: Follow-up to 20240101000069. The product decision changed
--              after that migration had already run in some environments:
--              `financial_categories.color` stores a free hex value picked
--              via a color picker, not a closed set of Nuxt UI semantic
--              color names. This migration:
--                1. Changes the column default from 'neutral' to a hex gray.
--                2. Fixes any row already inserted with the old semantic
--                   names (is_default rows get their correct per-category
--                   hex; anything else non-hex falls back to neutral gray).
--              See docs/financial-categories-crud.md, section 3.5.
-- =============================================================================

ALTER TABLE public.financial_categories
    ALTER COLUMN color SET DEFAULT '#64748b';

-- Default rows: map each (name, type) to the same hex chosen in
-- server/utils/financial-category-defaults.ts, but only touch rows that
-- still hold a non-hex value (idempotent — re-running this is harmless).
UPDATE public.financial_categories
SET color = CASE
    WHEN name = 'Vendas'       AND type = 'income'  THEN '#22c55e'
    WHEN name = 'Serviços'     AND type = 'income'  THEN '#3b82f6'
    WHEN name = 'Outros'       AND type = 'income'  THEN '#64748b'
    WHEN name = 'Aluguel'      AND type = 'expense' THEN '#8b5cf6'
    WHEN name = 'Salários'     AND type = 'expense' THEN '#f97316'
    WHEN name = 'Fornecedores' AND type = 'expense' THEN '#22c55e'
    WHEN name = 'Impostos'     AND type = 'expense' THEN '#ef4444'
    WHEN name = 'Marketing'    AND type = 'expense' THEN '#ec4899'
    WHEN name = 'Outros'       AND type = 'expense' THEN '#64748b'
    ELSE '#64748b'
END
WHERE is_default = true
  AND color !~ '^#[0-9a-fA-F]{6}$';

-- Any other row (custom categories created before the hex switch, or
-- anything the CASE above didn't match) — fall back to neutral gray rather
-- than guessing; the user can repick the color from the CRUD screen.
UPDATE public.financial_categories
SET color = '#64748b'
WHERE color !~ '^#[0-9a-fA-F]{6}$';
