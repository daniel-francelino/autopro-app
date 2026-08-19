// DB-access layer for the standalone Commission Plan feature — Steps 2, 3, 6
// and 8 of docs/finance/commissions-configuration-architecture.md.
//
// A "commission plan" is created once in Financeiro > Comissões, carries a
// versioned set of rules (one per product category, plus an optional
// catch-all default rule), and is assigned to one or more employees. This
// mirrors the bonus feature's architecture (server/utils/bonuses.ts):
// identity + versioned values + assignments — but resolves per-category
// rules instead of a single monthly goal.
//
// The pure calculation logic (no Supabase) lives in
// shared/utils/employee-commission-engine.ts, re-exported below, so the
// frontend live preview (app/utils/service-orders.ts) can use the exact same
// rule-matching/amount code without pulling in server-only DB access. This
// file only adds the Supabase-backed fetch/insert wrappers around it.
//
// As of Step 8 (docs/finance/commissions-step8-engine-cutover.md), all 4
// legacy commission engines (server/utils/service-order-item-commissions.ts,
// service-order-commissions.ts, sales-item-commissions.ts,
// app/utils/service-orders.ts) call resolveEmployeeCommissionRules() below
// and fall back to the legacy employees.* columns only when an employee has
// no assigned plan — see each engine's own comments for its fallback point.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  currentMonthStart,
  resolveEffectiveVersion,
  type CommissionRuleType,
  type CommissionRuleBase,
  type CommissionRuleVersionRecord,
  type CommissionRuleRecord,
  type ResolvedCommissionRule
} from '../../shared/utils/employee-commission-engine'

export {
  roundMoney,
  toMonthStart,
  currentMonthStart,
  resolveEffectiveVersion,
  getApplicableCommissionRule,
  matchCommissionRule,
  computeCommissionAmount,
  buildCommissionSnapshot,
  computeEmployeeOrderCommission,
  getOrderItemQuantity,
  getOrderItemTotal,
  getOrderItemCost,
  toCommissionOrderItemInput
} from '../../shared/utils/employee-commission-engine'
export type {
  CommissionRuleType,
  CommissionRuleBase,
  CommissionRuleVersionRecord,
  CommissionRuleRecord,
  ResolvedCommissionRule,
  CommissionItemSnapshot,
  CommissionOrderItemInput,
  CommissionOrderItemResult,
  EmployeeOrderCommissionResult
} from '../../shared/utils/employee-commission-engine'

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
 * "motor consolidado" entry point Step 6 asks for, and the primary lookup
 * every Step 8 engine calls before deciding whether to use the new model or
 * fall back to the legacy employees.* columns (empty result = fall back).
 */
export async function resolveEmployeeCommissionRules(
  supabase: SupabaseClient,
  organizationId: string,
  employeeId: string,
  referenceDate: string = currentMonthStart()
): Promise<ResolvedCommissionRule[]> {
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

  const allRules: ResolvedCommissionRule[] = []
  for (const plan of plans || []) {
    const versions = await fetchCommissionRuleVersions(supabase, plan.id)
    const effectiveVersion = resolveEffectiveVersion(versions, referenceDate)
    if (!effectiveVersion) continue
    const rules = await fetchCommissionRulesForVersion(supabase, effectiveVersion.id)
    allRules.push(...rules.map(rule => ({ ...rule, plan_id: plan.id })))
  }
  return allRules
}

/**
 * Batched version of resolveEmployeeCommissionRules() for every responsible
 * employee of one order at once — avoids N sequential round-trips (assignments
 * → plans → versions → rules, per employee) when an order has several
 * responsibles. Employees with no assignment/plan get an empty array (the
 * caller's cue to fall back to the legacy calculation).
 */
export async function resolveEmployeeCommissionRulesForEmployees(
  supabase: SupabaseClient,
  organizationId: string,
  employeeIds: string[],
  referenceDate: string = currentMonthStart()
): Promise<Map<string, ResolvedCommissionRule[]>> {
  const result = new Map<string, ResolvedCommissionRule[]>()
  const uniqueEmployeeIds = [...new Set(employeeIds.filter(Boolean))]
  uniqueEmployeeIds.forEach(id => result.set(id, []))
  if (uniqueEmployeeIds.length === 0) return result

  const { data: assignments, error: assignmentsError } = await supabase
    .from('employee_commission_plan_assignments')
    .select('plan_id, employee_id')
    .in('employee_id', uniqueEmployeeIds)
    .eq('active', true)
    .is('deleted_at', null)

  if (assignmentsError) throw new Error(assignmentsError.message)

  const employeeIdsByPlan = new Map<string, string[]>()
  for (const row of (assignments || []) as { plan_id: string, employee_id: string }[]) {
    const list = employeeIdsByPlan.get(row.plan_id) ?? []
    list.push(row.employee_id)
    employeeIdsByPlan.set(row.plan_id, list)
  }

  const planIds = [...employeeIdsByPlan.keys()]
  if (planIds.length === 0) return result

  const { data: plans, error: plansError } = await supabase
    .from('employee_commission_plans')
    .select('id')
    .in('id', planIds)
    .eq('organization_id', organizationId)
    .eq('active', true)
    .is('deleted_at', null)

  if (plansError) throw new Error(plansError.message)

  for (const plan of plans || []) {
    const versions = await fetchCommissionRuleVersions(supabase, plan.id)
    const effectiveVersion = resolveEffectiveVersion(versions, referenceDate)
    if (!effectiveVersion) continue
    const rules = await fetchCommissionRulesForVersion(supabase, effectiveVersion.id)
    const resolvedRules: ResolvedCommissionRule[] = rules.map(rule => ({ ...rule, plan_id: plan.id }))

    for (const employeeId of employeeIdsByPlan.get(plan.id) ?? []) {
      const existing = result.get(employeeId) ?? []
      result.set(employeeId, [...existing, ...resolvedRules])
    }
  }

  return result
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
      throw new Error(`Regra ${index + 1}: categoryIds é obrigatório para uma regra que não é padrão`)
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
    throw new Error('No máximo uma regra pode ser marcada como padrão por versão')
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
