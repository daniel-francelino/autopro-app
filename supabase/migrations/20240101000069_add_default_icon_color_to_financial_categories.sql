-- =============================================================================
-- Migration: 20240101000069_add_default_icon_color_to_financial_categories
-- Description: Phase 0 of the financial categories FK redesign (see
--              docs/financial-categories-crud.md). Adds `is_default` so the
--              previously hardcoded default category list can become real,
--              non-editable rows, plus `icon`/`color` so every category can
--              be displayed consistently across screens. Widens the
--              uniqueness constraint to include `type`, because the default
--              set has 'Outros' once per type (income and expense) for the
--              same organization — the old (organization_id, name) constraint
--              would reject that pair.
-- =============================================================================

ALTER TABLE public.financial_categories
    ADD COLUMN IF NOT EXISTS is_default boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS icon       varchar(50)  NOT NULL DEFAULT 'i-lucide-folder-open',
    ADD COLUMN IF NOT EXISTS color      varchar(20)  NOT NULL DEFAULT 'neutral';

ALTER TABLE public.financial_categories
    DROP CONSTRAINT IF EXISTS financial_categories_org_name_uq;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'financial_categories_org_name_type_uq'
    ) THEN
        ALTER TABLE public.financial_categories
            ADD CONSTRAINT financial_categories_org_name_type_uq
            UNIQUE (organization_id, name, type);
    END IF;
END $$;

COMMENT ON COLUMN public.financial_categories.is_default IS
    'true for the 9 system default rows seeded per organization (8 names — Outros exists once per type, income and expense). These cannot be edited or removed by the user.';
COMMENT ON COLUMN public.financial_categories.icon IS
    'Lucide icon name (e.g. i-lucide-wrench), chosen from a curated list in the UI — not a free-text icon search.';
COMMENT ON COLUMN public.financial_categories.color IS
    'Nuxt UI semantic color name (neutral | primary | secondary | success | info | warning | error) — not a raw hex value, so it stays theme-aware.';
