// Shared types and helpers for the standalone Commission Plan feature —
// Steps 2, 3 and 6 of docs/finance/commissions-configuration-architecture.md.
//
// A "commission plan" is created once in Financeiro > Comissões, carries a
// versioned set of rules (one per product category, plus an optional
// catch-all default rule), and is assigned to one or more employees. This
// mirrors the bonus feature's architecture (server/utils/bonuses.ts):
// identity + versioned values + assignments — but resolves per-category
// rules instead of a single monthly goal.
//
// Nothing in this file is called by the 4 legacy commission engines
// (server/utils/service-order-item-commissions.ts, service-order-commissions.ts,
// sales-item-commissions.ts, app/utils/service-orders.ts) yet — that cutover
// is Steps 7-10 of the design doc, explicitly out of scope for now. This file
// only needs to be correct and testable in isolation (Step 6).

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundMoney } from './report-helpers'

export type CommissionRuleType = 'percentage' | 'fixed_amount'
export type CommissionRuleBase = 'revenue' | 'profit'

export interface CommissionPlanRecord {
  id: string
  organization_id: string
  name: string
  description: string | null
  active: boolean
  created_at?: string
  updated_at?: string
}

export interface CommissionPlanAssignmentRecord {
  id: string
  plan_id: string
  employee_id: string
  active: boolean
  created_at?: string
}

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

/** Always the 1st of the month, e.g. "2026-03-01". */
export function toMonthStart(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

export function currentMonthStart(): string {
  return toMonthStart(new Date())
}

/**
 * The version effective for a given date is the one with the greatest
 * effective_from <= referenceDate — not necessarily the most recently
 * created row (same resolution rule as bonus_value_versions). Returns null
 * if no version was effective yet by that date.
 */
export function resolveEffectiveVersion(
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
 *   2. Otherwise fall back to the default (catch-all) rule, if any.
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
 * Computes the commission value for one rule match.
 *
 * - 'percentage': rate applied over the item/order's revenue or profit
 *   (caller decides what those mean — full item value, or an already
 *   prorated slice of it), per rule.commission_base.
 * - 'fixed_amount': a flat R$ value PER UNIT matched, independent of the
 *   item's price — commission_amount * quantity. This is the precise
 *   semantics decided for fixed_amount rules (as opposed to the legacy
 *   engines' two conflicting interpretations — prorated-per-order vs.
 *   flat-per-order — see docs/employee-multiple-commission-rules-analysis.md
 *   §2.3): "R$20 per tire sold", not "R$20 per order that has a tire".
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

// ─── Fetch helpers ──────────────────────────────────────────────────────────
// These need .maybeSingle()/.order(), so they take the real SupabaseClient
// rather than the minimal SupabaseClientLike used by paginated list fetches.

export async function fetchCommissionPlan(
  supabase: SupabaseClient,
  organizationId: string,
  planId: string
): Promise<CommissionPlanRecord | null> {
  const { data, error } = await supabase
    .from('employee_commission_plans')
    .select('*')
    .eq('id', planId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !data) return null
  return data as CommissionPlanRecord
}

export async function fetchCommissionPlanAssignments(
  supabase: SupabaseClient,
  planId: string,
  activeOnly = true
): Promise<CommissionPlanAssignmentRecord[]> {
  let query = supabase
    .from('employee_commission_plan_assignments')
    .select('*')
    .eq('plan_id', planId)
    .is('deleted_at', null)

  if (activeOnly) query = query.eq('active', true)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data || []) as CommissionPlanAssignmentRecord[]
}

export async function fetchCommissionRuleVersions(
  supabase: SupabaseClient,
  planId: string
): Promise<CommissionRuleVersionRecord[]> {
  const { data, error } = await supabase
    .from('employee_commission_rule_versions')
    .select('*')
    .eq('plan_id', planId)
    .order('effective_from', { ascending: false })

  if (error) throw new Error(error.message)
  return (data || []) as CommissionRuleVersionRecord[]
}

/** Loads every rule of a version, joined with its category assignments. */
export async function fetchCommissionRulesForVersion(
  supabase: SupabaseClient,
  versionId: string
): Promise<CommissionRuleRecord[]> {
  const { data: rules, error: rulesError } = await supabase
    .from('employee_commission_rules')
    .select('*')
    .eq('version_id', versionId)
    .order('sort_order', { ascending: true })

  if (rulesError) throw new Error(rulesError.message)
  if (!rules?.length) return []

  const { data: categoryRows, error: categoriesError } = await supabase
    .from('employee_commission_rule_categories')
    .select('rule_id, category_id')
    .in('rule_id', rules.map(rule => rule.id))

  if (categoriesError) throw new Error(categoriesError.message)

  const categoryIdsByRule = new Map<string, string[]>()
  for (const row of categoryRows || []) {
    const list = categoryIdsByRule.get(row.rule_id) ?? []
    list.push(row.category_id)
    categoryIdsByRule.set(row.rule_id, list)
  }

  return rules.map(rule => ({
    ...rule,
    commission_amount: Number(rule.commission_amount),
    category_ids: categoryIdsByRule.get(rule.id) ?? []
  })) as CommissionRuleRecord[]
}

/** Loads every rule for every version of a plan, keyed by version_id. */
export async function fetchCommissionRulesForPlan(
  supabase: SupabaseClient,
  versions: CommissionRuleVersionRecord[]
): Promise<Map<string, CommissionRuleRecord[]>> {
  const rulesByVersion = new Map<string, CommissionRuleRecord[]>()
  await Promise.all(versions.map(async (version) => {
    rulesByVersion.set(version.id, await fetchCommissionRulesForVersion(supabase, version.id))
  }))
  return rulesByVersion
}

/**
 * Every plan currently assigned+active to an employee, together with the
 * rules of each plan's version effective for referenceDate. This is the
 * "motor consolidado" entry point Step 6 asks for — flattening this across
 * plans and calling getApplicableCommissionRule() on the result is how a
 * future OS calculation (Step 8, out of scope here) would resolve one item.
 */
export async function resolveEmployeeCommissionRules(
  supabase: SupabaseClient,
  organizationId: string,
  employeeId: string,
  referenceDate: string = currentMonthStart()
): Promise<CommissionRuleRecord[]> {
  const { data: assignments, error: assignmentsError } = await supabase
    .from('employee_commission_plan_assignments')
    .select('plan_id')
    .eq('employee_id', employeeId)
    .eq('active', true)
    .is('deleted_at', null)

  if (assignmentsError) throw new Error(assignmentsError.message)
  const planIds = [...new Set((assignments || []).map(row => row.plan_id as string))]
  if (planIds.length === 0) return []

  const { data: plans, error: plansError } = await supabase
    .from('employee_commission_plans')
    .select('id')
    .in('id', planIds)
    .eq('organization_id', organizationId)
    .eq('active', true)
    .is('deleted_at', null)

  if (plansError) throw new Error(plansError.message)

  const allRules: CommissionRuleRecord[] = []
  for (const plan of plans || []) {
    const versions = await fetchCommissionRuleVersions(supabase, plan.id)
    const effectiveVersion = resolveEffectiveVersion(versions, referenceDate)
    if (!effectiveVersion) continue
    const rules = await fetchCommissionRulesForVersion(supabase, effectiveVersion.id)
    allRules.push(...rules)
  }
  return allRules
}

export interface ParsedCommissionRuleInput {
  name: string | null
  commissionType: CommissionRuleType
  commissionAmount: number
  commissionBase: CommissionRuleBase | null
  isDefault: boolean
  categoryIds: string[]
  sortOrder: number
}

const VALID_COMMISSION_TYPES: CommissionRuleType[] = ['percentage', 'fixed_amount']
const VALID_COMMISSION_BASES: CommissionRuleBase[] = ['revenue', 'profit']

/**
 * Validates and normalizes the `rules` array of a create-plan/create-version
 * request body. Throws a descriptive Error (callers map it to a 400) rather
 * than an h3 createError, so it stays reusable outside HTTP handlers.
 *
 * Enforces, within this one rule set (one version): every rule has a valid
 * type/amount/base, at most one is_default rule, non-default rules carry at
 * least one category, and no category is repeated across rules — the
 * "validações necessárias" listed in section 4.5 of the design doc.
 */
export function parseCommissionRulesInput(rawRules: unknown): ParsedCommissionRuleInput[] {
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    throw new Error('Informe ao menos uma regra de comissão')
  }

  const parsed: ParsedCommissionRuleInput[] = []
  const seenCategoryIds = new Set<string>()
  let defaultCount = 0

  rawRules.forEach((raw, index) => {
    const body = (raw ?? {}) as Record<string, unknown>

    const commissionType = body.commissionType
    if (typeof commissionType !== 'string' || !VALID_COMMISSION_TYPES.includes(commissionType as CommissionRuleType)) {
      throw new Error(`Regra ${index + 1}: commissionType deve ser "percentage" ou "fixed_amount"`)
    }

    const commissionAmount = Number(body.commissionAmount)
    if (!Number.isFinite(commissionAmount) || commissionAmount <= 0) {
      throw new Error(`Regra ${index + 1}: commissionAmount deve ser um número maior que zero`)
    }
    if (commissionType === 'percentage' && commissionAmount > 100) {
      throw new Error(`Regra ${index + 1}: commissionAmount percentual não pode ser maior que 100`)
    }

    // commissionBase only makes sense for a rate applied over revenue/profit.
    // A fixed_amount rule is a flat R$ per unit, independent of either — the
    // field is ignored (stored as null) for that type.
    let commissionBase: CommissionRuleBase | null = null
    if (commissionType === 'percentage') {
      if (typeof body.commissionBase !== 'string' || !VALID_COMMISSION_BASES.includes(body.commissionBase as CommissionRuleBase)) {
        throw new Error(`Regra ${index + 1}: commissionBase deve ser "revenue" ou "profit"`)
      }
      commissionBase = body.commissionBase as CommissionRuleBase
    }

    const isDefault = body.isDefault === true
    if (isDefault) defaultCount += 1

    const rawCategoryIds = Array.isArray(body.categoryIds) ? body.categoryIds : []
    const categoryIds = [...new Set(rawCategoryIds.map(id => String(id)).filter(Boolean))]

    if (!isDefault && categoryIds.length === 0) {
      throw new Error(`Regra ${index + 1}: categoryIds é obrigatório para uma regra que não é padrão (catch-all)`)
    }

    for (const categoryId of categoryIds) {
      if (seenCategoryIds.has(categoryId)) {
        throw new Error(`Categoria repetida entre regras desta versão (regra ${index + 1})`)
      }
      seenCategoryIds.add(categoryId)
    }

    parsed.push({
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null,
      commissionType: commissionType as CommissionRuleType,
      commissionAmount,
      commissionBase,
      isDefault,
      categoryIds: isDefault ? [] : categoryIds,
      sortOrder: index
    })
  })

  if (defaultCount > 1) {
    throw new Error('No máximo uma regra pode ser marcada como padrão (catch-all) por versão')
  }

  return parsed
}

/**
 * Inserts a new rule version (+ its rules + rule categories) for a plan in
 * one call. On any failure after the version row is created, the version is
 * deleted again (cascades to rules/rule_categories) so a half-written
 * version never lingers — same "insert, best-effort cleanup on failure"
 * pattern used by POST /api/bonuses for bonus + first value version.
 */
export async function insertCommissionRuleVersion(
  supabase: SupabaseClient,
  planId: string,
  options: { effectiveFrom: string, notes?: string | null, createdBy?: string | null },
  parsedRules: ParsedCommissionRuleInput[]
): Promise<{ version: CommissionRuleVersionRecord, rules: CommissionRuleRecord[] }> {
  const { data: version, error: versionError } = await supabase
    .from('employee_commission_rule_versions')
    .insert({
      plan_id: planId,
      effective_from: options.effectiveFrom,
      notes: options.notes ?? null,
      created_by: options.createdBy ?? null
    })
    .select()
    .single()

  if (versionError || !version) {
    throw new Error(`Failed to create rule version: ${versionError?.message}`)
  }

  try {
    const { data: insertedRules, error: rulesError } = await supabase
      .from('employee_commission_rules')
      .insert(parsedRules.map(rule => ({
        version_id: version.id,
        name: rule.name,
        commission_type: rule.commissionType,
        commission_amount: rule.commissionAmount,
        commission_base: rule.commissionBase,
        is_default: rule.isDefault,
        sort_order: rule.sortOrder
      })))
      .select()

    if (rulesError || !insertedRules) {
      throw new Error(`Failed to create rules: ${rulesError?.message}`)
    }

    const categoryRows: { rule_id: string, category_id: string }[] = []
    insertedRules
      .sort((a, b) => a.sort_order - b.sort_order)
      .forEach((rule, index) => {
        for (const categoryId of parsedRules[index]?.categoryIds ?? []) {
          categoryRows.push({ rule_id: rule.id, category_id: categoryId })
        }
      })

    if (categoryRows.length > 0) {
      const { error: categoriesError } = await supabase
        .from('employee_commission_rule_categories')
        .insert(categoryRows)

      if (categoriesError) {
        throw new Error(`Failed to link rule categories: ${categoriesError.message}`)
      }
    }

    const rules = insertedRules.map((rule, index) => ({
      ...rule,
      commission_amount: Number(rule.commission_amount),
      category_ids: parsedRules[index]?.categoryIds ?? []
    })) as CommissionRuleRecord[]

    return { version: version as CommissionRuleVersionRecord, rules }
  } catch (error) {
    await supabase.from('employee_commission_rule_versions').delete().eq('id', version.id)
    throw error
  }
}

export interface CommissionConflict {
  type: 'category' | 'default'
  categoryId?: string
}

/**
 * Checks whether the rules of a candidate plan version would conflict with
 * the rules already effective (for referenceDate) across an employee's
 * OTHER active plan assignments — same category covered twice, or two
 * catch-all (default) rules at once. Used by the assignment endpoint
 * (Step 3) before letting a plan be assigned to an employee.
 */
export function findCommissionConflicts(
  candidateRules: CommissionRuleRecord[],
  existingRules: CommissionRuleRecord[]
): CommissionConflict[] {
  const conflicts: CommissionConflict[] = []

  const existingCategoryIds = new Set(existingRules.flatMap(rule => rule.category_ids))
  const candidateCategoryIds = new Set(candidateRules.flatMap(rule => rule.category_ids))
  for (const categoryId of candidateCategoryIds) {
    if (existingCategoryIds.has(categoryId)) conflicts.push({ type: 'category', categoryId })
  }

  const existingHasDefault = existingRules.some(rule => rule.is_default)
  const candidateHasDefault = candidateRules.some(rule => rule.is_default)
  if (existingHasDefault && candidateHasDefault) conflicts.push({ type: 'default' })

  return conflicts
}
