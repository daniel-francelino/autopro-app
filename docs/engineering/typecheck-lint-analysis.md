# Typecheck and Lint Analysis (Phase 1, analysis only)

Branch `dev`. Raw outputs were kept outside the repo (scratchpad); counts below were taken from them. `.nuxt` exists and is gitignored, so generated types are prepared (not a cause).

## 1. Counts

| Gate | Result |
|---|---|
| `pnpm typecheck` | 548 TS errors |
| `pnpm lint` | 439 eslint errors, 0 warnings, 69 files; 202 auto-fixable; `check-public-claims` passes |

TS by code: TS2339 278, TS2345 107, TS2322 81, TS2352 18, TS2532 14, TS2353 12, TS18047 12, TS2538 8, TS2367 7, TS18048 3, TS2769 2, other 6.

TS by area: `server/api/reports` 264, `server/utils/profit-report-helpers.ts` 62, `app/pages/app` 92, `app/components/**` ~60, `server/utils/service-order-item-commissions.ts` 14, `nuxt.config.ts` 11, `server/api/admin` 12, `server/routes/llms.txt.get.ts` 8, rest small.

Eslint by rule (fixable/total): `vue/html-indent` 148/148, `no-explicit-any` 0/147, `max-statements-per-line` 0/45, `no-unused-vars` 0/26, `quote-props` 14/14, `max-attributes-per-line` 8/13, `lines-between-class-members` 9/9, `singleline-html-element-content-newline` 8/8, `no-dynamic-delete` 0/6, `no-empty` 0/5, `arrow-parens` 4/4, `no-multiple-empty-lines` 3/3, `quotes` 3/3, `consistent-type-imports` 2/2, `import/no-duplicates` 1/2, `no-irregular-whitespace` 0/1, `return-in-computed-property` 0/1, `block-tag-newline` 1/1, `multiline-html-element-content-newline` 1/1.

Top eslint files: `app/components/service-orders/PaymentModal.vue` 148 (all `vue/html-indent`), `server/api/reports/export-sales-items.post.ts` 45 (`max-statements-per-line`), `server/api/reports/commissions/[id].get.ts` 18, `app/components/landing/ServiceOrdersScreen.vue` 17.
Eslint by area: `app/components` 203, `server/api` 129, `app/pages` 57, `tests/e2e` 34, `server/utils` 9, `scripts/seed` 6.

## 2. Root-cause groups (verified unless marked hypothesis)

**RC1: `SupabaseClientLike` is incompatible with the real client, and row type defaults to `object` (about 340 TS errors, 62%).**
- `server/utils/supabase-pagination.ts:3` `SupabaseReportRow = object`; `:14-24` a structural `from()` builder requiring `eq/is/order/range` directly on `from()`'s result. The real `PostgrestQueryBuilder` exposes only `select` first, so passing `SupabaseClient` fails ("missing eq, is, order, range").
- Callers in bonuses already work around it with `supabase as unknown as SupabaseClientLike` (`server/api/bonuses/[id]/progress.get.ts:55`). Report endpoints do not (`costs-profit.get.ts:40,46,52`, `dashboard-stats.get.ts:66-85`, `export-sales-items.post.ts:235`), producing TS2345.
- Because `fetchAllOrganizationRows` returns `T[]` with `T = object` by default, every property access then fails: TS2339 "Property X does not exist on type 'object'" (`costs-profit.get.ts:70-102`, `dashboard-stats.get.ts:94`, `export-sales-items.post.ts:264,272`, `profit-report-helpers.ts` 62). The helper was introduced in commit b248ab5. A single fix at the helper (typing + row generic) should clear most of them.
- `service-order-item-commissions.ts:72-74` (14 errors): a different shape mismatch (`item` typed as a commission result object, not the order item). Likely the same upstream cause; confirm after RC1 fix.

**RC2: `useReportQueryParam('sortOrder', 'desc')` infers the literal `'desc'`** so `!== 'asc'` is TS2367: `app/pages/app/reports/{commissions:57,costs:77,customers:22,purchases:81,sales-items:123,suppliers:60}.vue`. The same cause likely produces `reports/purchases.vue:83` TS2322 (`string` vs `'purchase_date'`) (hypothesis). Fix with an explicit generic (`<'asc' | 'desc'>`, `<string>`). The comparison is valid at runtime.

**RC3: `AppDataTable` row typing (`Record<string, unknown>`) vs domain types.** `app/pages/app/products/categories.vue:132-204` (13 TS2352 casts from `TableRowData`), `purchases.vue`, `purchase-requests.vue`, `AppDataTable.vue` (8), `AsyncPaginatedSelect.vue` (10, generic `T` vs `UnwrapRefSimple<T>`). Fix by making `AppDataTable` generic over the row type (config/type change, not casts).

**RC4: nullable form fields.** `app/pages/app/settings/company.vue` 18 (`string | null | undefined` into `string | undefined` props, lines 486-612). Fix by `?? undefined` or widening the type.

**RC5: dependency API drift (verified from messages; library versions are hypothesis).**
- `nuxt.config.ts:120-123` `routeRules.robots` not in the type (11 total): the `@nuxtjs/robots` module types are not augmenting, or its config is wrong.
- `server/routes/llms.txt.get.ts:9-10` `useSiteConfig(event)` and `queryCollection(event, ...)` signature mismatch (8): verify against the installed nuxt-site-config and @nuxt/content versions.
- `server/api/organizations/complete-onboarding.post.ts:14` `z.enum(..., { errorMap })`: zod ^4.3.6 dropped `errorMap` (use `error`). This is a runtime defect too: the custom message is likely ignored.
- `app/components/ui/DateRangePicker.vue:9` `DateRange` is not exported by `@internationalized/date`; `app/pages/app/subscribe.vue:47` `PricingCollectionItem` vs `PricingPage`.

**RC6: genuine null-safety gaps.** TS18047/TS2532 in `server/api/reports/commissions/[id]/pay.post.ts:77,100,115,123,162` (`bankAccount` possibly null), `server/api/admin/{invoices,subscriptions}/chart.get.ts`, `server/api/products/[id].put.ts:34`, `app/utils/calendar.ts:94`, `app/components/reports/customers/CustomersDetailSlideover.vue:127`, `app/pages/app/settings/roles/[id].vue:205,362`, `PaymentModal.vue:153`. For `pay.post.ts`, both branches assign or throw (lines 52-72), so narrowing is likely lost to typing of the `maybeSingle()`/array results (hypothesis); verify.

**Eslint root causes**
- `PaymentModal.vue` 148 `vue/html-indent` is one file (likely a block of mis-indented template); fixed by `--fix`.
- `no-explicit-any` 147: `server/api/reports` 73, `server/api/financial` 23, `app/pages/admin` 11, `service-orders` API 9, `nuxt-fiscal` 6. Mostly `catch (error: any)` and untyped Supabase rows. Same cause as RC1 (no typed DB client); not auto-fixable. `eslint.config.mjs` only relaxes `any` for tests.
- `max-statements-per-line` 45: `export-sales-items.post.ts` (compact one-liners); manual reformat.
- `no-unused-vars` 26, `no-dynamic-delete` 6 (`customers/FormModal.vue`, `vehicles/FormModal.vue`, `appointments.vue`), `no-empty` 5, `return-in-computed-property` 1, `no-irregular-whitespace` 1: manual.

## 3. Items that may hide business, money, auth or tenant defects

1. **`server/api/financial/pay-commissions-bulk.post.ts:196-209` and `pay-entries-bulk.post.ts:147-148` (no-empty).** The rollback after a failed payment swallows errors with empty `catch {}` (deleting the bank statement, restoring `current_balance`, soft-deleting the transaction). A failed rollback leaves a wrong bank balance or an orphan statement with no log, and the result is reported as only `failed`. Data integrity and money risk: HIGH. Do not just add `/* ignore */`; log the failure and surface it in `results` (needs a business decision; Phase 2 should flag it, not silently change behavior).
2. **`reports/commissions/[id]/pay.post.ts` (TS18047 on `bankAccount.current_balance`).** The balance read/update computes `previousBalance - amount` on a non-atomic read-modify-write. Fix the typing without changing behavior; the race is a separate finding.
3. **Report endpoints (RC1) rely on `fetchAllOrganizationRows` for tenant isolation** (it adds `organization_id`). Typing fixes must not change that filter. Casting `as unknown as` hides mismatches, so keep `organization_id` mandatory in the helper's options type. Verified present at `supabase-pagination.ts:47-50`.
4. **`complete-onboarding.post.ts` zod `errorMap`**: validation messages may be silently lost (onboarding, low risk).
5. **`service-order-item-commissions.ts:72-74`**: the commission calculation reads fields from a mis-typed object. Confirm no field is actually undefined at runtime (commission amounts). Money risk: MEDIUM until verified by tests.
6. **`purchases.vue:603` TS2367 (`number` vs `string` comparison on `unit_sale_price`)** is probably a harmless `''` guard from a form input, but verify that an empty string maps to `null` rather than `0` (purchase pricing).

## 4. Ordered fix plan for the developer

Run `pnpm exec eslint <files>` and `pnpm typecheck` after each step; commit separately.

1. **Auto-fix formatting** (no logic change). `pnpm exec eslint . --fix`. Expected to clear about 202 errors (`html-indent`, `quote-props`, `arrow-parens`, etc.). Review `git diff --stat`; `PaymentModal.vue` should be whitespace only. Validate: `pnpm lint` shows about 237 errors left, `pnpm test` still passes.
2. **RC1 helper typing** (code fix, biggest win). In `server/utils/supabase-pagination.ts`: make `SupabaseClientLike.from` accept the real client (a minimal `from(table): { select(cols): ...}` shape, or accept `SupabaseClient`), and have report callers pass an explicit row generic (`fetchAllOrganizationRows<Row>`) with local row interfaces. Remove the `as unknown as` casts in bonuses once compatible. Keep `organization_id` filter. Validate: `pnpm typecheck` should drop by about 340; run report unit/API tests.
3. **RC2 sort params**: add an explicit generic at the six `useReportQueryParam('sortOrder', 'desc')` call sites (or give the composable a `string` default type). Validate: typecheck, no TS2367 left.
4. **RC5 config/library drift**: fix zod `errorMap` to `error` (`complete-onboarding.post.ts:14`); investigate `routeRules.robots` (module typing), `llms.txt.get.ts` signatures, `DateRange` import, `PricingPage` types by reading the installed versions' docs. Config changes need justification in the PR. Validate: `pnpm typecheck`, `pnpm build` (prerender of `/llms.txt`), onboarding test.
5. **RC3 `AppDataTable` generics** and `AsyncPaginatedSelect` generic: remove the casts in `categories.vue`, `purchases.vue`, `purchase-requests.vue`. Validate: typecheck plus a manual or E2E table smoke test.
6. **RC4 and RC6 null-safety**: `company.vue`, `pay.post.ts` (no behavior change), chart endpoints, `calendar.ts`, `roles/[id].vue`. Use real null guards, not `!`. Validate: typecheck plus unit tests for those modules.
7. **Remaining eslint manual items**: `no-unused-vars` (remove dead code, or prefix `_`), `max-statements-per-line` (split lines), `no-dynamic-delete` (use destructuring or `Reflect.deleteProperty`), `return-in-computed-property`. Then replace `any` in `catch (error: any)` with `unknown` plus a narrowing helper (about 147). Do the `no-empty` rollback handling (item 1 above) only after a decision. Do not turn off `no-explicit-any` globally. Validate: `pnpm lint`.
8. Final gate: `pnpm typecheck && pnpm lint && pnpm test`.

## 5. Risks

- RC1 touches every report endpoint: a wrong type change could mask a missing tenant filter. Require independent code review and the report tests.
- `--fix` over `.vue` templates is safe for whitespace but review the diff of `PaymentModal.vue` (payment UI).
- Library drift fixes (step 4) may need version pinning decisions; do not upgrade dependencies without approval.
- `any` removal at scale can cause large churn; limit to files touched or to the money paths first.
- Counts will shift after each step because cascades overlap; re-run both gates after each step rather than trusting the numbers above.
