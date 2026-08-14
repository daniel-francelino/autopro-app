// Shared per-item commission computation, used by the Sales Items report
// (server/api/reports/sales-items.get.ts) and the Employees report
// (server/api/reports/employees.get.ts) to resolve, for each service order
// line item, which employee(s) earn commission on it and how much.

import { roundMoney, normalizeId } from './report-helpers'

export interface CommissionEmployeeRecord {
  id: string
  name?: string | null
  has_commission?: boolean | null
  commission_type?: string | null
  commission_amount?: number | string | null
  commission_base?: string | null
  commission_categories?: unknown
}

export interface CommissionOrderRecord {
  id?: string | null
  employee_responsible_id?: string | null
  responsible_employees?: Array<{ employee_id?: string | null }> | null
  discount?: number | string | null
  total_taxes_amount?: number | string | null
}

export interface CommissionOrderItem {
  category_id?: string | null
  commissions?: Array<{ employee_id?: string | null, amount?: number | string | null }> | null
}

export interface CommissionFinancialRecord {
  employee_id?: string | null
  service_order_id?: string | null
  record_type?: string | null
  amount?: number | string | null
}

export function normalizeNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function isCommissionRecord(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'commission' || normalized === 'comissao'
}

export function normalizeCommissionType(value: unknown): 'percentage' | 'fixed_amount' | null {
  const type = String(value || '').trim().toLowerCase()
  if (['percentage', 'percentual'].includes(type)) return 'percentage'
  if (['fixed_amount', 'fixed', 'fixo', 'valor_fixo'].includes(type)) return 'fixed_amount'
  return null
}

export function normalizeCommissionBase(value: unknown): 'revenue' | 'profit' | null {
  const base = String(value || '').trim().toLowerCase()
  if (['profit', 'lucro'].includes(base)) return 'profit'
  if (['revenue', 'faturamento', 'receita', 'venda'].includes(base)) return 'revenue'
  return null
}

export function getEmployeeCommissionConfig(employee: CommissionEmployeeRecord) {
  const categories = Array.isArray(employee?.commission_categories)
    ? employee.commission_categories.map(item => String(item)).filter(Boolean)
    : []

  return {
    hasCommission: Boolean(employee?.has_commission),
    type: normalizeCommissionType(employee?.commission_type),
    base: normalizeCommissionBase(employee?.commission_base),
    value: normalizeNumber(employee?.commission_amount),
    categories
  }
}

export function buildCommissionTotalsByOrderEmployeeMap(records: CommissionFinancialRecord[]) {
  const totals = new Map<string, number>()

  for (const record of records) {
    const orderId = normalizeId(record?.service_order_id)
    const employeeId = normalizeId(record?.employee_id)
    if (!orderId || !employeeId) continue

    const key = `${orderId}::${employeeId}`
    totals.set(key, roundMoney(normalizeNumber(totals.get(key)) + normalizeNumber(record?.amount)))
  }

  return totals
}

export function buildOrdersWithPersistedCommissionSet(records: CommissionFinancialRecord[]) {
  const orderIds = new Set<string>()

  for (const record of records) {
    const orderId = normalizeId(record?.service_order_id)
    if (!orderId || normalizeNumber(record?.amount) <= 0) continue
    orderIds.add(orderId)
  }

  return orderIds
}

export function getResponsibles(order: CommissionOrderRecord, employeesMap: Map<string, CommissionEmployeeRecord>) {
  if (Array.isArray(order?.responsible_employees) && order.responsible_employees.length > 0) {
    const responsibles = order.responsible_employees
      .map((item) => {
        const employee = employeesMap.get(String(item?.employee_id || ''))
        return {
          id: employee?.id || String(item?.employee_id || ''),
          name: employee?.name || 'Responsável não encontrado'
        }
      })
      .filter(item => item.id)

    if (responsibles.length > 0) return responsibles
  }

  if (order?.employee_responsible_id) {
    const employee = employeesMap.get(String(order.employee_responsible_id))
    return [{
      id: employee?.id || String(order.employee_responsible_id),
      name: employee?.name || 'Responsável não encontrado'
    }]
  }

  return [] as Array<{ id: string, name: string }>
}

export function getItemResponsiblesFromCommissions(item: CommissionOrderItem, employeesMap: Map<string, CommissionEmployeeRecord>) {
  const commissions = Array.isArray(item?.commissions) ? item.commissions : []
  const unique = new Map<string, { id: string, name: string }>()

  for (const commission of commissions) {
    const employeeId = normalizeId(commission?.employee_id)
    if (!employeeId || unique.has(employeeId)) continue

    const employee = employeesMap.get(employeeId)
    unique.set(employeeId, {
      id: employee?.id || employeeId,
      name: employee?.name || 'Responsável não encontrado'
    })
  }

  return Array.from(unique.values())
}

export function computeEmployeeItemCommissions({
  employee,
  order,
  items
}: {
  employee: CommissionEmployeeRecord | undefined
  order: CommissionOrderRecord
  items: Array<{ key: string, categoryId: string | null, totalValue: number, totalCost: number }>
}) {
  const result = new Map<string, number>()
  items.forEach(item => result.set(item.key, 0))

  if (!employee) return result

  const config = getEmployeeCommissionConfig(employee)
  if (!config.hasCommission || !config.type || config.value <= 0 || items.length === 0) return result

  const eligibleItems = config.categories.length > 0
    ? items.filter(item => item.categoryId && config.categories.includes(item.categoryId))
    : items

  if (eligibleItems.length === 0) return result

  const orderDiscount = normalizeNumber(order?.discount)
  const orderTaxes = normalizeNumber(order?.total_taxes_amount)
  const allItemsSale = items.reduce((sum, item) => sum + normalizeNumber(item.totalValue), 0)
  const eligibleSale = eligibleItems.reduce((sum, item) => sum + normalizeNumber(item.totalValue), 0)
  const eligibleRatio = allItemsSale > 0 ? eligibleSale / allItemsSale : 0
  const eligibleDiscount = orderDiscount * eligibleRatio
  const eligibleTax = orderTaxes * eligibleRatio

  if (config.type === 'percentage') {
    for (const item of eligibleItems) {
      const sale = normalizeNumber(item.totalValue)
      const cost = normalizeNumber(item.totalCost)
      const fraction = eligibleSale > 0 ? sale / eligibleSale : 1 / eligibleItems.length
      const itemDiscount = eligibleDiscount * fraction
      const itemTax = eligibleTax * fraction

      let baseAmount = sale - itemDiscount
      if (config.base === 'profit') {
        baseAmount = Math.max(0, baseAmount - (cost + itemTax))
      }

      const value = roundMoney((baseAmount * config.value) / 100)
      if (value > 0) result.set(item.key, value)
    }

    return result
  }

  const perItem = roundMoney(config.value / eligibleItems.length)
  const distributed = roundMoney(perItem * eligibleItems.length)
  const diff = roundMoney(config.value - distributed)

  eligibleItems.forEach((item, index) => {
    const value = index === 0 ? roundMoney(perItem + diff) : perItem
    if (value > 0) result.set(item.key, value)
  })

  return result
}

export function computeOrderItemCommissionMap({
  order,
  responsibles,
  responsibleIdsSet,
  employeesMap,
  commissionTotalsByOrderEmployee,
  normalizedItems
}: {
  order: CommissionOrderRecord
  responsibles: Array<{ id: string, name: string }>
  responsibleIdsSet: Set<string>
  employeesMap: Map<string, CommissionEmployeeRecord>
  commissionTotalsByOrderEmployee: Map<string, number>
  normalizedItems: Array<{ key: string, categoryId: string | null, totalValue: number, totalCost: number }>
}) {
  const commissionByItemKey = new Map<string, number>()
  normalizedItems.forEach(item => commissionByItemKey.set(item.key, 0))

  const activeResponsibleIds = responsibleIdsSet.size > 0
    ? responsibles.map(item => item.id).filter(id => responsibleIdsSet.has(id))
    : responsibles.map(item => item.id)

  if (activeResponsibleIds.length === 0 || normalizedItems.length === 0) return commissionByItemKey

  for (const employeeId of activeResponsibleIds) {
    const employeeKey = `${normalizeId(order?.id) || 'order'}::${employeeId}`
    const persistedTotal = commissionTotalsByOrderEmployee.has(employeeKey)
      ? roundMoney(commissionTotalsByOrderEmployee.get(employeeKey) || 0)
      : 0

    if (persistedTotal <= 0) continue

    const employeeCommissions = computeEmployeeItemCommissions({
      employee: employeesMap.get(employeeId),
      order,
      items: normalizedItems
    })

    employeeCommissions.forEach((value, key) => {
      if (value > 0) {
        commissionByItemKey.set(key, roundMoney(normalizeNumber(commissionByItemKey.get(key)) + value))
      }
    })
  }

  return commissionByItemKey
}
