// Shared types and pure helpers for the goal-based employee bonus feature.
// See docs/employee-bonus-feature-design.md for the full design rationale.
//
// Deliberately independent from the per-item/category commission engine
// (service-order-commissions.ts, service-order-item-commissions.ts,
// sales-item-commissions.ts, app/utils/service-orders.ts) — a bonus goal is
// evaluated as a simple monthly revenue/profit sum per employee, not a
// per-item calculation, so none of those are imported here.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientLike } from './supabase-pagination'
import { fetchAllOrganizationRows } from './supabase-pagination'
import { roundMoney, toNumber } from './report-helpers'

export type CommissionBase = 'revenue' | 'profit' | 'revenue_minus_parts' | 'employee_net_profit'

export interface BonusRecord {
  id: string
  organization_id: string
  name: string
  description: string | null
  active: boolean
  created_at?: string
  updated_at?: string
}

export interface BonusValueVersionRecord {
  id: string
  bonus_id: string
  commission_base: CommissionBase
  goal_amount: number | string
  bonus_amount: number | string
  effective_from: string
  created_at?: string
  created_by?: string | null
}

export interface BonusEmployeeAssignmentRecord {
  id: string
  bonus_id: string
  employee_id: string
  active: boolean
}

export interface BonusGenerationRecord {
  id: string
  bonus_id: string
  employee_id: string
  reference_month: string
  commission_base: CommissionBase
  goal_amount: number | string
  bonus_amount: number | string
  achieved_amount: number | string
  goal_met: boolean
  financial_record_id: string | null
  created_at?: string
}

interface ServiceOrderForBonus {
  id?: string | null
  status?: string | null
  employee_responsible_id?: string | null
  responsible_employees?: Array<{ employee_id?: string | null }> | null
  entry_date?: string | null
  total_amount?: number | string | null
  total_cost_amount?: number | string | null
}

export interface BonusCommissionRecord {
  employee_id?: string | null
  service_order_id?: string | null
  amount?: number | string | null
}

/** Always the 1st of the month, e.g. "2026-03-01". */
export function toMonthStart(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

export function currentMonthStart(): string {
  return toMonthStart(new Date())
}

export function monthDateRange(referenceMonth: string): { start: Date, end: Date } {
  const start = new Date(`${referenceMonth}T00:00:00`)
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

export function lastDayOfMonth(referenceMonth: string): string {
  const { end } = monthDateRange(referenceMonth)
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
}

/**
 * The version effective for a given month is the one with the greatest
 * effective_from <= referenceMonth — not necessarily the most recently
 * created row. Returns null if no version was effective yet by that month.
 */
export function resolveEffectiveVersion(
  versions: BonusValueVersionRecord[],
  referenceMonth: string
): BonusValueVersionRecord | null {
  const candidates = versions.filter(version => version.effective_from <= referenceMonth)
  if (candidates.length === 0) return null
  return candidates.reduce((latest, version) => (version.effective_from > latest.effective_from ? version : latest))
}

function isOrderResponsible(order: ServiceOrderForBonus, employeeId: string): boolean {
  if (String(order?.employee_responsible_id || '') === employeeId) return true
  const responsibles = Array.isArray(order?.responsible_employees) ? order.responsible_employees : []
  return responsibles.some(responsible => String(responsible?.employee_id || '') === employeeId)
}

function isOrderEligibleForBonus(order: ServiceOrderForBonus): boolean {
  return order?.status === 'completed' || order?.status === 'invoiced'
}

/**
 * Sums this employee's gross revenue (or net profit) from orders they're
 * responsible for, entered within the given month — the "X" in the bonus
 * progress "X/goal". Operates on an already-fetched orders array so callers
 * evaluating multiple employees/bonuses only fetch service_orders once.
 */
export function sumAchievedAmount(
  orders: ServiceOrderForBonus[],
  employeeId: string,
  referenceMonth: string,
  commissionBase: CommissionBase,
  commissionRecords: BonusCommissionRecord[] = []
): number {
  const { start, end } = monthDateRange(referenceMonth)

  const total = orders.reduce((sum, order) => {
    if (!isOrderEligibleForBonus(order)) return sum
    if (!isOrderResponsible(order, employeeId)) return sum
    const entryDate = order?.entry_date ? new Date(`${order.entry_date}T00:00:00`) : null
    if (!entryDate || Number.isNaN(entryDate.getTime())) return sum
    if (entryDate < start || entryDate > end) return sum

    const gross = toNumber(order?.total_amount, 0)
    const partsCost = toNumber(order?.total_cost_amount, 0)
    const employeeCommission = commissionRecords
      .filter(record =>
        String(record?.employee_id || '') === employeeId
        && String(record?.service_order_id || '') === String(order?.id || '')
      )
      .reduce((recordSum, record) => recordSum + toNumber(record?.amount, 0), 0)

    if (commissionBase === 'profit' || commissionBase === 'revenue_minus_parts') {
      return sum + (gross - partsCost)
    }

    if (commissionBase === 'employee_net_profit') {
      return sum + (gross - partsCost - employeeCommission)
    }
    return sum + gross
  }, 0)

  return roundMoney(total)
}

export async function fetchOrdersForBonusProgress(
  supabase: SupabaseClientLike,
  organizationId: string
): Promise<ServiceOrderForBonus[]> {
  return fetchAllOrganizationRows<ServiceOrderForBonus>(supabase, {
    table: 'service_orders',
    organizationId,
    columns: 'id, status, employee_responsible_id, responsible_employees, entry_date, total_amount, total_cost_amount',
    nullColumns: ['deleted_at']
  })
}

export async function fetchCommissionRecordsForBonusProgress(
  supabase: SupabaseClientLike,
  organizationId: string
): Promise<BonusCommissionRecord[]> {
  return fetchAllOrganizationRows<BonusCommissionRecord>(supabase, {
    table: 'employee_financial_records',
    organizationId,
    columns: 'employee_id, service_order_id, amount',
    nullColumns: ['deleted_at'],
    eq: { record_type: 'commission' }
  })
}

// The functions below need .maybeSingle(), which the minimal SupabaseClientLike
// interface (built only for fetchAllOrganizationRows' paginated SELECTs)
// doesn't expose — so they take the real client instead.

export async function fetchBonus(
  supabase: SupabaseClient,
  organizationId: string,
  bonusId: string
): Promise<BonusRecord | null> {
  const { data, error } = await supabase
    .from('bonuses')
    .select('*')
    .eq('id', bonusId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !data) return null
  return data as BonusRecord
}

export async function fetchBonusValueVersions(
  supabase: SupabaseClient,
  bonusId: string
): Promise<BonusValueVersionRecord[]> {
  const { data, error } = await supabase
    .from('bonus_value_versions')
    .select('*')
    .eq('bonus_id', bonusId)
    .order('effective_from', { ascending: false })

  if (error) throw new Error(error.message)
  return (data || []) as BonusValueVersionRecord[]
}

export async function fetchBonusAssignments(
  supabase: SupabaseClient,
  bonusId: string,
  activeOnly = true
): Promise<BonusEmployeeAssignmentRecord[]> {
  let query = supabase
    .from('bonus_employee_assignments')
    .select('*')
    .eq('bonus_id', bonusId)
    .is('deleted_at', null)

  if (activeOnly) query = query.eq('active', true)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data || []) as BonusEmployeeAssignmentRecord[]
}
