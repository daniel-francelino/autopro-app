-- =============================================================================
-- Migration: 20240101000072_backfill_financial_transaction_categories
-- Description: Phase 1 backfill from docs/finance/financial-categories-crud.md,
--              done as SQL instead of calling
--              POST /api/admin/financial-categories-backfill. Verified
--              against a real data export before being finalized.
--
--              Revision: matches category text case/accent-insensitively
--              (lowercase + deaccent) instead of byte-exact. The earlier
--              version of this migration never merged anything
--              automatically — verified against the real export, the
--              org's spelling variants ("vendas"/"Vendas", "PEÇAS"/"peças",
--              "fornecedores"/"Fornecedores", etc.) are all genuinely the
--              same category typed differently by different people/paths,
--              not coincidentally-similar distinct categories. Merging
--              case/accent variants is safe here and avoids a pile of
--              near-duplicate categories the user would have to clean up
--              by hand. Two transient helper functions do the matching;
--              both are dropped at the end of this migration.
--
--              Per organization:
--                1. Seeds the 9 default categories if missing.
--                2. Gives existing custom categories that predate this
--                   feature (still sitting at the column's pristine
--                   icon/color default) a real icon/color via the same
--                   keyword heuristic used for new ones.
--                3. Creates one category per distinct *normalized*
--                   (category text, type) group still in use, reusing an
--                   existing category if one already normalizes to the
--                   same name. The display name is Title Case of
--                   whichever original spelling was most common in that
--                   group.
--                4. Points every matching transaction at the resolved
--                   category_id (case/accent-insensitive match).
--              Idempotent: safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._migration_072_normalize(input text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT translate(lower(btrim(input)), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
$$;

CREATE OR REPLACE FUNCTION public._migration_072_visual_icon(normalized_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN normalized_text ~ '(tax|impost|fiscal)' THEN 'i-lucide-landmark'
        WHEN normalized_text ~ '(salari|folha|employee|funcion|prolabore|pessoal)' THEN 'i-lucide-users'
        WHEN normalized_text ~ '(financi|emprest|parcelamento)' THEN 'i-lucide-banknote-arrow-down'
        WHEN normalized_text ~ '(cartao|credito)' THEN 'i-lucide-credit-card'
        WHEN normalized_text ~ '(fuel|combust|transport|frete|logistic)' THEN 'i-lucide-truck'
        WHEN normalized_text ~ '(rent|alug|building|estrutura|custo fixo)' THEN 'i-lucide-building-2'
        WHEN normalized_text ~ '(market|ads|public|meta|trafeg)' THEN 'i-lucide-megaphone'
        WHEN normalized_text ~ '(energy|water|internet|telefon|utility|luz)' THEN 'i-lucide-zap'
        WHEN normalized_text ~ '(software|system|saas|license|licen)' THEN 'i-lucide-monitor-cog'
        WHEN normalized_text ~ '(part|piece|peca|stock|inventory|suprimento|material|fornecedor|terceirizado)' THEN 'i-lucide-package'
        WHEN normalized_text ~ '(maint|manuten|repair|service|custo variavel)' THEN 'i-lucide-wrench'
        WHEN normalized_text ~ '(fee|tarifa|charge|bank|finance)' THEN 'i-lucide-receipt'
        ELSE 'i-lucide-folder-open'
    END
$$;

CREATE OR REPLACE FUNCTION public._migration_072_visual_color(normalized_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN normalized_text ~ '(tax|impost|fiscal)' THEN '#ef4444'
        WHEN normalized_text ~ '(salari|folha|employee|funcion|prolabore|pessoal)' THEN '#f97316'
        WHEN normalized_text ~ '(financi|emprest|parcelamento)' THEN '#3b82f6'
        WHEN normalized_text ~ '(cartao|credito)' THEN '#f59e0b'
        WHEN normalized_text ~ '(fuel|combust|transport|frete|logistic)' THEN '#06b6d4'
        WHEN normalized_text ~ '(rent|alug|building|estrutura|custo fixo)' THEN '#8b5cf6'
        WHEN normalized_text ~ '(market|ads|public|meta|trafeg)' THEN '#ec4899'
        WHEN normalized_text ~ '(energy|water|internet|telefon|utility|luz)' THEN '#f59e0b'
        WHEN normalized_text ~ '(software|system|saas|license|licen)' THEN '#6366f1'
        WHEN normalized_text ~ '(part|piece|peca|stock|inventory|suprimento|material|fornecedor|terceirizado)' THEN '#22c55e'
        WHEN normalized_text ~ '(maint|manuten|repair|service|custo variavel)' THEN '#06b6d4'
        WHEN normalized_text ~ '(fee|tarifa|charge|bank|finance)' THEN '#64748b'
        ELSE '#64748b'
    END
$$;

-- ── Step 1: seed the 9 default categories for orgs that don't have them ────
INSERT INTO public.financial_categories (organization_id, name, type, icon, color, is_default, created_by)
SELECT o.id, d.name, d.type, d.icon, d.color, true, 'migration-072'
FROM public.organizations o
CROSS JOIN (VALUES
    ('Vendas',       'income',  'i-lucide-shopping-cart',      '#22c55e'),
    ('Serviços',     'income',  'i-lucide-wrench',              '#3b82f6'),
    ('Outros',       'income',  'i-lucide-circle-dollar-sign',  '#64748b'),
    ('Aluguel',      'expense', 'i-lucide-building-2',          '#8b5cf6'),
    ('Salários',     'expense', 'i-lucide-users',                '#f97316'),
    ('Fornecedores', 'expense', 'i-lucide-package',              '#22c55e'),
    ('Impostos',     'expense', 'i-lucide-landmark',             '#ef4444'),
    ('Marketing',    'expense', 'i-lucide-megaphone',            '#ec4899'),
    ('Outros',       'expense', 'i-lucide-folder-open',          '#64748b')
) AS d(name, type, icon, color)
WHERE o.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.financial_categories fc
      WHERE fc.organization_id = o.id AND fc.is_default = true
  );

-- ── Step 2: give existing custom categories a real icon/color, if they're
--    still sitting at the never-touched column default. ──────────────────
UPDATE public.financial_categories fc
SET icon = public._migration_072_visual_icon(public._migration_072_normalize(fc.name)),
    color = public._migration_072_visual_color(public._migration_072_normalize(fc.name)),
    updated_by = 'migration-072'
WHERE fc.is_default = false
  AND fc.type = 'expense'
  AND fc.icon = 'i-lucide-folder-open'
  AND fc.color = '#64748b';

-- ── Step 3: one category per distinct NORMALIZED (org, type, text) group
--    still missing a category_id. Reuses an existing category if its name
--    already normalizes to the same key (catches "vendas" -> "Vendas",
--    "PEÇAS"/"peças" -> the same row, etc.). Otherwise creates one new
--    category named after whichever original spelling was most common in
--    that group, Title Cased. ──────────────────────────────────────────────
WITH pending AS (
    SELECT
        t.organization_id,
        t.type,
        public._migration_072_normalize(t.category) AS norm_key,
        btrim(t.category) AS raw_text,
        count(*) AS occurrences
    FROM public.financial_transactions t
    WHERE t.deleted_at IS NULL
      AND t.category_id IS NULL
      AND t.category IS NOT NULL
      AND btrim(t.category) <> ''
      AND t.type IN ('income', 'expense')
    GROUP BY t.organization_id, t.type, norm_key, raw_text
),
ranked AS (
    SELECT
        organization_id, type, norm_key, raw_text,
        row_number() OVER (
            PARTITION BY organization_id, type, norm_key
            ORDER BY occurrences DESC, raw_text
        ) AS rn
    FROM pending
),
representative AS (
    SELECT organization_id, type, norm_key, raw_text AS display_text
    FROM ranked
    WHERE rn = 1
)
INSERT INTO public.financial_categories (organization_id, name, type, icon, color, is_default, created_by)
SELECT
    r.organization_id,
    initcap(r.display_text),
    r.type,
    CASE WHEN r.type = 'expense' THEN public._migration_072_visual_icon(r.norm_key) ELSE 'i-lucide-circle-dollar-sign' END,
    CASE WHEN r.type = 'expense' THEN public._migration_072_visual_color(r.norm_key) ELSE '#64748b' END,
    false,
    'migration-072'
FROM representative r
WHERE NOT EXISTS (
    SELECT 1 FROM public.financial_categories fc
    WHERE fc.organization_id = r.organization_id
      AND fc.type = r.type
      AND fc.deleted_at IS NULL
      AND public._migration_072_normalize(fc.name) = r.norm_key
);

-- ── Step 4: point every matching transaction at the resolved category_id.
--    Matches case/accent-insensitively; if more than one category somehow
--    normalizes to the same key for an org+type (shouldn't happen after
--    step 3, but defensive), prefers the default, then the oldest. ────────
WITH matches AS (
    SELECT
        t.id AS transaction_id,
        fc.id AS category_id,
        row_number() OVER (
            PARTITION BY t.id
            ORDER BY fc.is_default DESC, fc.created_at ASC
        ) AS rn
    FROM public.financial_transactions t
    JOIN public.financial_categories fc
        ON fc.organization_id = t.organization_id
       AND fc.type = t.type
       AND fc.deleted_at IS NULL
       AND public._migration_072_normalize(fc.name) = public._migration_072_normalize(t.category)
    WHERE t.deleted_at IS NULL
      AND t.category_id IS NULL
      AND t.category IS NOT NULL
      AND btrim(t.category) <> ''
      AND t.type IN ('income', 'expense')
)
UPDATE public.financial_transactions t
SET category_id = m.category_id
FROM matches m
WHERE t.id = m.transaction_id
  AND m.rn = 1;

DROP FUNCTION public._migration_072_normalize(text);
DROP FUNCTION public._migration_072_visual_icon(text);
DROP FUNCTION public._migration_072_visual_color(text);

-- ── Diagnostic (not executed): rows still missing category_id after this
--    migration need manual review — blank category text or an unrecognized
--    type. Run by hand if Phase 5's "confirm zero NULLs" check fails:
--
--    SELECT id, organization_id, category, type
--    FROM public.financial_transactions
--    WHERE deleted_at IS NULL AND category_id IS NULL;
