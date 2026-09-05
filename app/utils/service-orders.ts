import type { ServiceOrderCommission, ServiceOrderEmployee, ServiceOrderItem, ServiceOrderRaw } from '~/types/service-orders'
import {
  computeEmployeeOrderCommission,
  toCommissionOrderItemInput,
  type ResolvedCommissionRule
} from '../../lib/utils/employee-commission-engine'

// ─── Status maps ──────────────────────────────────────────────────────────────

export const STATUS_COLOR: Record<string, string> = {
  estimate: 'neutral',
  open: 'info',
  in_progress: 'warning',
  waiting_for_part: 'warning',
  completed: 'success',
  invoiced: 'primary',
  delivered: 'success',
  cancelled: 'error'
}

export const STATUS_LABEL: Record<string, string> = {
  estimate: 'Orçamento',
  open: 'Aberta',
  in_progress: 'Em andamento',
  waiting_for_part: 'Aguard. peça',
  completed: 'Concluída',
  invoiced: 'Faturada',
  delivered: 'Entregue',
  cancelled: 'Cancelada'
}

export const STATUS_ICON: Record<string, string> = {
  estimate: 'i-lucide-file-text',
  open: 'i-lucide-circle-dot',
  in_progress: 'i-lucide-wrench',
  waiting_for_part: 'i-lucide-clock',
  completed: 'i-lucide-circle-check',
  invoiced: 'i-lucide-file-badge',
  delivered: 'i-lucide-truck',
  cancelled: 'i-lucide-x-circle'
}

export const PAYMENT_STATUS_COLOR: Record<string, string> = {
  pending: 'warning',
  paid: 'success',
  partial: 'info'
}

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  partial: 'Parcial'
}

export const PAYMENT_STATUS_ICON: Record<string, string> = {
  pending: 'i-lucide-clock',
  paid: 'i-lucide-circle-check',
  partial: 'i-lucide-circle-half'
}

// ─── Advance status map ───────────────────────────────────────────────────────

export type AdvanceInfo = { label: string, icon: string, color: 'info' | 'warning' | 'success' }

export const ADVANCE_STATUS_MAP: Record<string, AdvanceInfo> = {
  estimate: { label: 'Abrir OS', icon: 'i-lucide-circle-dot', color: 'info' },
  open: { label: 'Iniciar', icon: 'i-lucide-wrench', color: 'warning' },
  in_progress: { label: 'Concluir', icon: 'i-lucide-circle-check', color: 'success' }
}

export const EDITABLE_ORDER_STATUSES = ['estimate', 'open', 'in_progress', 'waiting_for_part'] as const

export function canEditServiceOrder(status: string | null | undefined, paymentStatus: string | null | undefined) {
  const s = status ?? ''

  if (s === 'completed') {
    return paymentStatus !== 'paid' && paymentStatus !== 'partial'
  }

  return EDITABLE_ORDER_STATUSES.includes(s as (typeof EDITABLE_ORDER_STATUSES)[number])
    && paymentStatus === 'pending'
}

export function getNextStatus(status: string): string | null {
  if (status === 'estimate') return 'open'
  if (status === 'open') return 'in_progress'
  if (status === 'in_progress') return 'completed'
  return null
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function formatCurrency(value: number | string | null | undefined) {
  return parseFloat(String(value || 0)).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const parts = value.split('-')
  if (parts.length !== 3) return value
  const [y, m, d] = parts
  return `${d}/${m}/${y}`
}

export function formatPhone(value: string | null | undefined) {
  if (!value) return '—'
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  if (digits.length === 11) return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  return value
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2))
}

export function getItemTotal(item: ServiceOrderItem) {
  return toNumber(item.total_price ?? item.total_amount) || toNumber(item.unit_price) * toNumber(item.quantity)
}

export function formatTaxId(value: string | null | undefined) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return value || '—'
}

export function formatZipCode(value: string | null | undefined) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length === 8) return digits.replace(/(\d{5})(\d{3})/, '$1-$2')
  return value || '—'
}

export type ServiceOrderCommissionEstimate = {
  value: number
  hasMatchingItems: boolean
}

export type ServiceOrderItemCommission = {
  employee_id: string
  amount: number
  commission_type: string | null
  commission_base: string | null
  commission_percentage: number | null
}

/** e.g. "10% • Faturamento" or "Valor fixo • Lucro" — the rule that generated one commission line, for display next to its amount. */
export function formatCommissionRuleSublabel(commission: {
  commission_type: string | null
  commission_base: string | null
  commission_percentage: number | null
}) {
  const baseLabel = commission.commission_base === 'profit' ? 'Lucro' : 'Faturamento'
  return commission.commission_type === 'percentage'
    ? `${commission.commission_percentage}% • ${baseLabel}`
    : `Valor fixo • ${baseLabel}`
}

export type ServiceOrderItemCommissionEntry = {
  total: number
  commissions: ServiceOrderItemCommission[]
}

export type ServiceOrderCommissionBreakdown = {
  byItemIndex: Map<number, ServiceOrderItemCommissionEntry>
  byEmployeeId: Map<string, ServiceOrderCommissionEstimate>
  total: number
}

export function computeServiceOrderResponsibleCommission(
  order: ServiceOrderRaw,
  employee: ServiceOrderEmployee | null | undefined,
  rulesByEmployeeId: Map<string, ResolvedCommissionRule[]>
): ServiceOrderCommissionEstimate {
  if (!employee?.id) return { value: 0, hasMatchingItems: true }

  const singleEmployeeOrder = {
    ...order,
    responsible_employees: [{ employee_id: employee.id }]
  } as ServiceOrderRaw
  const breakdown = computeServiceOrderCommissionBreakdown(singleEmployeeOrder, rulesByEmployeeId)

  return breakdown.byEmployeeId.get(employee.id) ?? { value: 0, hasMatchingItems: true }
}

/**
 * Step 10 (docs/finance/commissions-configuration-architecture.md): resolved
 * exclusively through `rulesByEmployeeId` (fetched by the caller via
 * useEmployeeCommissionRules(), so this stays synchronous) — an employee
 * with no entry (or an empty one) simply earns nothing on this order. The
 * legacy employee.has_commission/commission_type/commission_amount/
 * commission_base/commission_categories fallback this function used during
 * the Step 8 cutover was removed along with those columns; see
 * docs/finance/commissions-step8-engine-cutover.md §6 for the fallback this
 * replaces.
 */
export function computeServiceOrderCommissionBreakdown(
  order: ServiceOrderRaw,
  rulesByEmployeeId: Map<string, ResolvedCommissionRule[]>
): ServiceOrderCommissionBreakdown {
  const byItemIndex = new Map<number, ServiceOrderItemCommissionEntry>()
  const byEmployeeId = new Map<string, ServiceOrderCommissionEstimate>()
  const items = order.items ?? []
  const totalTaxesAmount = toNumber(order.total_taxes_amount)
  const discountAmount = toNumber(order.discount)
  const responsibleEmployees = order.responsible_employees ?? []

  items.forEach((_, index) => {
    byItemIndex.set(index, { total: 0, commissions: [] })
  })

  for (const responsible of responsibleEmployees) {
    const employeeId = responsible.employee_id
    if (!employeeId) continue

    const rules = rulesByEmployeeId.get(employeeId) ?? []
    if (rules.length === 0) {
      byEmployeeId.set(employeeId, { value: 0, hasMatchingItems: true })
      continue
    }

    const commissionOrderItems = items.map(item => toCommissionOrderItemInput({
      category_id: item.category_id ?? null,
      quantity: item.quantity,
      total_price: item.total_price ?? null,
      total_amount: item.total_amount,
      unit_price: item.unit_price,
      cost_price: item.cost_price ?? null,
      cost_amount: item.cost_amount
    }))

    const result = computeEmployeeOrderCommission(rules, commissionOrderItems, {
      discount: discountAmount,
      totalTaxesAmount
    })

    result.perItem.forEach((matched, index) => {
      const entry = byItemIndex.get(index)!
      if (!matched || matched.amount <= 0) return
      entry.total = roundCurrency(entry.total + matched.amount)
      entry.commissions.push({
        employee_id: employeeId,
        amount: matched.amount,
        commission_type: matched.rule.commission_type,
        commission_base: matched.rule.commission_base,
        commission_percentage: matched.rule.commission_type === 'percentage' ? matched.rule.commission_amount : null
      })
    })

    byEmployeeId.set(employeeId, { value: result.total, hasMatchingItems: result.hasMatchingItems })
  }

  const total = Array.from(byEmployeeId.values()).reduce(
    (sum, commission) => roundCurrency(sum + commission.value),
    0
  )

  return { byItemIndex, byEmployeeId, total }
}

export function computeServiceOrderItemCommissionMap(
  order: ServiceOrderRaw,
  rulesByEmployeeId: Map<string, ResolvedCommissionRule[]>
) {
  const breakdown = computeServiceOrderCommissionBreakdown(order, rulesByEmployeeId)
  const commissionByItemIndex = new Map<number, number>()

  for (const [index, entry] of breakdown.byItemIndex) {
    commissionByItemIndex.set(index, entry.total)
  }

  return commissionByItemIndex
}

export function sumStoredItemCommissionsForEmployee(
  items: ServiceOrderItem[] | null | undefined,
  employeeId: string
) {
  return (items ?? []).reduce((sum, item) => {
    return sum + (item.commissions ?? [])
      .filter(commission => commission.employee_id === employeeId)
      .reduce((itemSum, commission) => itemSum + toNumber(commission.amount), 0)
  }, 0)
}

export function sumFinancialCommissionsForEmployee(
  commissions: ServiceOrderCommission[] | null | undefined,
  employeeId: string
) {
  return (commissions ?? [])
    .filter(commission => commission.employee_id === employeeId)
    .reduce((sum, commission) => sum + toNumber(commission.amount), 0)
}
