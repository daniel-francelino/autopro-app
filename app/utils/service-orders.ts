import type { ServiceOrderCommission, ServiceOrderEmployee, ServiceOrderItem, ServiceOrderRaw } from '~/types/service-orders'
import {
  computeEmployeeOrderCommission,
  toCommissionOrderItemInput,
  type ResolvedCommissionRule
} from '../../shared/utils/employee-commission-engine'

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

function getItemCost(item: ServiceOrderItem) {
  return toNumber(item.cost_price ?? item.cost_amount)
}

function getOrderSubtotal(order: ServiceOrderRaw) {
  return (order.items ?? []).reduce((total, item) => total + getItemTotal(item), 0)
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

export type ServiceOrderItemCommissionEntry = {
  total: number
  commissions: ServiceOrderItemCommission[]
}

export type ServiceOrderCommissionBreakdown = {
  byItemIndex: Map<number, ServiceOrderItemCommissionEntry>
  byEmployeeId: Map<string, ServiceOrderCommissionEstimate>
  total: number
}

function getEligibleItemEntries(order: ServiceOrderRaw, employee: ServiceOrderEmployee) {
  const items = order.items ?? []
  const commissionCategories = employee.commission_categories ?? []

  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (commissionCategories.length === 0) return true

      // Current app/server behavior: migrated/manual items without category stay eligible.
      return !item.category_id || commissionCategories.includes(item.category_id)
    })
}

export function computeServiceOrderResponsibleCommission(
  order: ServiceOrderRaw,
  employee: ServiceOrderEmployee | null | undefined,
  rulesByEmployeeId?: Map<string, ResolvedCommissionRule[]>
): ServiceOrderCommissionEstimate {
  const rules = employee?.id ? rulesByEmployeeId?.get(employee.id) : undefined
  if (!employee?.id || (!employee.has_commission && !rules?.length)) {
    return { value: 0, hasMatchingItems: true }
  }

  const singleEmployeeOrder = {
    ...order,
    responsible_employees: [{ employee_id: employee.id }]
  } as ServiceOrderRaw
  const breakdown = computeServiceOrderCommissionBreakdown(singleEmployeeOrder, [employee], rulesByEmployeeId)

  return breakdown.byEmployeeId.get(employee.id) ?? { value: 0, hasMatchingItems: true }
}

/**
 * Step 8 cutover (docs/finance/commissions-step8-engine-cutover.md §7.1): an
 * employee with a non-empty entry in `rulesByEmployeeId` is resolved
 * exclusively through the new commission-plan model — never falls back to
 * `employee.has_commission`/`commission_type`/etc, even if no item on this
 * order matches any of their rules. Only employees with no resolved rules
 * (or callers that don't pass `rulesByEmployeeId` at all, e.g. a component
 * that hasn't loaded them yet) use the legacy calculation below, unchanged.
 * Fetching `rulesByEmployeeId` is the caller's job — see
 * useEmployeeCommissionRules() — so this function stays synchronous.
 */
export function computeServiceOrderCommissionBreakdown(
  order: ServiceOrderRaw,
  employees: ServiceOrderEmployee[],
  rulesByEmployeeId?: Map<string, ResolvedCommissionRule[]>
): ServiceOrderCommissionBreakdown {
  const byItemIndex = new Map<number, ServiceOrderItemCommissionEntry>()
  const byEmployeeId = new Map<string, ServiceOrderCommissionEstimate>()
  const items = order.items ?? []
  const subtotal = getOrderSubtotal(order)
  const totalTaxesAmount = toNumber(order.total_taxes_amount)
  const discountAmount = toNumber(order.discount)
  const responsibleEmployees = order.responsible_employees ?? []

  items.forEach((_, index) => {
    byItemIndex.set(index, { total: 0, commissions: [] })
  })

  for (const responsible of responsibleEmployees) {
    const employee = employees.find(item => item.id === responsible.employee_id)
    if (!employee?.id) continue

    const rules = rulesByEmployeeId?.get(employee.id) ?? []

    if (rules.length > 0) {
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
          employee_id: employee.id,
          amount: matched.amount,
          commission_type: matched.rule.commission_type,
          commission_base: matched.rule.commission_base,
          commission_percentage: matched.rule.commission_type === 'percentage' ? matched.rule.commission_amount : null
        })
      })

      byEmployeeId.set(employee.id, { value: result.total, hasMatchingItems: result.hasMatchingItems })
      continue
    }

    if (!employee.has_commission) {
      byEmployeeId.set(employee.id, { value: 0, hasMatchingItems: true })
      continue
    }

    const eligibleItems = getEligibleItemEntries(order, employee)
    if (!eligibleItems.length) {
      byEmployeeId.set(employee.id, { value: 0, hasMatchingItems: false })
      continue
    }

    const commissionAmount = toNumber(employee.commission_amount)
    const eligibleSale = eligibleItems.reduce((total, { item }) => total + getItemTotal(item), 0)
    const eligibleRatio = subtotal > 0 ? eligibleSale / subtotal : 0
    const eligibleDiscount = discountAmount * eligibleRatio
    const eligibleTaxes = totalTaxesAmount * eligibleRatio
    let employeeTotal = 0

    if (employee.commission_type === 'percentage') {
      for (const { item, index } of eligibleItems) {
        const itemTotal = getItemTotal(item)
        const fraction = eligibleSale > 0 ? itemTotal / eligibleSale : 1 / eligibleItems.length
        const itemDiscount = eligibleDiscount * fraction
        const itemTaxes = eligibleTaxes * fraction
        let itemBase = itemTotal - itemDiscount

        if (employee.commission_base === 'profit') {
          itemBase = Math.max(0, itemBase - getItemCost(item) * toNumber(item.quantity) - itemTaxes)
        }

        const value = roundCurrency((itemBase * commissionAmount) / 100)
        const entry = byItemIndex.get(index)!
        entry.total = roundCurrency(entry.total + value)
        if (value > 0) {
          entry.commissions.push({
            employee_id: employee.id,
            amount: value,
            commission_type: employee.commission_type ?? null,
            commission_base: employee.commission_base ?? null,
            commission_percentage: commissionAmount
          })
        }
        employeeTotal = roundCurrency(employeeTotal + value)
      }
    } else {
      const perItemValue = roundCurrency(commissionAmount / eligibleItems.length)
      const distributedTotal = roundCurrency(perItemValue * eligibleItems.length)
      const remainder = roundCurrency(commissionAmount - distributedTotal)

      eligibleItems.forEach(({ index }, eligibleIndex) => {
        const value = eligibleIndex === 0 ? roundCurrency(perItemValue + remainder) : perItemValue
        const entry = byItemIndex.get(index)!
        entry.total = roundCurrency(entry.total + value)
        if (value > 0) {
          entry.commissions.push({
            employee_id: employee.id,
            amount: value,
            commission_type: employee.commission_type ?? null,
            commission_base: employee.commission_base ?? null,
            commission_percentage: null
          })
        }
        employeeTotal = roundCurrency(employeeTotal + value)
      })
    }

    byEmployeeId.set(employee.id, {
      value: employeeTotal,
      hasMatchingItems: eligibleSale > 0
    })
  }

  const total = Array.from(byEmployeeId.values()).reduce(
    (sum, commission) => roundCurrency(sum + commission.value),
    0
  )

  return { byItemIndex, byEmployeeId, total }
}

export function computeServiceOrderItemCommissionMap(
  order: ServiceOrderRaw,
  employees: ServiceOrderEmployee[]
) {
  const breakdown = computeServiceOrderCommissionBreakdown(order, employees)
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
