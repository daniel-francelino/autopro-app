// Shared computation for the Employees report (server/api/reports/employees.get.ts
// and server/api/reports/export-employees.post.ts): orders worked, commissions and
// sold items for a single employee, over a date range. Reuses the same filter
// semantics as /api/reports/commissions (order status/payment status/payment method
// filter which orders count; commission status/record type filter only the
// commission records), scoped to exactly one employee at a time.

import { fetchAllOrganizationRows } from './supabase-pagination'
import type { SupabaseClientLike } from './supabase-pagination'
import { parseDateStart, parseDateEnd, normalizeReportStatus, normalizeId, roundMoney, toNumber } from './report-helpers'
import {
  normalizeNumber,
  isCommissionRecord,
  buildCommissionTotalsByOrderEmployeeMap,
  buildOrdersWithPersistedCommissionSet,
  getResponsibles,
  getItemResponsiblesFromCommissions,
  computeOrderItemCommissionMap
} from './sales-item-commissions'

interface ClientRecord {
  id: string
  name?: string | null
}

interface EmployeeRecord {
  id: string
  name?: string | null
}

interface CategoryRecord {
  id: string
  name?: string | null
}

interface ResponsibleEmployee {
  employee_id?: string | null
}

interface ServiceOrderItem {
  product_id?: string | null
  category_id?: string | null
  description?: string | null
  name?: string | null
  quantity?: number | string | null
  cost_amount?: number | string | null
  total_amount?: number | string | null
  unit_price?: number | string | null
  commission_total?: number | string | null
  commissions?: Array<{ employee_id?: string | null, amount?: number | string | null }> | null
}

interface ServiceOrderRecord {
  id?: string | null
  number?: string | number | null
  client_id?: string | null
  employee_responsible_id?: string | null
  responsible_employees?: ResponsibleEmployee[] | null
  status?: string | null
  payment_status?: string | null
  payment_method?: string | null
  entry_date?: string | null
  total_amount?: number | string | null
  total_cost_amount?: number | string | null
  discount?: number | string | null
  total_taxes_amount?: number | string | null
  items?: ServiceOrderItem[] | null
}

interface EmployeeFinancialRecord {
  id: string
  employee_id?: string | null
  service_order_id?: string | null
  record_type?: string | null
  amount?: number | string | null
  status?: string | null
  reference_date?: string | null
  description?: string | null
}

export interface EmployeeReportFilters {
  dateFrom?: string
  dateTo?: string
  employeeId?: string
  orderStatusFilters: string[]
  paymentStatusFilters: string[]
  paymentMethods: string[]
  commissionStatus: string[]
  recordType: string[]
}

export interface EmployeeOrderRow {
  id: string
  number: string
  entryDate: string | null
  clientName: string
  status: string | null
  paymentStatus: 'paid' | 'pending' | 'cancelled' | null
  totalAmount: number
  totalCostAmount: number
  employeeCommission: number
  otherEmployeesCommission: number
  netAmount: number
}

export interface EmployeeCommissionRow {
  id: string
  referenceDate: string | null
  description: string | null
  orderId: string | null
  orderNumber: string | null
  orderStatus: string | null
  orderPaymentStatus: 'paid' | 'pending' | 'cancelled' | null
  amount: number
  status: 'paid' | 'pending' | 'cancelled'
  recordType: string | null
}

export interface EmployeeItemRow {
  id: string
  orderId: string
  orderNumber: string
  date: string | null
  itemDescription: string
  categoryName: string
  quantity: number
  totalValue: number
  totalCost: number
  commissionCost: number
  otherEmployeesCommissionCost: number
  profit: number
}

export interface EmployeeReportSummary {
  grossSales: number
  osExpenses: number
  totalCommissions: number
  otherEmployeesCommissions: number
  netSales: number
  orderCount: number
}

export interface EmployeeReportResult {
  employee: { id: string, name: string } | null
  employees: Array<{ value: string, label: string }>
  summary: EmployeeReportSummary | null
  ordersView: EmployeeOrderRow[]
  commissionsView: EmployeeCommissionRow[]
  itemsView: EmployeeItemRow[]
}

export async function getEmployeeReport(
  supabase: SupabaseClientLike,
  organizationId: string,
  filters: EmployeeReportFilters
): Promise<EmployeeReportResult> {
  const dateFrom = parseDateStart(filters.dateFrom)
  const dateTo = parseDateEnd(filters.dateTo)
  const employeeId = String(filters.employeeId || '').trim()
  const { orderStatusFilters, paymentStatusFilters, paymentMethods, commissionStatus, recordType } = filters

  const [orders, employees, clients, categories, financialRecords] = await Promise.all([
    fetchAllOrganizationRows<ServiceOrderRecord>(supabase, {
      table: 'service_orders',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'entry_date' }
    }),
    fetchAllOrganizationRows<EmployeeRecord>(supabase, {
      table: 'employees',
      organizationId,
      columns: 'id, name',
      nullColumns: ['deleted_at']
    }),
    fetchAllOrganizationRows<ClientRecord>(supabase, {
      table: 'clients',
      organizationId,
      columns: 'id, name',
      nullColumns: ['deleted_at']
    }),
    fetchAllOrganizationRows<CategoryRecord>(supabase, {
      table: 'product_categories',
      organizationId,
      columns: 'id, name',
      nullColumns: ['deleted_at']
    }),
    fetchAllOrganizationRows<EmployeeFinancialRecord>(supabase, {
      table: 'employee_financial_records',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'reference_date' }
    })
  ])

  const employeesMap = new Map<string, EmployeeRecord>(employees.map(employee => [String(employee.id), employee]))
  const clientsMap = new Map<string, ClientRecord>(clients.map(client => [String(client.id), client]))
  const categoriesMap = new Map<string, CategoryRecord>(categories.map(category => [String(category.id), category]))

  const employeesOptions = employees
    .map(employee => ({ value: employee.id, label: employee.name || 'Sem nome' }))
    .sort((employeeA, employeeB) => employeeA.label.localeCompare(employeeB.label, 'pt-BR', { sensitivity: 'base' }))

  if (!employeeId) {
    return {
      employee: null,
      employees: employeesOptions,
      summary: null,
      ordersView: [],
      commissionsView: [],
      itemsView: []
    }
  }

  const selectedEmployee = employeesMap.get(employeeId) ?? null

  function orderPassesFilters(order: ServiceOrderRecord): boolean {
    const entryDate = order?.entry_date ? new Date(`${order.entry_date}T00:00:00`) : null
    if (!entryDate || Number.isNaN(entryDate.getTime())) return false
    if (dateFrom && entryDate < dateFrom) return false
    if (dateTo && entryDate > dateTo) return false
    if (orderStatusFilters.length > 0 && !orderStatusFilters.includes(String(order?.status || ''))) return false
    if (paymentStatusFilters.length > 0 && !paymentStatusFilters.includes(normalizeReportStatus(order?.payment_status))) return false
    if (paymentMethods.length > 0 && !paymentMethods.includes(String(order?.payment_method || 'no_payment'))) return false
    return true
  }

  function isEmployeeResponsible(order: ServiceOrderRecord): boolean {
    return getResponsibles(order, employeesMap).some(responsible => responsible.id === employeeId)
  }

  const matchingOrders = orders.filter(order => orderPassesFilters(order) && isEmployeeResponsible(order))
  const ordersMap = new Map<string, ServiceOrderRecord>(
    orders
      .map(order => [normalizeId(order.id), order] as const)
      .filter((entry): entry is [string, ServiceOrderRecord] => entry[0] !== null)
  )

  const matchingCommissionRecords = financialRecords.filter((record) => {
    if (String(record?.employee_id || '') !== employeeId) return false

    // Bonus records (server/utils/... generated by the bonus feature, see
    // docs/finance/bonuses-feature-design.md) aren't tied to a service order
    // — service_order_id is null — so they can't be filtered by order
    // status/payment like a commission. Filter those by their own
    // reference_date against the selected period instead of requiring an
    // order that passes orderPassesFilters().
    if (String(record?.record_type || '') === 'bonus') {
      const referenceDate = record?.reference_date ? new Date(`${record.reference_date}T00:00:00`) : null
      if (!referenceDate || Number.isNaN(referenceDate.getTime())) return false
      if (dateFrom && referenceDate < dateFrom) return false
      if (dateTo && referenceDate > dateTo) return false
    } else {
      const orderId = normalizeId(record?.service_order_id)
      const order = orderId ? ordersMap.get(orderId) : null
      if (!order || !orderPassesFilters(order)) return false
    }

    if (commissionStatus.length > 0 && !commissionStatus.includes(normalizeReportStatus(record?.status))) return false
    if (recordType.length > 0 && !recordType.includes(String(record?.record_type || ''))) return false
    return true
  })

  // ─── "Itens vendidos" view (reuses the sales-items commission-per-item logic) ──
  // Computed before the summary below so grossSales/osExpenses can be derived
  // from it — same convention as the sales-items report cards (sum of the
  // items actually attributed to this employee), not the full order totals,
  // since an order can have multiple responsibles splitting its items.

  const commissionRecordsForItems = financialRecords.filter(record => isCommissionRecord(record.record_type) && normalizeNumber(record.amount) > 0)
  const commissionTotalsByOrderEmployee = buildCommissionTotalsByOrderEmployeeMap(commissionRecordsForItems)
  const ordersWithPersistedCommission = buildOrdersWithPersistedCommissionSet(commissionRecordsForItems)
  const responsibleIdsSet = new Set([employeeId])

  const itemsView: EmployeeItemRow[] = []

  for (const order of matchingOrders) {
    const orderId = normalizeId(order.id) || ''
    const items = Array.isArray(order.items) ? order.items : []
    const responsibles = getResponsibles(order, employeesMap)

    const normalizedItems = items.map((item, index) => {
      const categoryId = normalizeId(item?.category_id)
      const categoryName = categoryId ? categoriesMap.get(categoryId)?.name || 'Sem categoria' : 'Sem categoria'
      const quantity = toNumber(item?.quantity, 1)
      const totalCost = roundMoney(toNumber(item?.cost_amount, 0) * quantity)
      const totalValue = roundMoney(toNumber(item?.total_amount, 0) || (toNumber(item?.unit_price, 0) * quantity))
      return { key: `${orderId}_${index}`, rawItem: item, categoryId, categoryName, quantity, totalCost, totalValue }
    })

    const hasPersistedCommissionRecords = ordersWithPersistedCommission.has(orderId)
    const hasStoredCommissions = normalizedItems.length > 0
      && normalizedItems.every(item => item.rawItem?.commission_total != null && Array.isArray(item.rawItem?.commissions))

    // Same 3-tier priority as the selected employee's own commission, just
    // parameterized by which employee id(s) to attribute it to — reused here
    // both for the selected employee and for "everyone else responsible".
    function computeItemCommissionsFor(targetEmployeeIds: Set<string>): Map<string, number> {
      if (targetEmployeeIds.size === 0 || !hasPersistedCommissionRecords) {
        return new Map(normalizedItems.map(item => [item.key, 0]))
      }
      if (hasStoredCommissions) {
        const map = new Map<string, number>()
        for (const item of normalizedItems) {
          const commissions = Array.isArray(item.rawItem?.commissions) ? item.rawItem.commissions : []
          let total = 0
          for (const commission of commissions) {
            const commissionEmployeeId = String(commission?.employee_id || '')
            if (commissionEmployeeId && targetEmployeeIds.has(commissionEmployeeId)) total += normalizeNumber(commission?.amount)
          }
          map.set(item.key, roundMoney(total))
        }
        return map
      }
      return computeOrderItemCommissionMap({
        order,
        responsibles,
        responsibleIdsSet: targetEmployeeIds,
        employeesMap,
        commissionTotalsByOrderEmployee,
        normalizedItems: normalizedItems.map(item => ({
          key: item.key,
          categoryId: item.categoryId,
          totalValue: item.totalValue,
          totalCost: item.totalCost
        }))
      })
    }

    const otherResponsibleIdsSet = new Set(responsibles.map(responsible => responsible.id).filter(id => id !== employeeId))
    const commissionByItemKey = computeItemCommissionsFor(responsibleIdsSet)
    const otherCommissionByItemKey = computeItemCommissionsFor(otherResponsibleIdsSet)

    for (const item of normalizedItems) {
      const itemResponsiblesFromCommissions = getItemResponsiblesFromCommissions(item.rawItem, employeesMap)
      const itemResponsibles = itemResponsiblesFromCommissions.length > 0 ? itemResponsiblesFromCommissions : responsibles
      if (!itemResponsibles.some(responsible => responsible.id === employeeId)) continue

      const commissionCost = roundMoney(normalizeNumber(commissionByItemKey.get(item.key)))
      const otherEmployeesCommissionCost = roundMoney(normalizeNumber(otherCommissionByItemKey.get(item.key)))
      const profit = roundMoney(item.totalValue - item.totalCost - commissionCost)

      itemsView.push({
        id: item.key,
        orderId,
        orderNumber: order.number != null ? String(order.number) : '-',
        date: order.entry_date || null,
        itemDescription: String(item.rawItem?.description || item.rawItem?.name || 'Item sem descrição'),
        categoryName: item.categoryName,
        quantity: item.quantity,
        totalValue: item.totalValue,
        totalCost: item.totalCost,
        commissionCost,
        otherEmployeesCommissionCost,
        profit
      })
    }
  }

  itemsView.sort((itemA, itemB) => String(itemB.date || '').localeCompare(String(itemA.date || '')))

  // ─── Summary (4 totals, "Pelas OS" profit formula scoped to one employee) ──

  const matchingOrderIds = new Set(
    matchingOrders
      .map(order => normalizeId(order.id))
      .filter((id): id is string => id !== null)
  )

  // On items with more than one responsible employee, grossSales/osExpenses
  // (summed from itemsView) count each item in full for every responsible —
  // same convention as the sales-items report, no splitting. This means
  // netSales only discounts THIS employee's commission, not what the order
  // also paid out to co-responsible employees. Surfaced separately (not
  // folded into netSales) so it stays clear whose number is whose.
  const otherEmployeesCommissionRecords = financialRecords.filter((record) => {
    const recordEmployeeId = String(record?.employee_id || '')
    if (!recordEmployeeId || recordEmployeeId === employeeId) return false
    const orderId = normalizeId(record?.service_order_id)
    if (!orderId || !matchingOrderIds.has(orderId)) return false
    if (commissionStatus.length > 0 && !commissionStatus.includes(normalizeReportStatus(record?.status))) return false
    if (recordType.length > 0 && !recordType.includes(String(record?.record_type || ''))) return false
    return true
  })

  const grossSales = roundMoney(itemsView.reduce((sum, item) => sum + item.totalValue, 0))
  const osExpenses = roundMoney(itemsView.reduce((sum, item) => sum + item.totalCost, 0))
  // Excludes bonus on purpose, even when the "Bônus" record-type filter is
  // selected (which lets bonus rows into matchingCommissionRecords for
  // display) — this summary total represents commission specifically, never
  // blended with bonus amounts.
  const totalCommissions = roundMoney(
    matchingCommissionRecords
      .filter(record => String(record?.record_type || '') === 'commission')
      .reduce((sum, record) => sum + toNumber(record?.amount, 0), 0)
  )
  const otherEmployeesCommissions = roundMoney(otherEmployeesCommissionRecords.reduce((sum, record) => sum + toNumber(record?.amount, 0), 0))
  const netSales = roundMoney(grossSales - osExpenses - totalCommissions)

  const summary: EmployeeReportSummary = {
    grossSales,
    osExpenses,
    totalCommissions,
    otherEmployeesCommissions,
    netSales,
    orderCount: matchingOrders.length
  }

  const commissionsByOrderId = new Map<string, number>()
  for (const record of matchingCommissionRecords) {
    const orderId = normalizeId(record?.service_order_id)
    if (!orderId) continue
    commissionsByOrderId.set(orderId, roundMoney(normalizeNumber(commissionsByOrderId.get(orderId)) + toNumber(record?.amount, 0)))
  }

  const otherEmployeesCommissionsByOrderId = new Map<string, number>()
  for (const record of otherEmployeesCommissionRecords) {
    const orderId = normalizeId(record?.service_order_id)
    if (!orderId) continue
    otherEmployeesCommissionsByOrderId.set(orderId, roundMoney(normalizeNumber(otherEmployeesCommissionsByOrderId.get(orderId)) + toNumber(record?.amount, 0)))
  }

  // ─── "OS trabalhadas" view ──────────────────────────────────────────────────

  const ordersView: EmployeeOrderRow[] = matchingOrders
    .map((order) => {
      const orderId = normalizeId(order.id) || ''
      const clientId = normalizeId(order.client_id)
      const clientName = clientId ? clientsMap.get(clientId)?.name || 'Cliente sem nome' : 'Cliente sem nome'
      const totalAmount = roundMoney(toNumber(order.total_amount, 0))
      const totalCostAmount = roundMoney(toNumber(order.total_cost_amount, 0))
      const employeeCommission = roundMoney(commissionsByOrderId.get(orderId) || 0)
      const otherEmployeesCommission = roundMoney(otherEmployeesCommissionsByOrderId.get(orderId) || 0)
      const netAmount = roundMoney(totalAmount - totalCostAmount - employeeCommission)

      return {
        id: orderId,
        number: order.number != null ? String(order.number) : '-',
        entryDate: order.entry_date || null,
        clientName,
        status: order.status || null,
        paymentStatus: order.payment_status ? normalizeReportStatus(order.payment_status) : null,
        totalAmount,
        totalCostAmount,
        employeeCommission,
        otherEmployeesCommission,
        netAmount
      }
    })
    .sort((orderA, orderB) => String(orderB.entryDate || '').localeCompare(String(orderA.entryDate || '')))

  // ─── "Comissões" view ───────────────────────────────────────────────────────

  const commissionsView: EmployeeCommissionRow[] = matchingCommissionRecords
    .map((record) => {
      const orderId = normalizeId(record?.service_order_id)
      const order = orderId ? ordersMap.get(orderId) : null

      return {
        id: String(record.id),
        referenceDate: record.reference_date || null,
        description: record.description || null,
        orderId,
        orderNumber: order?.number != null ? String(order.number) : null,
        orderStatus: order?.status || null,
        orderPaymentStatus: order?.payment_status ? normalizeReportStatus(order.payment_status) : null,
        amount: roundMoney(toNumber(record.amount, 0)),
        status: normalizeReportStatus(record.status),
        recordType: record.record_type || null
      }
    })
    .sort((recordA, recordB) => String(recordB.referenceDate || '').localeCompare(String(recordA.referenceDate || '')))

  return {
    employee: selectedEmployee ? { id: selectedEmployee.id, name: selectedEmployee.name || 'Funcionário' } : null,
    employees: employeesOptions,
    summary,
    ordersView,
    commissionsView,
    itemsView
  }
}
