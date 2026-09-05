// Pure commission-calculation logic for the standalone Commission Plan
// feature (Steps 2, 3, 6 and 8 of
// docs/finance/commissions-configuration-architecture.md — see
// docs/finance/commissions-step8-engine-cutover.md for the Step 8 cutover
// plan this file implements).
//
// Lives in lib/ (a plain, ordinary folder — NOT Nuxt's shared/ directory)
// specifically so it can be imported both by server engines
// (server/utils/service-order-*.ts) and by the frontend live preview
// (app/utils/service-orders.ts) as a normal bundled dependency. It used to
// live in shared/utils/, which Nuxt auto-imports globally and bundles
// through its own "shared" virtual-chunk machinery for both the Nitro
// server and the Vue app — that machinery is what broke: the production
// build's prerenderer failed with
// `RollupError: Could not resolve "../shared/utils/employee-commission-engine.ts"`
// from a built server chunk. Renaming the colliding auto-imported symbols
// (see the git history on this file) fixed the "Duplicated imports" warning
// but not that Rollup error — the prerenderer step itself couldn't resolve
// the shared chunk at the path Nuxt generated for it, independent of naming.
// Moving the file out of shared/ entirely sidesteps that machinery: lib/ has
// no special meaning to Nuxt, so this is just an ordinary TypeScript module,
// statically bundled by Vite/Rollup wherever it's explicitly imported, same
// as any other file in the repo.
//
// Nothing here touches Supabase; DB-fetch wrappers stay in
// server/utils/employee-commission-plans.ts, which imports what it needs
// from this file but does NOT re-export it — re-exporting would put the
// same names back in server/utils/*.ts, which Nuxt DOES auto-import
// globally, recreating the original duplicate-symbol problem for anything
// that also happens to auto-import the same name (see the "Naming note"
// below). Every other file imports straight from here.
//
// Naming note: toCommissionMonthStart/currentCommissionMonthStart/
// resolveEffectiveCommissionVersion are prefixed with "Commission" (unlike
// the rest of this file's exports) because server/utils/bonuses.ts already
// exports its own functions with those exact bare names for the unrelated
// bonus feature — server/utils/*.ts is still auto-imported globally by
// Nuxt, so two files exporting the same bare name is a real collision
// there even though this file no longer lives in shared/. roundMoney is not
// exported at all: nothing outside this file needs it from here (every real
// caller already has its own from server/utils/report-helpers.ts).

export type CommissionRuleType = 'percentage' | 'fixed_amount'
export type CommissionRuleBase = 'revenue' | 'profit'

export interface CommissionRuleVersionRecord {
  id: string
  plan_id: string
  effective_from: string
  notes: string | null
  created_at?: string
  created_by?: string | null
}

export interface CommissionRuleRecord {
  id: string
  version_id: string
  name: string | null
  commission_type: CommissionRuleType
  commission_amount: number
  /** Required for 'percentage' rules; null for 'fixed_amount' — a flat R$ per unit doesn't have a base. */
  commission_base: CommissionRuleBase | null
  is_default: boolean
  sort_order: number
  category_ids: string[]
}

/** A rule as returned by resolveEmployeeCommissionRules — same shape, plus
 * which plan it came from (needed to fill commission_plan_id on a snapshot,
 * since a rule's own row doesn't carry its plan — only its version). */
export interface ResolvedCommissionRule extends CommissionRuleRecord {
  plan_id: string
}

function roundMoney(value: number): number {
  return Number.parseFloat(Number(value || 0).toFixed(2))
}

/** Always the 1st of the month, e.g. "2026-03-01". */
export function toCommissionMonthStart(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

export function currentCommissionMonthStart(): string {
  return toCommissionMonthStart(new Date())
}

/**
 * The version effective for a given date is the one with the greatest
 * effective_from <= referenceDate — not necessarily the most recently
 * created row (same resolution rule as bonus_value_versions). Returns null
 * if no version was effective yet by that date.
 */
export function resolveEffectiveCommissionVersion(
  versions: CommissionRuleVersionRecord[],
  referenceDate: string
): CommissionRuleVersionRecord | null {
  const candidates = versions.filter(version => version.effective_from <= referenceDate)
  if (candidates.length === 0) return null
  return candidates.reduce((latest, version) => (version.effective_from > latest.effective_from ? version : latest))
}

/**
 * Resolution engine core (Step 6): given the full set of rules applicable to
 * an employee right now (across every plan assigned to them, already
 * resolved to each plan's effective version), picks the rule that applies to
 * one item.
 *
 *   1. If the item has a category, and a non-default rule covers it, use it.
 *   2. Otherwise fall back to the default rule, if any.
 *   3. An item with no category always falls through to the catch-all —
 *      mirrors the legacy engines' preserved behavior.
 *   4. No matching rule and no catch-all → no commission for this item.
 */
export function getApplicableCommissionRule(
  rules: CommissionRuleRecord[],
  categoryId: string | null | undefined
): CommissionRuleRecord | null {
  if (categoryId) {
    const specific = rules.find(rule => !rule.is_default && rule.category_ids.includes(String(categoryId)))
    if (specific) return specific
  }
  return rules.find(rule => rule.is_default) ?? null
}

/**
 * Picks the applicable rule the same way getApplicableCommissionRule() does,
 * but also surfaces which plan it came from — needed to fill
 * commission_plan_id when building a persistable snapshot (buildCommissionSnapshot below).
 */
export function matchCommissionRule(
  rules: ResolvedCommissionRule[],
  categoryId: string | null | undefined
): ResolvedCommissionRule | null {
  return getApplicableCommissionRule(rules, categoryId) as ResolvedCommissionRule | null
}

/**
 * Computes the commission value for one rule match.
 *
 * - 'percentage': rate applied over the item/order's revenue or profit
 *   (caller decides what those mean — full item value, or an already
 *   prorated slice of it), per rule.commission_base.
 * - 'fixed_amount': a flat R$ value PER UNIT matched, independent of the
 *   item's price — commission_amount * quantity. This is the precise
 *   semantics decided for fixed_amount rules (20240101000088 and Step 8 —
 *   see docs/finance/commissions-step8-engine-cutover.md §4.1 and §11): "R$20
 *   per tire sold", not "R$20 per order that has a tire" and not "R$20
 *   split evenly across however many eligible items happen to be on the
 *   order" (both of which the legacy engines did, inconsistently with each
 *   other).
 */
export function computeCommissionAmount(
  rule: CommissionRuleRecord,
  amounts: { revenue: number, profit: number, quantity?: number }
): number {
  if (rule.commission_type === 'fixed_amount') {
    return roundMoney(rule.commission_amount * (amounts.quantity ?? 1))
  }
  const base = rule.commission_base === 'profit' ? amounts.profit : amounts.revenue
  return roundMoney((base * rule.commission_amount) / 100)
}

export interface CommissionItemSnapshot {
  commission_plan_id: string
  commission_rule_id: string
  commission_rule_version_id: string
  commission_rule_name: string | null
  commission_amount_snapshot: number
  commission_type: CommissionRuleType
  commission_base: CommissionRuleBase | null
}

/**
 * Composes matchCommissionRule() + computeCommissionAmount() into the
 * ready-to-persist snapshot shape from section 4.6 of the design doc (the
 * new columns on employee_financial_records).
 */
export function buildCommissionSnapshot(
  rules: ResolvedCommissionRule[],
  item: { categoryId: string | null | undefined, revenue: number, profit: number, quantity?: number }
): CommissionItemSnapshot | null {
  const rule = matchCommissionRule(rules, item.categoryId)
  if (!rule) return null

  return {
    commission_plan_id: rule.plan_id,
    commission_rule_id: rule.id,
    commission_rule_version_id: rule.version_id,
    commission_rule_name: rule.name,
    commission_amount_snapshot: computeCommissionAmount(rule, item),
    commission_type: rule.commission_type,
    commission_base: rule.commission_base
  }
}

// ─── Order-item amount resolution (Step 8) ─────────────────────────────────
// The piece Step 6 deliberately left to the caller: given an order's items
// (already resolved to plain numbers) and one employee's resolved rules,
// decide which items are eligible, prorate the order's discount/taxes across
// them, and compute a per-item commission. Replicates the legacy engines'
// discount/tax proration exactly (per this employee's OWN eligible-items
// subtotal, not the whole order's) — the one thing Step 8 deliberately kept
// identical to the 4 legacy engines. See
// docs/finance/commissions-step8-engine-cutover.md §4.2 and §11.

export interface CommissionOrderItemInput {
  categoryId: string | null | undefined
  /** Already quantity-multiplied (unit price × quantity, or a stored total). */
  total: number
  /** Already quantity-multiplied. */
  cost: number
  quantity: number
}

export interface CommissionOrderItemResult {
  amount: number
  rule: ResolvedCommissionRule
}

export interface EmployeeOrderCommissionResult {
  /** False when the employee has no plan/rule that covers anything on this order — mirrors the legacy engines' "no eligible items" signal. */
  hasMatchingItems: boolean
  total: number
  /** Same length/order as the `items` input; null where no rule matched (no commission for that item). */
  perItem: Array<CommissionOrderItemResult | null>
}

function getOrderItemQuantityRaw(quantity: number): number {
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1
}

/**
 * New-model per-employee, per-order commission resolution (Step 8). Callers
 * fetch `rules` once via resolveEmployeeCommissionRules() (server) or the
 * equivalent API call (frontend), then call this — pure, synchronous, no I/O
 * — for every order that employee is responsible for.
 *
 * Returns hasMatchingItems=false and an empty result when `rules` is empty
 * (the caller is responsible for falling back to the legacy calculation in
 * that case — see docs/finance/commissions-step8-engine-cutover.md §6. This
 * function never falls back on its own; an employee WITH rules but with no
 * item matching any of them legitimately earns nothing on this order under
 * the new model, and that is not a fallback case.)
 */
export function computeEmployeeOrderCommission(
  rules: ResolvedCommissionRule[],
  items: CommissionOrderItemInput[],
  orderContext: { discount: number, totalTaxesAmount: number }
): EmployeeOrderCommissionResult {
  const perItem: Array<CommissionOrderItemResult | null> = new Array(items.length).fill(null)

  if (rules.length === 0 || items.length === 0) {
    return { hasMatchingItems: false, total: 0, perItem }
  }

  const matches = items.map(item => matchCommissionRule(rules, item.categoryId))
  const eligibleIndexes = items.map((_, index) => index).filter(index => matches[index] !== null)

  if (eligibleIndexes.length === 0) {
    return { hasMatchingItems: false, total: 0, perItem }
  }

  const subtotal = items.reduce((sum, item) => sum + item.total, 0)
  const eligibleSale = eligibleIndexes.reduce((sum, index) => sum + items[index]!.total, 0)
  const eligibleRatio = subtotal > 0 ? eligibleSale / subtotal : 0
  const eligibleDiscount = orderContext.discount * eligibleRatio
  const eligibleTaxes = orderContext.totalTaxesAmount * eligibleRatio

  let total = 0

  for (const index of eligibleIndexes) {
    const item = items[index]!
    const rule = matches[index]!
    const quantity = getOrderItemQuantityRaw(item.quantity)
    const fraction = eligibleSale > 0 ? item.total / eligibleSale : 1 / eligibleIndexes.length
    const itemDiscount = eligibleDiscount * fraction
    const itemTaxes = eligibleTaxes * fraction

    const revenue = item.total - itemDiscount
    const profit = Math.max(0, revenue - item.cost - itemTaxes)

    const amount = computeCommissionAmount(rule, { revenue, profit, quantity })
    if (amount > 0) {
      perItem[index] = { amount, rule }
      total = roundMoney(total + amount)
    }
  }

  return { hasMatchingItems: eligibleSale > 0, total, perItem }
}

// ─── Canonical item field readers ──────────────────────────────────────────
// The same "total_price ?? total_amount, fallback unit_price × quantity" /
// "cost_price ?? cost_amount" logic used to live duplicated (with small
// inconsistencies) in all 4 legacy engines. One version now, shared.

interface RawCommissionOrderItem {
  quantity?: number | string | null
  total_price?: number | string | null
  total_amount?: number | string | null
  unit_price?: number | string | null
  cost_price?: number | string | null
  cost_amount?: number | string | null
  category_id?: string | null
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function getOrderItemQuantity(item: RawCommissionOrderItem): number {
  const quantity = toFiniteNumber(item?.quantity ?? 1)
  return quantity > 0 ? quantity : 1
}

/** Quantity-multiplied total for the item. */
export function getOrderItemTotal(item: RawCommissionOrderItem): number {
  const raw = item?.total_price ?? item?.total_amount
  if (raw != null) return toFiniteNumber(raw)
  return toFiniteNumber(item?.unit_price) * getOrderItemQuantity(item)
}

/** Quantity-multiplied cost for the item. */
export function getOrderItemCost(item: RawCommissionOrderItem): number {
  return toFiniteNumber(item?.cost_price ?? item?.cost_amount) * getOrderItemQuantity(item)
}

export function toCommissionOrderItemInput(item: RawCommissionOrderItem): CommissionOrderItemInput {
  return {
    categoryId: item?.category_id ?? null,
    total: getOrderItemTotal(item),
    cost: getOrderItemCost(item),
    quantity: getOrderItemQuantity(item)
  }
}

// ─── Manual commission override (docs/finance/commissions-manual-override.md) ──
// Lets a user apply, for one employee on one specific order, an existing
// commission plan different from their standard one (e.g. "use 'Comissão
// mecânicos — plantão' instead of the usual 'Comissão mecânicos — padrão' on
// this job") — scoped to that order only, with a required reason. The
// override plan doesn't need to be assigned to the employee; it can be any
// plan in the org, resolved the normal way (current effective version, one
// rule per category plus an optional default) so it supports the exact same
// per-category rules a standard assignment would — no synthetic flat rule.
//
// No new table/column for "current state": the order's
// commission_manual_adjustments_log (jsonb, also used by the plain
// "Recalcular" action) is the only source of truth — the active override for
// an employee is whatever their LAST log entry with an override_action says,
// scanning from the end. An 'apply' entry is the active override; a 'remove'
// entry (or no override-tagged entry at all) means none is active. Applying
// a different plan is just another 'apply' entry — older ones stay in the
// array for history, never rewritten.
//
// Resolving a plan's rules needs Supabase, so it can't happen in this
// I/O-free file (unlike the flat-rate design this replaced, which could
// synthesize the override rule locally) — callers resolve
// getActiveOverridePlanIds() themselves (server via
// server/utils/employee-commission-plans.ts#resolveCommissionPlanRules,
// client via GET /api/commissions/:id/rules) and hand the result to
// resolveEffectiveCommissionRules() as planRulesByPlanId.

export type CommissionOverrideAction = 'apply' | 'remove'

/**
 * One entry in service_orders.commission_manual_adjustments_log. Covers two
 * kinds of event sharing the same shape: a plain recalculation (no
 * override_* fields) and an override apply/remove (override_action set).
 * previous_amount/new_amount are always the released total before/after
 * this entry, regardless of which kind it is.
 */
export interface CommissionManualAdjustmentLogEntry {
  employee_id: string
  employee_name: string | null
  reason: string
  previous_amount: number
  new_amount: number
  recalculated_by_email: string | null
  recalculated_by_name: string | null
  recalculated_at: string
  override_action?: CommissionOverrideAction
  /** null when override_action = 'remove' (there's no plan to describe). */
  override_commission_plan_id?: string | null
  /** Snapshot of the plan's name when applied — stays correct even if the plan is later renamed or deactivated. null when override_action = 'remove'. */
  override_commission_plan_name?: string | null
}

export interface CommissionOverrideState {
  employeeId: string
  commissionPlanId: string
  commissionPlanName: string | null
}

/** The active override for one employee on this order, or null if none. */
export function getActiveCommissionOverride(
  log: CommissionManualAdjustmentLogEntry[],
  employeeId: string
): CommissionOverrideState | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i]!
    if (entry.employee_id !== employeeId || !entry.override_action) continue

    if (entry.override_action === 'remove') return null

    if (entry.override_commission_plan_id) {
      return {
        employeeId,
        commissionPlanId: entry.override_commission_plan_id,
        commissionPlanName: entry.override_commission_plan_name ?? null
      }
    }
    return null
  }
  return null
}

/**
 * Distinct plan ids referenced by currently-ACTIVE overrides anywhere in the
 * log — what a caller needs to resolve (via resolveCommissionPlanRules on
 * the server, or GET /api/commissions/:id/rules on the client) before
 * calling resolveEffectiveCommissionRules(). Scans every employee_id that
 * appears in the log, not just one.
 */
export function getActiveOverridePlanIds(log: CommissionManualAdjustmentLogEntry[]): string[] {
  const employeeIds = [...new Set(log.map(entry => entry.employee_id))]
  const planIds = new Set<string>()
  for (const employeeId of employeeIds) {
    const override = getActiveCommissionOverride(log, employeeId)
    if (override) planIds.add(override.commissionPlanId)
  }
  return [...planIds]
}

/**
 * The rules to actually use for each employee on this order: a PATCH of
 * their active override plan's rules (if any — looked up in
 * planRulesByPlanId, see getActiveOverridePlanIds() above for what that map
 * needs to contain) over their normal resolved plan rules — not a full
 * replacement. An override only ever covers some of the categories an
 * employee's standard plan(s) cover; categories it doesn't mention keep
 * using the standard rule. E.g. employee's standard plan has 9% on
 * "cabeçote" and 20% on "motor"; applying an override plan with just 15% on
 * "cabeçote" makes cabeçote items use 15%, but motor items keep 20% — the
 * override didn't touch that category, so there's nothing to patch.
 *
 * This falls out of getApplicableCommissionRule()'s existing "first
 * matching rule in the array wins" resolution for free: putting the
 * override's rules BEFORE the standard rules in the combined list means an
 * item's category resolves against the override first (specific rule, then
 * the override's own catch-all if it has one) and only reaches the standard
 * rules — specific, then its catch-all — when the override has neither. No
 * change needed in getApplicableCommissionRule()/computeEmployeeOrderCommission()
 * themselves.
 *
 * Callers use this in place of the raw rulesByEmployeeId map wherever they
 * compute commission for an existing order (release, item snapshot sync,
 * live preview) — never for a brand-new order that has no log yet.
 */
export function resolveEffectiveCommissionRules(
  rulesByEmployeeId: Map<string, ResolvedCommissionRule[]>,
  log: CommissionManualAdjustmentLogEntry[],
  planRulesByPlanId: Map<string, ResolvedCommissionRule[]>
): Map<string, ResolvedCommissionRule[]> {
  if (log.length === 0) return rulesByEmployeeId

  const result = new Map(rulesByEmployeeId)
  for (const employeeId of rulesByEmployeeId.keys()) {
    const override = getActiveCommissionOverride(log, employeeId)
    if (!override) continue

    const overrideRules = planRulesByPlanId.get(override.commissionPlanId) ?? []
    const standardRules = rulesByEmployeeId.get(employeeId) ?? []
    result.set(employeeId, [...overrideRules, ...standardRules])
  }
  return result
}
