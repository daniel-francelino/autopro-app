// Pure commission-calculation logic for the standalone Commission Plan
// feature (Steps 2, 3, 6 and 8 of
// docs/finance/commissions-configuration-architecture.md — see
// docs/finance/commissions-step8-engine-cutover.md for the Step 8 cutover
// plan this file implements).
//
// Lives in shared/ (not server/utils/) specifically so it can be imported
// both by server engines (server/utils/service-order-*.ts) and by the
// frontend live preview (app/utils/service-orders.ts) — Nuxt 4's shared/
// directory is bundled for both the Nitro server and the Vue app. Nothing
// here touches Supabase; DB-fetch wrappers stay in
// server/utils/employee-commission-plans.ts, which imports what it needs
// from this file but does NOT re-export it — Nuxt auto-imports every export
// of both shared/utils/*.ts and server/utils/*.ts globally, so re-exporting
// the same names from both registered two global bindings for one symbol,
// which broke Nitro's production Rollup build. Every other file imports
// straight from here.
//
// Naming note: toMonthStart/currentMonthStart/resolveEffectiveVersion are
// prefixed with "Commission" below (unlike the rest of this file's exports)
// specifically because server/utils/bonuses.ts already exports its own
// functions with those exact bare names for the unrelated bonus feature —
// same collision problem as above (global auto-import, not a namespaced
// import), confirmed by `nuxt prepare`'s "Duplicated imports" warning.
// roundMoney is not exported at all: nothing outside this file imports it
// from here (every real caller already has its own from
// server/utils/report-helpers.ts), so keeping it unexported side-steps that
// collision instead of renaming it.

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
