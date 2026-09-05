# Proposal: Financial Categories Architecture (Table + FK) and CRUD Screen

Full revision of the previous proposal. Core change: category stops being free text repeated in `financial_transactions.category` and becomes a reference (`category_id`) to a real row in `financial_categories` — including the "default" categories, which today aren't database rows at all, just a hardcoded array (and, as shown below, hardcoded in more than one place, with different spellings).

Document split into: (1) what exists today, verified by reading the code — messier than the first version of this documentation recorded; (2) the new architecture; (3) every impacted screen/file; (4) a phased implementation and migration plan.

## 1. Goal

- Model category as its own entity, referenced by id (`financial_transactions.category_id → financial_categories.id`), instead of free text compared via normalization.
- Default categories stop being a code array and become real rows in `financial_categories` (not editable/removable, but they genuinely exist in the table).
- Full CRUD for custom categories (create, edit, remove with usage check) on its own screen, including icon and color selection per category (section 3.5).
- Migrate existing data without losing information — every category string in use today, even the inconsistent ones, must become a referenceable row. The migration merges spelling variants that are only different in case/accent (`"vendas"`/`"Vendas"`) into one category, validated against real data before being decided (section 5) — it does not attempt to merge anything beyond that.
- New organizations are born with the 9 default categories already in place — map exactly where this fits into the current organization-creation flow (section 3.6).

## 2. Verified current state (messier than it looked)

### 2.1 Which code is actually in use

The main screen is `app/pages/app/financial/index.vue`, which uses this API:

| Action | Endpoint | File |
|---|---|---|
| List | `GET /api/financial` | `server/api/financial/index.get.ts` |
| Create | `POST /api/financial` | `server/api/financial/index.post.ts` |
| Detail | `GET /api/financial/:id` | `server/api/financial/[id].get.ts` |
| Edit | `PUT /api/financial/:id` | `server/api/financial/[id].put.ts` |
| Remove | `DELETE /api/financial/:id` | `server/api/financial/[id].delete.ts` |
| Totals (cards) | `GET /api/financial/summary` | `server/api/financial/summary.get.ts` |
| Export | `POST /api/financial/export` | `server/api/financial/export.post.ts` |
| Categories | `GET/POST /api/financial/categories`, `DELETE /api/financial/categories/:id` | `server/api/financial/categories/*` |

**`server/api/financial/entries.post.ts` is not used by anything in the frontend** — confirmed with a text search for `/api/financial/entries` across the whole `app/`, zero hits. It's orphaned code (a comment in the file itself says "Migrated from: supabase/functions/getFinancialEntriesPage"), most likely superseded when the current `index.get.ts` was written. The previous version of this documentation cited this file as an implementation reference (`normalizeCategory`, `DEFAULT_CATEGORIES`) — that was wrong, it's dead code and doesn't reflect what's in production. Worth deleting this file as part of the cleanup (section 5, Phase 2).

### 2.2 Four different spellings of category coexisting in real data

This isn't just "3 copies of one list" as previously recorded — confirmed, by reading the code, that there are **4 different value conventions** for the same conceptual category, with evidence that all four have real data behind them (not just a theoretical risk):

| Source | Convention | Example ("Serviços"/"Salários") |
|---|---|---|
| Legacy data, from before migration `20240101000056` (when `category` had a fixed English `CHECK`) | English, untranslated | `services`, `salaries` |
| Manual entry today, via `FormModal.vue` (`name.toLowerCase()` on the category's name) | Portuguese, lowercase, **accented** | `serviços`, `salários` |
| Service-order / commission payment (`server/utils/financial-income.ts:65`, `server/api/financial/pay-commissions-bulk.post.ts:133`, `server/api/reports/commissions/[id]/pay.post.ts:82`) | Mixed: English (`services`) or unaccented Portuguese (`salarios`) | `services`, `salarios` |
| `entries.post.ts` (dead code, section 2.1) | Portuguese, lowercase, **unaccented** | `servicos`, `salarios` |

Proof that the first row (legacy English) still has real data behind it: there are **two identical translation maps**, hardcoded, specifically to display these old values with a Portuguese name:

- `app/pages/app/financial/index.vue:727-743` (`categoryLabelMap`)
- `app/components/financial/entries/DetailSlideover.vue:139-155` (`CATEGORY_LABEL_MAP`)

Both maps translate **the same 8 English keys** (`sales`, `services`, `rent`, `salaries`, `suppliers`, `taxes`, `marketing`, `other`) plus an unaccented Portuguese set. If there were no real entries with these values, this code wouldn't exist duplicated in two places — someone had to solve this problem on the screen, so the data is there.

### 2.3 The default category list is hardcoded in 2 live places (not 3 — the third is dead code)

| File | Status | Shape |
|---|---|---|
| `server/api/financial/categories/index.get.ts:6-16` | Live | `'Vendas'`, `'Serviços'`, `'Outros'`, `'Aluguel'`, `'Salários'`, `'Fornecedores'`, `'Impostos'`, `'Marketing'`, `'Outros'` |
| `app/components/financial/entries/CategoryModal.vue:17-27` | Live | Identical copy of the row above |
| `server/api/financial/entries.post.ts:68` | **Dead** (section 2.1) | `['vendas', 'servicos', ...]` unaccented — no longer relevant, but explains where the spelling confusion likely came from |

**Count correction**: both live lists have **9 rows, not 8** — `'Outros'` appears twice (once for `income`, once for `expense`): 8 distinct names but 9 `(name, type)` combinations. The rest of this document uses "9 default rows (8 names, `'Outros'` duplicated per type)" consistently.

### 2.4 The screen's category filter doesn't look at all of the organization's data

`uniqueCategories` (`app/pages/app/financial/index.vue:271-277`) is computed from `accumulatedItems` — i.e., only from the rows **already loaded in the current pagination** in the browser, not from every category ever used by the organization. This is a bug independent of the FK question (it would exist even if category stayed free text), but the new screen is the right time to fix it, since the filter will need to query `financial_categories` anyway.

### 2.5 Out of scope, discarded after verification

- `app/types/financial.ts` — has `categoryId`, but belongs to a completely different module (fields `userId`, entities `Income`/`Expense`/`Debt`/`Asset` — this is the personal "Life OS" finance module, not the workshop's). Doesn't share a table or schema with `financial_transactions`. Confirmed and discarded — not a code precedent to reuse, though it does validate that id-referenced is the right pattern.
- `product_categories` / `server/api/reports/sales-items.get.ts` / `server/api/reports/export-sales-items.post.ts` / `app/pages/app/reports/sales-items.vue` — all use `products.category_id → product_categories`, **product** categorization, a different table and domain from `financial_categories`. Confirmed by reading all 4 files (e.g. `sales-items.get.ts:492` does `select('id, name, unit_cost_price, category_id')` against `product_categories`, not `financial_categories`). Not affected by this proposal, even though it lives in the `reports/` folder next to screens that are affected.
- `server/api/reports/export-commissions.post.ts`, `server/api/reports/export-purchases.post.ts` — only use `organizations` data to pull the name/logo into the exported PDF header. Don't touch financial category. Not affected.
- `app/pages/app/reports/profit.vue` and `app/pages/app/index.vue` (main dashboard) — searched for `categor` (case-insensitive) in both files, zero hits. Not affected.

### 2.6 A fifth and sixth place with the same confusion: icon/color per category already exists, and is just as hardcoded as the name

New request (see section 3.5): every category needs a selectable icon and color. Checking what already exists, the costs report screen **already solves this**, but the same fragile way the rest of the code solves the category name problem — guessing by keyword regex against the free-text `category` value:

- `app/utils/report-costs.ts` (61 lines) — exports `getCostCategoryVisual(categoryKey)`, which tests the category text against ~12 keyword regexes (`/(tax|impost|fiscal)/`, `/(salari|folha|employee|funcion|prolabore|pessoal)/`, etc.) and returns `{ icon, tagColor, chartColor }`; and `formatCostCategoryLabel(categoryKey)`, which humanizes the raw text (`replace(/_/g, ' ')` + capitalize) for display. Covers only the **expense** side — it never had to classify `Vendas`/`Serviços`/`Outros` (income), because the costs screen only lists expenses.
- Consumed in 4 live places: `app/components/reports/costs/CostsCharts.vue:2,33,35` (donut colors), `app/components/reports/costs/CostsCategoryDetailsSlideover.vue:2,81,103,109,210-211` (icon/color in the slideover header and on each transaction line), `app/components/reports/costs/CostsFilters.vue:4-5,49-50,56,59-60` (icon/color in the filter), and `app/pages/app/reports/costs.vue` itself (the colored `<UIcon>` per category in the table row).
- `server/api/reports/costs-profit.get.ts:11-13` has its own local `normalizeCategoryName()` — a **sixth** place doing category-text transformation (`replace(/_/g, ' ').toUpperCase()`), distinct from the two `*_LABEL_MAP`s already documented in section 2.2. It's used to build `categoryRows`/`categoryAmounts` (lines 102-145), today grouped by the raw `category` string.

Why this matters for the new architecture: once `icon`/`color` are real columns on `financial_categories` (section 3.5), this regex heuristic has no runtime purpose left — but it's exactly the right material to **seed** the initial `icon`/`color` values during the backfill (section 5), instead of everything being born with a generic icon. See section 4 for the file-by-file mapping.

### 2.7 Where an organization is created today — and a duplication that directly affects where the default-category step goes

The question "what hook creates the default categories when an organization is born" depends on finding where the organization is created. There is no `POST /api/organizations` and no database trigger on `organizations` (searched `CREATE TRIGGER`/`handle_new_user`/`auth.users` across every migration — only `updated_at` triggers exist). `server/api/auth/signup.post.ts` creates the Supabase Auth user and the `user_profile`, but **without** `organization_id` — the user is born without an organization.

The organization is only created when Stripe checkout completes, and here's the finding that matters: **there are two parallel, independently maintained implementations of the same handler**, both touched recently (`git log` shows commits on 2026-05-15 and 2026-05-17 respectively):

| Implementation | Where it creates the org | Where it creates the admin role |
|---|---|---|
| `server/api/stripe/webhook.post.ts` (Nuxt/H3 route) | `handleCheckoutCompleted()`, lines 114-171 — direct `insert` into `organizations` if `profile.organization_id` is null | Same function, lines 176-219 — idempotent upsert of the `admin` role + `role_actions` |
| `supabase/functions/stripe-webhook/index.ts` (Deno Edge Function) | `ensureOrganization()`, lines 328-368 — same idea, `insert` into `organizations` if the profile doesn't have one | A different helper in the same file (not mapped in detail here) |

Unlike `entries.post.ts` (section 2.1), there's no way to conclude from the repository alone that one of the two is dead code — both have recent commit history and no "deprecated"/"migrated from" comment. The only way to know which one Stripe is actually calling is to look at the webhook URL configured in the Stripe dashboard (outside the repository). **This blocks deciding where to put the default-category creation step** (section 3.6/4.1): if both are registered as Stripe webhooks, the default-category step needs to go in both, idempotently, so it doesn't depend on which one processes the event first.

## 3. Proposed architecture

### 3.1 Default categories become real rows

Today "default category" only exists as a code array. That's the core of the problem: you can't reference by id something that has no id. Proposal: the 9 default rows (8 names — `'Outros'` exists twice, once per type, see correction in section 2.3) become **real rows in `financial_categories`**, one set per organization (not a "global" table shared across organizations — this preserves the multi-tenant isolation that already exists today), created automatically:

- the moment an organization is created — see section 3.6 for exactly where this fits into the code today; and
- via backfill, for organizations that already exist today (section 5).

New column on `financial_categories`:

```sql
ALTER TABLE public.financial_categories
  ADD COLUMN is_default boolean NOT NULL DEFAULT false;
```

`is_default = true` marks the 9 default rows per organization. The rule "default categories can't be edited or removed" stops being "it's in a separate list" and becomes a simple check (`is_default = true` → blocks on `PUT`/`DELETE`).

**Schema bug this proposal would hit on day one if left unfixed**: the table's current unique constraint is `UNIQUE (organization_id, name)` (no `type`). The 9 default rows include **two rows both named `'Outros'`** for the same organization (one `income`, one `expense`) — inserting both would violate that constraint as written today. The constraint needs to widen to include `type` *before* any default-category row gets created:

```sql
ALTER TABLE public.financial_categories
  DROP CONSTRAINT financial_categories_org_name_uq;

ALTER TABLE public.financial_categories
  ADD CONSTRAINT financial_categories_org_name_type_uq UNIQUE (organization_id, name, type);
```

This is not optional polish — without it, seeding the defaults for any organization fails outright. It must ship in the same migration as `is_default` (section 5, Phase 0).

### 3.2 `financial_transactions` gets `category_id`

```sql
ALTER TABLE public.financial_transactions
  ADD COLUMN category_id uuid REFERENCES public.financial_categories(id) ON DELETE SET NULL;

CREATE INDEX idx_financial_transactions_category_id
  ON public.financial_transactions (category_id)
  WHERE deleted_at IS NULL;
```

`ON DELETE SET NULL` (not `RESTRICT`/`CASCADE`) to stay consistent with the pattern already used for other "light" FKs in this schema (e.g. `service_order_installments_payment_terminal_fk`, migration 53) — in practice it almost never fires, because a category is removed via soft delete (`deleted_at`), not a real `DELETE`; it's just a safety net.

The `category` (text) column **keeps existing during the transition** — see section 5. Everything can't be swapped atomically because the backfill depends on deciding, row by row, which `category_id` each text value should become.

### 3.3 What this simplifies (worth flagging to the team)

The previous version of this documentation had a whole section (6.1/6.2) about "when editing a category, ask whether to update existing transactions" — with an FK, this **stops being necessary**: editing `financial_categories.name` changes what's displayed for **every** transaction that references that id, automatically, without touching `financial_transactions`. There's no more "old transaction with the old category name."

**But this is a behavior change, not just a technical simplification** — recorded here as a product decision: if the workshop wants an old transaction to keep showing the category's old name (e.g. for audit/history reasons), the way to do that with an FK is different — it's not "edit and choose not to propagate," it's "create a new category and archive the old one" (leave the old one unused, without editing it, and old transactions keep pointing at it exactly like they always did). It might be worth not even offering free "edit name" and only offering "archive + create new" — left as an open question, not decided unilaterally here.

### 3.4 Category removal

With an FK, the usage check becomes simpler and exact — no more `lower(trim())`/normalization needed, it's an exact count by id:

```sql
SELECT count(*) FROM financial_transactions WHERE category_id = :id AND deleted_at IS NULL;
```

Same product rule as before: block removal (`409`) if `count > 0`, with the count in the error message. A category with `is_default = true` can never be removed, regardless of usage.

### 3.5 Icon and color per category

New request. Every category (default or custom) gets a selectable icon and color — today this only exists as a regex heuristic, and only for the expense side (section 2.6). Two new columns on `financial_categories`:

```sql
ALTER TABLE public.financial_categories
  ADD COLUMN icon  varchar(50) NOT NULL DEFAULT 'i-lucide-folder-open',
  ADD COLUMN color varchar(20) NOT NULL DEFAULT '#64748b';
```

- **`icon`**: an icon name from the `@iconify-json/lucide` set (already the dependency used across the app, confirmed in `package.json:30` and in the `i-lucide-*` names scattered through `report-costs.ts`). Not free text — the CRUD screen (section 6) offers a curated list of at least 20 icons through an avatar-style picker (click the icon avatar, pick from a grid), not a free icon search. The curated list is seeded from the ~13 icons originally hand-picked in `getCostCategoryVisual`, expanded with more icons relevant to a workshop's income/expense categories (vehicles, fuel, insurance, internet, etc.) — there's no 1:1 heuristic for the income side (`Vendas`/`Serviços`/`Outros`-income), those got a fresh pick.
- **`color`**: a genuine hex value (e.g. `#ef4444`), picked freely by the user via a real color picker (Nuxt UI's `UColorPicker`, plus a hex text input and quick-pick presets), not a closed set of semantic tokens as earlier drafts of this section proposed. Storing the literal hex means every consumer (badges, chart donut, icon tinting) uses the same value directly — no runtime resolution step, no second fixed-hex palette like `CATEGORY_PALETTE` used to be. The trade-off versus a semantic-token model: the color won't automatically adapt to dark/light theme or a future brand recolor, since it's a literal value chosen once. That's an accepted, explicit product decision, not an oversight.
- **Backfill (section 5)**: instead of every category being born with the column's generic default icon/color, the backfill script calls the same logic as `getCostCategoryVisual` (adapted from a runtime regex into a one-time seed script, now returning hex instead of a semantic token) to fill `icon`/`color` for migrated expense categories — visual continuity for anyone already using the costs screen. Income categories (no equivalent heuristic) get a neutral gray (`#64748b`) default icon/color during backfill, adjustable afterward from the CRUD screen.
- After the backfill, `app/utils/report-costs.ts` loses every consumer (section 4.2) and can be deleted — the logic doesn't disappear, it just moves from "computed on every render" to "computed once, during backfill, and stored."

### 3.6 Process for creating default categories when an organization is created

An organization isn't created by a signup screen or a database trigger — it's created while processing the Stripe `checkout.session.completed` webhook, alongside creating the `admin` role (see section 2.7 for the full finding, including the implementation duplication this exposes). The pattern to follow is the same one already used there for the `admin` role: check-then-create, never an unconditional insert — Stripe webhooks are *at-least-once* (the same event can be delivered more than once), so creating without checking would duplicate the 9 rows on every redelivery.

Step to add, right after the block that creates the organization:

```ts
// inside handleCheckoutCompleted(), after resolving organizationId
const { count: existingDefaults } = await supabase
  .from('financial_categories')
  .select('id', { count: 'exact', head: true })
  .eq('organization_id', organizationId)
  .eq('is_default', true)

if (!existingDefaults) {
  await supabase.from('financial_categories').insert(
    DEFAULT_CATEGORIES.map(c => ({
      organization_id: organizationId,
      name: c.name,
      type: c.type,
      icon: c.icon,
      color: c.color,
      is_default: true,
      created_by: 'stripe-webhook'
    }))
  )
}
```

**Exactly where this goes**: in `server/api/stripe/webhook.post.ts`, inside `handleCheckoutCompleted()` (lines 114-171), in the same place and the same style where the function already guarantees the `admin` role (lines 176-219). **If the investigation from section 2.7 confirms the Edge Function webhook (`supabase/functions/stripe-webhook/index.ts`, function `ensureOrganization()`, lines 328-368) is also registered in production, the same step needs to be replicated there** — it can't go in only one of the two without knowing which one actually processes the event.

This is orthogonal to the backfill in section 5 (which covers organizations that **already exist**) — without this step, every new organization created after the schema deploy but before someone runs the backfill would be born without the 9 default rows, and the defensive fallback mentioned in section 8 (service-order/commission payment creating the default category on the fly if missing) would have to cover that gap on its own.

## 4. Impacted screens and files (full map)

### 4.1 Backend — actually change

| File | What it does today | What changes |
|---|---|---|
| `server/api/financial/index.get.ts:19,33` | Filters with `ilike('category', ...)` on text | Filter by exact `category_id`; `select` now includes the join with `financial_categories` to bring the name |
| `server/api/financial/index.post.ts:23,43,66,94` | Requires `body.category` (string), writes it directly | Require `body.category_id` (uuid), validate it belongs to the organization before writing |
| `server/api/financial/[id].put.ts:29` | `category` is one of the generic fields allowed on update | Replace with `category_id` in the allowed field list, with the same validation as create |
| `server/api/financial/export.post.ts:99,109` | Exports `item.category` (string) directly into the CSV/PDF row | Look up the name via join/lookup of `category_id` before assembling the rows |
| `server/api/reports/costs-profit.get.ts:11-13,102,109,136-145` | Has its own local `normalizeCategoryName()` (section 2.6) and groups `categoryRows`/`categoryAmounts` by the raw `category` string | Group by `category_id`, bring `name`/`icon`/`color` via join — `categoryKey` becomes the uuid, `category` the joined name. Drops `normalizeCategoryName()`, which loses its only use. Only fall back to raw text for old rows without `category_id` (defensive, shouldn't exist post-backfill) |
| `server/api/financial/categories/index.get.ts` | Returns hardcoded `DEFAULT_CATEGORIES` + the organization's `financial_categories` | Returns only the organization's `financial_categories` (defaults are now real rows, `is_default=true`), including `icon`/`color` in the `select` — simplifies the endpoint, no longer needs the array |
| `server/api/financial/categories/index.post.ts` | Creates a custom category | Accept `icon`/`color` in the body; add the duplicate check against `is_default` too (can't create "Vendas" if the default "Vendas" already exists) |
| `server/api/financial/categories/[id].delete.ts` | Soft delete without checking usage | Block if `is_default=true` OR if `count(category_id) > 0` (section 3.4) |
| `server/api/financial/categories/[id].put.ts` | **Doesn't exist today** | New endpoint — edit name/`icon`/`color` (blocked if `is_default=true`) |
| `server/utils/financial-income.ts:65` | Writes a fixed `category: 'services'` | Resolve and write the `category_id` of the organization's default "Serviços" category (look up by `is_default=true AND name='Serviços'`, or cache it) |
| `server/api/financial/pay-commissions-bulk.post.ts:133` | Writes a fixed `category: 'salarios'` | Same swap, for "Salários" |
| `server/api/reports/commissions/[id]/pay.post.ts:82` | Writes a fixed `category: 'salarios'` | Same swap — lives under `server/api/reports/`, not `server/api/financial/`, easy to miss in a sweep that only checks the latter folder |
| `server/api/financial/check-recurring.post.ts:70` | Copies `category` from the parent transaction | Copy `category_id` instead of `category` — naturally simpler and correct, no text transformation at all |
| `server/api/financial/update-recurring.post.ts` | Passes `category` through as a generic field if present in the payload | No logic change, already a generic pass-through — just needs the caller to send `category_id` |
| `server/api/financial/entries.post.ts` | Dead code (section 2.1) | **Delete** |
| `server/api/stripe/webhook.post.ts:114-171` (`handleCheckoutCompleted`) | Creates organization + admin role on checkout completion; doesn't create categories | Create the 9 default rows (with `icon`/`color`) right after creating the organization, with the same idempotent pattern already used there for the admin role (section 3.6) |
| `supabase/functions/stripe-webhook/index.ts:328-368` (`ensureOrganization`) | Parallel implementation of the same handler, also creates the organization | **Conditional**: only needs the same step if the section 2.7 investigation confirms this webhook is actually registered in production — a pending decision, not a technical one |

**No change** (confirmed by reading the code, doesn't touch `category`): `server/api/financial/[id].get.ts`, `[id].delete.ts`, `summary.get.ts`, `pay-entries-bulk.post.ts`.

### 4.2 Frontend — actually change

| File | What it does today | What changes |
|---|---|---|
| `app/components/financial/entries/FormModal.vue:86-95,159,329,554` | `categoryOptions` maps categories to `{label, value: name.toLowerCase()}`; `form.category` is a string | `categoryOptions` becomes `{label: name, value: id}`; `form.category_id` replaces `form.category` |
| `app/components/financial/entries/CategoryModal.vue:17-27` | Hardcoded `DEFAULT_CATEGORIES` array, mixes default+custom only for display; creates/removes without icon or color | The array goes away — everything comes from `GET /api/financial/categories`, since defaults are now real rows. Gains an edit action (today only has create/remove) and the icon (curated list) and color (named palette) pickers on create/edit (section 3.5) |
| `app/components/financial/entries/Filters.vue:6,9,24-26` | Receives `categories: string[]`, filters by name | Receives `categories: {id, name, icon, color}[]`, filters by `category_id` |
| `app/components/financial/entries/FullscreenModal.vue:13,42-43,252` | Props `categoryFilter: string`, `uniqueCategories: string[]` | Same swap from string to `{id, name, icon, color}[]`/uuid |
| `app/components/financial/entries/DetailSlideover.vue:139-166,297-300` | Hardcoded `CATEGORY_LABEL_MAP` + `formatCategory()` to translate raw text | Shows `entry.category.name`/`.icon`/`.color` straight from the join — drops the map and the translation function for new data. Keeps a fallback only for any transaction without `category_id` (see section 5) |
| `app/pages/app/financial/index.vue:130,137,148,271-277,604,727-753` | Query param `category` (string); duplicated `categoryLabelMap`; `uniqueCategories` computed from the loaded page (section 2.4) | Query param `category_id`; removes the duplicated map; `uniqueCategories`/filter now come from `GET /api/financial/categories` (also fixes the section 2.4 bug, as a side effect) |
| `app/utils/report-costs.ts` (section 2.6) | `getCostCategoryVisual()`/`formatCostCategoryLabel()` — guesses icon/color/label by regex against the raw `category` string | No consumers left once the 3 files below read `icon`/`color`/`name` straight from the category — **delete the file** (the regex logic gets reused once, during the backfill, section 3.5) |
| `app/components/reports/costs/CostsCharts.vue:2,33,35` | Donut colors come from `getCostCategoryVisual(categoryKey).chartColor` | Color comes from `category.color` (resolved to the theme's hex), label from `category.name` |
| `app/components/reports/costs/CostsCategoryDetailsSlideover.vue:2,81,103,109,210-211` | Header and per-row icon/color come from the heuristic | Icon/color come from `category.icon`/`category.color` straight from the API response |
| `app/components/reports/costs/CostsFilters.vue:4-5,49-50,56,59-60` | Filter icon/color/label come from the heuristic | Same swap — reads `icon`/`color`/`name` from the category list |

### 4.3 No change, but worth recording (avoids surprises)

- `app/types/financial.ts` — not this module (section 2.5).
- Any Service Order screen — doesn't display or filter by this financial category; only the 3 backend files already listed in section 4.1 (`financial-income.ts`, both `pay-commissions...`) write to it as a side effect of payment.
- `server/api/reports/sales-items.get.ts`, `server/api/reports/export-sales-items.post.ts`, `app/pages/app/reports/sales-items.vue` — **product** category, a different domain (section 2.5). They live in the `reports/` folder next to affected screens, but confirmed they don't use `financial_categories`.
- `server/api/reports/export-commissions.post.ts`, `server/api/reports/export-purchases.post.ts` — only use `organizations` data (name/logo in the export header), don't touch financial category (section 2.5).
- `app/pages/app/reports/profit.vue`, `app/pages/app/index.vue` (dashboard) — zero category references, confirmed by text search (section 2.5).

## 5. Implementation & Migration Plan

This plan covers schema, data backfill, the organization-creation hook, backend, frontend, and the new CRUD screen, in dependency order. Each phase lists a concrete definition of done.

### Why the backfill matches case/accent-insensitively after all

Two earlier drafts of this section disagreed with each other. The first proposed matching the 4 spellings from section 2.2 by normalizing text (lowercase + strip accents) and merging matches into a single category. The second reversed that, flagging it as **the single biggest risk** of the whole proposal — an automatic matcher can wrongly merge categories that should stay separate, or fail to merge ones that should be the same — and replaced it with byte-exact matching only, accepting near-duplicate categories as a recoverable trade-off instead.

This final version goes back to normalizing, but on different footing: it was checked against a real production export (`financial_categories_rows.csv` / `financial_transactions_rows.csv`) before being decided, not assumed safe in the abstract. Grouping that organization's ~3,240 active transactions by normalized `(category text, type)` produced 23 distinct groups; **21 of them turned out to be case/accent variants of a category that already exists** (`"vendas"` → `Vendas`, `"PEÇAS"`/`"peças"` → the same row, `"fornecedores"` → `Fornecedores`, etc.) — confirmed by inspecting the actual variants side by side, not inferred. Byte-exact matching would have created 19 near-duplicate categories from that one organization alone; normalized matching creates 2. The risk the earlier draft worried about — two *conceptually different* categories colliding once normalized — did not occur anywhere in the real data inspected.

The mechanics: every category-text comparison (matching against an existing category, grouping distinct transaction texts, deciding whether to create a new category) goes through the same normalization — lowercase + deaccent (`translate()`, not the `unaccent` extension, to avoid an extra dependency). When a normalized group needs a brand-new category, its display name is the Title-Cased version of whichever original spelling was most common in that group, not the normalized form itself — so the result reads as `"Prolabore"`, not `"prolabore"`. This is still a judgment call specific to this organization's data, not a universal rule — section 8 records the residual risk this reopens.

### Phase 0 — Schema

1. Migration: add `financial_categories.is_default boolean NOT NULL DEFAULT false`, `icon varchar(50) NOT NULL DEFAULT 'i-lucide-folder-open'`, `color varchar(20) NOT NULL DEFAULT '#64748b'` (section 3.5 — color is a free hex value, not a semantic token; an early version of this migration shipped with a semantic-token default and needed a same-day follow-up migration to fix it after it had already been applied — don't edit an applied migration in place, always add a new one).
2. **Same migration**: replace `financial_categories_org_name_uq UNIQUE (organization_id, name)` with `UNIQUE (organization_id, name, type)` (section 3.1) — required before any default-category row can be inserted, since `'Outros'` exists once per type.
3. Migration: add `financial_transactions.category_id uuid NULL REFERENCES financial_categories(id) ON DELETE SET NULL` + the partial index on `(category_id) WHERE deleted_at IS NULL` (section 3.2). Nullable — coexists with the `category` text column.

**Done when**: both migrations are applied with zero impact on existing reads/writes (no code reads `category_id`/`is_default`/`icon`/`color` yet).

### Phase 1 — Backfill existing organizations + close the gap for new ones

4. Add the default-category creation step to the organization-creation hook(s) identified in section 2.7/3.6 — this can and should happen in parallel with the rest of Phase 1, since it's small and idempotent. Without it, every organization created between the Phase 0 deploy and the backfill running would be born without `is_default` rows.
5. Backfill, per organization — implemented directly as a SQL migration (`20240101000072_backfill_financial_transaction_categories.sql`) rather than an API endpoint, so it can be run the same way as every other schema change instead of requiring an authenticated owner-only HTTP call:
   a. If the organization doesn't have the 9 default rows (`is_default=true`), create them now, with `icon`/`color` seeded as described in step 6 below.
   b. For every custom category that already exists but predates this feature (created with the column's pristine default `icon`/`color`), give it a real icon/color via the same heuristic as step 6 — otherwise a category created by hand last month looks different from one the migration creates fresh from the same underlying text.
   c. Group every distinct `(category, type)` pair still in use among that organization's active transactions (`category_id IS NULL`) by a **normalized** key — lowercase + deaccent (section "Why the backfill matches case/accent-insensitively after all", above). For each normalized group: look for an existing category in that organization whose name normalizes to the same key, with the same `type`. If found, reuse its id. If not found, create one new custom category named after whichever original spelling was most common in that group (Title Cased), `type` from the group, `is_default = false`.
   d. Set `category_id` on every transaction in that organization whose `(category, type)` normalizes to a resolved group's key.
6. Icon/color seeding for categories created in steps a/c: for `expense`-type categories, the migration runs the same keyword logic as the old `getCostCategoryVisual()` (section 2.6/3.5) as a SQL helper function against the normalized category text, instead of leaving the column's generic default. For `income`-type categories (no equivalent heuristic — section 3.5), use a neutral default; these can be adjusted by hand afterward. The helper functions are dropped at the end of the same migration — they're matching logic, not something future code should depend on.
7. Rows the migration can't resolve (blank `category` text, or a `type` other than `income`/`expense`) are deliberately left with `category_id IS NULL` rather than guessed at — the migration file includes a commented-out diagnostic query to find them, for manual review before Phase 5's "confirm zero NULLs" gate.
8. Audit before moving to Phase 2: this normalization step was validated against a real production export before being finalized, not assumed safe — see the rationale above. Anyone backfilling a different organization's data should spot-check the resulting category list the same way: list categories per organization and sanity-check that nothing conceptually different got grouped together by coincidence.

**Done when**: `SELECT count(*) FROM financial_transactions WHERE category_id IS NULL AND deleted_at IS NULL` is `0` across every organization, and every organization has its 9 `is_default` rows.

### Phase 2 — Backend cutover (reads and writes)

9. Update the 7 write endpoints from section 4.1 that write `category` to write `category_id` instead. During the transition, accept **both fields** in the payload (if only `category_id` arrives, fine; if only `category` arrives — from some stale cached client — resolve it to a `category_id` on the fly, without breaking).
10. Update the read/report endpoints from section 4.1 (`index.get.ts`, `export.post.ts`, `costs-profit.get.ts`, `categories/*`) to join on `category_id` and return `name`/`icon`/`color`.
11. Delete `server/api/financial/entries.post.ts` (dead code, section 2.1).

**Done when**: every backend endpoint can read and write `category_id`; the frontend hasn't switched yet, so it still sends/expects `category` — both fields are live simultaneously.

### Phase 3 — Frontend cutover

12. Switch the 9 frontend files from section 4.2 to the id-based model (`FormModal.vue`, `CategoryModal.vue`, `Filters.vue`, `FullscreenModal.vue`, `DetailSlideover.vue`, `app/pages/app/financial/index.vue`, `CostsCharts.vue`, `CostsCategoryDetailsSlideover.vue`, `CostsFilters.vue`).
13. Delete `app/utils/report-costs.ts` once the 3 cost-report components above no longer import it.

**Done when**: no frontend file references `entry.category` as a string anymore; everything reads `category_id`/`category.name`/`category.icon`/`category.color`.

### Phase 4 — Categories CRUD screen

14. Build `/app/financial/categories` per the spec in section 6, including the new `PUT /api/financial/categories/:id` endpoint and the icon/color pickers from section 3.5.

**Done when**: the screen described in section 6 is shipped and `CategoryModal.vue` consumes the same API instead of its own hardcoded list.

### Phase 5 — Close-out

15. Confirm, with a direct database query, that there is no remaining `financial_transactions.category_id IS NULL` with `deleted_at IS NULL`.
16. Only then: make `category_id` `NOT NULL`, stop accepting `category` (text) on the endpoints, and mark the old column as deprecated.

### Phase 6 — Drop the legacy column (separate, later release)

17. In a **separate, later** migration (not part of this delivery): `DROP COLUMN category`. Don't do this in the same migration that creates `category_id` — there needs to be a real interval in production between "everyone migrated" and "the old way is gone," to give time to catch anything the backfill missed.

## 6. Categories CRUD screen

Keeps the goal of the original proposal, adjusted for the new model:

- `/app/financial/categories`, same layout/pattern as other app screens (`AppPageHeader`, Income/Expense tabs, search).
- Columns: Name (with the category's icon and color, the same visual pattern `costs.vue` already uses today for expense categories — section 2.6), Type, Origin (Default/Custom — now just `is_default`), In use (exact count by `category_id`), Actions.
- Create: name + type + icon (curated list, avatar picker, section 3.5) + color (free hex via color picker, section 3.5), validates duplicates (including against the defaults).
- Edit: name/icon/color, custom only (`is_default=false`); pending product decision on allowing free name edits vs. forcing "archive and create new" (section 3.3) — icon/color on a custom category can be edited freely either way, since they don't have the same "old transaction with the old name" problem (they're just styling, not the category's identity).
- Remove: custom only, only if usage = 0.
- Migrate items: available for any category with `usage_count > 0`. Opens a
  modal that shows the source category and the number of linked financial
  transactions, but not the transaction list. The user selects a target
  category of the same type (`income` to `income`, `expense` to `expense`) and
  confirms. Backend contract: `POST /api/financial/categories/:id/migrate`
  with `{ "target_category_id": "<uuid>" }`. The endpoint validates both
  categories in the current organization, rejects same-source/destination and
  cross-type moves, counts active transactions (`deleted_at IS NULL`), then
  updates them in batches of 500. This keeps the user flow as one operation
  while avoiding one very large update that could time out or overload the
  request for categories with many linked transactions. The response returns
  `{ success, migrated, total, batch_size }`.
- `CategoryModal.vue` gains an edit action (didn't have one), the icon/color pickers, and stops keeping its own default list — consumes the API.

## 7. Acceptance Criteria

- `financial_categories` has the 9 default rows (8 names, section 2.3) as real rows (`is_default=true`) in every organization, new and existing.
- Every new organization (created via Stripe checkout) is born with the 9 default rows, without depending on the backfill having run first — verified at the organization-creation point(s) mapped in section 2.7/3.6.
- Every category (default or custom, new or migrated) has `icon` and `color` filled in — no screen goes back to guessing icon/color by regex against the category name (replaces what `app/utils/report-costs.ts` does today, section 2.6).
- Every active `financial_transactions` row has `category_id` filled in after the backfill — zero information loss (every old text became some real category, even if created automatically during the backfill). Spelling variants that are genuinely the same category (case/accent only) are merged into one row; anything not confirmed to be a pure spelling variant is not.
- A new transaction (manual, from a service order, or from a commission) writes `category_id`, never writes `category` text again.
- Editing a category's name reflects on every transaction referencing it, with no extra step.
- Default categories can't be edited or removed.
- A custom category in use can't be removed (exact count, no text ambiguity).
- The category filter on the transactions screen shows every category in the organization, not just the ones from the loaded page (fixes the section 2.4 bug).
- `server/api/financial/entries.post.ts` has been removed.
- The category-usage query doesn't depend on `lower(trim())` or any other text normalization.

## 8. Risks and points of attention

- **The backfill merges case/accent spelling variants automatically** (section 5) — this was checked against one organization's real production data before being decided (21 of 23 normalized groups were confirmed genuine spelling variants of an existing category), not assumed safe for every organization. The residual risk this reopens: a *different* organization could have two genuinely distinct categories that happen to share a normalized form (e.g., if someone literally named a custom category `"outros"` for something specific, distinct from the default `Outros`) — these would get silently merged. Before running this migration against a new organization's data, do the same check: list its distinct category texts grouped by normalized key and confirm each group really is one category, not two coincidentally-similar ones.
- **Service-order and commission payments depend on finding the right default category at runtime** (`server/utils/financial-income.ts`, etc.) — if an organization, for any reason, doesn't have the default "Serviços"/"Salários" row (e.g. a backfill failure, or an organization created in a gap between phases), that code needs an explicit fallback (create the default category right there, on the fly, if missing) instead of failing the payment transaction. Don't let this break the payment flow because of a missing category.
- **Keeping `category` (text) during the transition temporarily doubles the places that write this information** — normal risk for a two-phase migration, but it's why Phase 5 (section 5) needs an explicit confirmation step before proceeding, not just "code's ready, ship it."
- The `UNIQUE (organization_id, name, type)` constraint (section 3.1, already widened to include `type`) is still a full-table constraint, not a partial index — same observation as the previous version of this document: if you want to allow recreating a category with the same name as one that was previously soft-deleted, it needs to become a partial unique index `WHERE deleted_at IS NULL`. More relevant now than before, because the backfill (section 5) can create new categories whose names collide with something removed in the past.
- **There are two parallel implementations of the webhook that creates an organization** (`server/api/stripe/webhook.post.ts` and `supabase/functions/stripe-webhook/index.ts`, section 2.7), and there's no way to tell from the code which one Stripe is actually calling in production. This is an external dependency (Stripe dashboard configuration) that blocks the decision of where to put the default-category creation step (section 3.6) — needs to be resolved before Phase 0 ships, not during.
- **Icon/color for the 3 default income categories have no precedent to copy** — the existing heuristic (`getCostCategoryVisual`, section 2.6) was only ever designed for expenses, because the only screen that needed it (`/app/reports/costs`) only lists expenses. Choosing icon/color for "Vendas"/"Serviços"/"Outros"(income) is a fresh design decision, not an extraction from existing code.
