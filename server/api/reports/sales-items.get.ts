import { defineEventHandler, getQuery } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchAllOrganizationRows } from '../../utils/supabase-pagination'
import type { SupabaseClientLike } from '../../utils/supabase-pagination'
import { parseDateRange, toNumber, roundMoney, paginate, sortFactor, normalizeReportStatus, formatStatusLabel, normalizeId } from '../../utils/report-helpers'
import { enforceReportAccess } from '../../utils/license'
import {
  normalizeNumber,
  isCommissionRecord,
  buildCommissionTotalsByOrderEmployeeMap,
  buildOrdersWithPersistedCommissionSet,
  getResponsibles,
  getItemResponsiblesFromCommissions,
  computeOrderItemCommissionMap
} from '../../utils/sales-item-commissions'

interface ClientRecord {
  id: string
  name?: string | null
}

interface EmployeeRecord {
  id: string
  name?: string | null
}

interface ProductRecord {
  id: string
  name?: string | null
  unit_cost_price?: number | string | null
  category_id?: string | null
}

interface CategoryRecord {
  id: string
  name?: string | null
}

interface CommissionRecord {
  employee_id?: string | null
  amount?: number | string | null
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
  commissions?: CommissionRecord[] | null
}

interface ResponsibleEmployee {
  employee_id?: string | null
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
}

interface ExpandedItemRow {
  id: string
  orderId: string
  clientId: string | null
  client: string
  orderNumber: string
  itemDescription: string
  quantity: number
  unitCost: number
  totalCost: number
  commissionCost: number
  totalCostWithCommission: number
  totalValue: number
  profit: number
  responsible: string
  status: string
  paymentStatus: string
  paymentMethod: string
  date: string
  categoryId: string | null
  categoryName: string
  costSource: 'item' | 'product' | 'none'
}

interface GroupedOrderRow {
  id: string
  orderId: string
  clientId: string | null
  client: string
  orderNumber: string
  quantity: number
  totalCost: number
  commissionCost: number
  totalCostWithCommission: number
  totalValue: number
  profit: number
  responsible: string
  status: string
  paymentStatus: string
  paymentMethod: string
  date: string
  itemCount: number
}

interface SalesItemDetailData {
  mode: 'item' | 'os'
  id: string
  orderId: string
  currentItemId: string | null
  orderNumber: string
  client: string
  responsible: string
  status: string
  paymentStatus: string
  paymentMethod: string
  date: string
  categoryName: string
  costSource: string
  itemDescription: string
  quantity: number
  unitCost: number
  totalCost: number
  commissionCost: number
  totalCostWithCommission: number
  totalValue: number
  profit: number
  itemCount: number
  items: ExpandedItemRow[]
}

const sortableFields = new Set([
  'client',
  'orderNumber',
  'itemDescription',
  'categoryName',
  'quantity',
  'totalValue',
  'totalCost',
  'commissionCost',
  'profit',
  'responsible',
  'status',
  'paymentStatus',
  'date',
  'itemCount'
])

function parseFilterList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value
      .map(item => String(item || '').trim())
      .filter(item => item && !['all', 'todos', 'null', 'undefined'].includes(item))))
  }

  if (typeof value === 'string') {
    const normalized = value.trim()
    if (!normalized || ['all', 'todos', '[]', '[ ]', 'null', 'undefined'].includes(normalized)) return []

    if (normalized.startsWith('[') && normalized.endsWith(']')) {
      try {
        return parseFilterList(JSON.parse(normalized))
      } catch {
        return []
      }
    }

    if (normalized.includes(',')) {
      return Array.from(new Set(normalized
        .split(',')
        .map(item => item.trim())
        .filter(item => item && !['all', 'todos', 'null', 'undefined'].includes(item))))
    }

    return [normalized].filter(item => !['all', 'todos', 'null', 'undefined'].includes(item))
  }

  return []
}

function mergeFilterLists(...values: unknown[]): string[] {
  return Array.from(new Set(values.flatMap(value => parseFilterList(value))))
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const reportSupabase = supabase as unknown as SupabaseClientLike
  const organizationId = await resolveOrganizationId(event, authUser.id)
  await enforceReportAccess(organizationId, 'sales-items')

  const query = getQuery(event)

  const dateFrom = parseDateStart(query.dateFrom as string)
  const dateTo = parseDateEnd(query.dateTo as string)
  const clientIds = mergeFilterLists(query.clientIds, query.clientId)
  const orderIds = mergeFilterLists(query.orderIds, query.orderId)
  const responsibleIds = mergeFilterLists(query.responsibleIds, query.responsibleId)
  const statusFilters = mergeFilterLists(query.statusFilters, query.status)
  const paymentStatusFilters = mergeFilterLists(query.paymentStatusFilters)
  const paymentMethodFilters = mergeFilterLists(query.paymentMethodFilters, query.paymentMethods, query.formasPagamento)
  const categoryIds = mergeFilterLists(query.categoryIds, query.categoryId)
  const costFilters = mergeFilterLists(query.costFilters, query.costFilter)
  const costSources = mergeFilterLists(query.costSources, query.costSource)
  const searchTerm = String(query.searchTerm || '').trim().toLowerCase()
  const viewMode = query.viewMode === 'os' ? 'os' : 'item'
  const sortBy = sortableFields.has(String(query.sortBy || '')) ? String(query.sortBy) : 'date'
  const sortOrder: 'asc' | 'desc' = query.sortOrder === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Math.floor(toNumber(query.page, 1)))
  const pageSize = Math.min(100, Math.max(1, Math.floor(toNumber(query.pageSize, 20))))
  const includeDetails = query.includeDetails === 'true'
  const selectedItemId = String(query.selectedItemId || '').trim()
  const selectedOrderId = String(query.selectedOrderId || '').trim()

  const clientIdsSet = new Set(clientIds)
  const orderIdsSet = new Set(orderIds)
  const responsibleIdsSet = new Set(responsibleIds)
  const statusFiltersSet = new Set(statusFilters)
  const paymentStatusFiltersSet = new Set(paymentStatusFilters)
  const paymentMethodFiltersSet = new Set(paymentMethodFilters)
  const categoryIdsSet = new Set(categoryIds)
  const costFiltersSet = new Set(costFilters.filter(value => value === 'withCost' || value === 'zeroCost'))
  const costSourcesSet = new Set(costSources.filter(value => value === 'item' || value === 'product' || value === 'none'))

  const [orders, clients, employees, products, categories, employeeFinancialRecords] = await Promise.all([
    fetchAllOrganizationRows<ServiceOrderRecord>(reportSupabase, {
      table: 'service_orders',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'entry_date' }
    }),
    fetchAllOrganizationRows<ClientRecord>(reportSupabase, {
      table: 'clients',
      organizationId,
      columns: 'id, name',
      nullColumns: ['deleted_at']
    }),
    fetchAllOrganizationRows<EmployeeRecord>(reportSupabase, {
      table: 'employees',
      organizationId,
      columns: 'id, name',
      nullColumns: ['deleted_at']
    }),
    fetchAllOrganizationRows<ProductRecord>(reportSupabase, {
      table: 'products',
      organizationId,
      columns: 'id, name, unit_cost_price, category_id',
      nullColumns: ['deleted_at']
    }),
    fetchAllOrganizationRows<CategoryRecord>(reportSupabase, {
      table: 'product_categories',
      organizationId,
      columns: 'id, name',
      nullColumns: ['deleted_at']
    }),
    fetchAllOrganizationRows<EmployeeFinancialRecord>(reportSupabase, {
      table: 'employee_financial_records',
      organizationId,
      columns: 'id, employee_id, service_order_id, record_type, amount',
      nullColumns: ['deleted_at'],
      order: { column: 'reference_date' }
    })
  ])

  const clientsMap = new Map<string, ClientRecord>(clients.map(client => [String(client.id), client]))
  const employeesMap = new Map<string, EmployeeRecord>(employees.map(employee => [String(employee.id), employee]))
  const productsMap = new Map<string, ProductRecord>(products.map(product => [String(product.id), product]))
  const categoriesMap = new Map<string, CategoryRecord>(categories.map(category => [String(category.id), category]))
  const commissionRecords = employeeFinancialRecords.filter(record => isCommissionRecord(record.record_type) && normalizeNumber(record.amount) > 0)
  const commissionTotalsByOrderEmployee = buildCommissionTotalsByOrderEmployeeMap(commissionRecords)
  const ordersWithPersistedCommission = buildOrdersWithPersistedCommissionSet(commissionRecords)

  let filteredOrders = orders.filter((order) => {
    if (statusFiltersSet.size > 0 && !statusFiltersSet.has(String(order?.status || ''))) return false
    if (paymentStatusFiltersSet.size > 0 && !paymentStatusFiltersSet.has(normalizeReportStatus(order?.payment_status))) return false
    if (paymentMethodFiltersSet.size > 0 && !paymentMethodFiltersSet.has(String(order?.payment_method || 'no_payment'))) return false

    const clientId = normalizeId(order?.client_id)
    const clientName = clientId ? clientsMap.get(clientId)?.name || 'Cliente sem nome' : 'Cliente sem nome'
    if (clientIdsSet.size > 0) {
      const clientCandidates = [clientId, `name:${clientName.toLowerCase()}`].filter(Boolean) as string[]
      if (!clientCandidates.some(candidate => clientIdsSet.has(candidate))) return false
    }

    const orderId = normalizeId(order?.id)
    const orderNumber = String(order?.number || '-')
    if (orderIdsSet.size > 0) {
      const orderCandidates = [orderId, `number:${orderNumber}`].filter(Boolean) as string[]
      if (!orderCandidates.some(candidate => orderIdsSet.has(candidate))) return false
    }

    const entryDate = order?.entry_date ? new Date(`${order.entry_date}T00:00:00`) : null
    if ((dateFrom || dateTo) && (!entryDate || Number.isNaN(entryDate.getTime()))) return false
    if (dateFrom && entryDate && entryDate < dateFrom) return false
    if (dateTo && entryDate && entryDate > dateTo) return false

    return true
  })

  if (responsibleIdsSet.size > 0) {
    filteredOrders = filteredOrders.filter((order) => {
      const responsibles = getResponsibles(order, employeesMap)
      const items = Array.isArray(order?.items) ? order.items : []
      const storedItemResponsibleIds = new Set(items.flatMap(item => getItemResponsiblesFromCommissions(item, employeesMap).map(responsible => responsible.id)))
      const effectiveResponsibleIds = storedItemResponsibleIds.size > 0
        ? Array.from(storedItemResponsibleIds)
        : responsibles.map(responsible => responsible.id)

      return effectiveResponsibleIds.some(id => responsibleIdsSet.has(id))
    })
  }

  let expandedItems: ExpandedItemRow[] = []

  for (const order of filteredOrders) {
    const orderId = String(order?.id || '')
    if (!orderId) continue

    const items = Array.isArray(order?.items) ? order.items : []
    const clientId = order?.client_id ? String(order.client_id) : null
    const client = clientId ? clientsMap.get(clientId)?.name || 'Cliente sem nome' : 'Cliente sem nome'
    const orderNumber = String(order?.number || '-')
    const status = String(order?.status || '')
    const paymentStatus = normalizeReportStatus(order?.payment_status)
    const paymentMethod = String(order?.payment_method || 'no_payment')
    const date = String(order?.entry_date || '')
    const responsibles = getResponsibles(order, employeesMap)

    const normalizedItems = items.map((item, index) => {
      const product = item?.product_id ? productsMap.get(String(item.product_id)) : null
      const categoryId = normalizeId(item?.category_id) ?? normalizeId(product?.category_id)
      const categoryName = categoryId ? categoriesMap.get(categoryId)?.name || 'Sem categoria' : 'Sem categoria'
      const quantity = toNumber(item?.quantity, 1)
      const hasItemCost = item?.cost_amount != null && String(item.cost_amount) !== ''
      const hasProductCost = product?.unit_cost_price != null && String(product.unit_cost_price) !== ''
      const costSource: 'item' | 'product' | 'none' = hasItemCost
        ? 'item'
        : hasProductCost
          ? 'product'
          : 'none'
      const unitCost = hasItemCost ? toNumber(item?.cost_amount, 0) : toNumber(product?.unit_cost_price, 0)
      const totalCost = roundMoney(unitCost * quantity)
      const totalCostForCommission = roundMoney(toNumber(item?.cost_amount, 0) * quantity)
      const totalValue = roundMoney(toNumber(item?.total_amount, 0) || (toNumber(item?.unit_price, 0) * quantity))

      return {
        key: `${orderId}_${index}`,
        rawItem: item,
        categoryId,
        categoryName,
        quantity,
        unitCost,
        totalCost,
        totalCostForCommission,
        totalValue,
        costSource
      }
    })

    const hasPersistedCommissionRecords = ordersWithPersistedCommission.has(orderId)
    const hasStoredCommissions = normalizedItems.length > 0
      && normalizedItems.every(item => item.rawItem?.commission_total != null && Array.isArray(item.rawItem?.commissions))

    let commissionByItemKey = new Map<string, number>()
    if (!hasPersistedCommissionRecords) {
      commissionByItemKey = new Map(normalizedItems.map(item => [item.key, 0]))
    } else if (hasStoredCommissions) {
      for (const item of normalizedItems) {
        const commissions = Array.isArray(item.rawItem?.commissions) ? item.rawItem.commissions : []
        let total = 0

        if (responsibleIdsSet.size > 0) {
          for (const commission of commissions) {
            if (responsibleIdsSet.has(String(commission?.employee_id || ''))) {
              total += normalizeNumber(commission?.amount)
            }
          }
        } else {
          total = normalizeNumber(item.rawItem?.commission_total)
        }

        commissionByItemKey.set(item.key, roundMoney(total))
      }
    } else {
      commissionByItemKey = computeOrderItemCommissionMap({
        order,
        responsibles,
        responsibleIdsSet,
        employeesMap,
        commissionTotalsByOrderEmployee,
        normalizedItems: normalizedItems.map(item => ({
          key: item.key,
          categoryId: item.categoryId,
          totalValue: item.totalValue,
          totalCost: item.totalCostForCommission
        }))
      })
    }

    for (const item of normalizedItems) {
      if (categoryIdsSet.size > 0 && !item.categoryId) continue
      if (categoryIdsSet.size > 0 && item.categoryId && !categoryIdsSet.has(item.categoryId)) continue

      if (costFiltersSet.size === 1) {
        if (costFiltersSet.has('withCost') && !(item.totalCost > 0)) continue
        if (costFiltersSet.has('zeroCost') && !(item.totalCost <= 0)) continue
      }

      if (costSourcesSet.size > 0 && costSourcesSet.size < 3 && !costSourcesSet.has(item.costSource)) continue

      const itemResponsiblesFromCommissions = getItemResponsiblesFromCommissions(item.rawItem, employeesMap)
      const itemResponsibles = itemResponsiblesFromCommissions.length > 0 ? itemResponsiblesFromCommissions : responsibles
      if (responsibleIdsSet.size > 0 && !itemResponsibles.some(responsible => responsibleIdsSet.has(responsible.id))) continue

      const commissionCost = roundMoney(normalizeNumber(commissionByItemKey.get(item.key)))
      const totalCost = item.totalCost
      const totalValue = item.totalValue
      const totalCostWithCommission = roundMoney(totalCost + commissionCost)
      const profit = roundMoney(totalValue - totalCostWithCommission)
      const responsible = itemResponsibles.length > 0
        ? itemResponsibles.map(responsibleItem => responsibleItem.name).join(', ')
        : 'Sem responsável'

      expandedItems.push({
        id: item.key,
        orderId,
        clientId,
        client,
        orderNumber,
        itemDescription: String(item.rawItem?.description || item.rawItem?.name || 'Item sem descrição'),
        quantity: item.quantity,
        unitCost: item.unitCost,
        totalCost,
        commissionCost,
        totalCostWithCommission,
        totalValue,
        profit,
        responsible,
        status,
        paymentStatus,
        paymentMethod,
        date,
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        costSource: item.costSource
      })
    }
  }

  if (searchTerm) {
    expandedItems = expandedItems.filter(item =>
      item.client.toLowerCase().includes(searchTerm)
      || item.orderNumber.toLowerCase().includes(searchTerm)
      || item.itemDescription.toLowerCase().includes(searchTerm)
      || item.responsible.toLowerCase().includes(searchTerm)
      || item.categoryName.toLowerCase().includes(searchTerm)
    )
  }

  const groupedOrdersMap = new Map<string, GroupedOrderRow>()
  for (const item of expandedItems) {
    const existing = groupedOrdersMap.get(item.orderId)
    if (!existing) {
      groupedOrdersMap.set(item.orderId, {
        id: item.orderId,
        orderId: item.orderId,
        clientId: item.clientId,
        client: item.client,
        orderNumber: item.orderNumber,
        quantity: item.quantity,
        totalCost: item.totalCost,
        commissionCost: item.commissionCost,
        totalCostWithCommission: item.totalCostWithCommission,
        totalValue: item.totalValue,
        profit: item.profit,
        responsible: item.responsible,
        status: item.status,
        paymentStatus: item.paymentStatus,
        paymentMethod: item.paymentMethod,
        date: item.date,
        itemCount: 1
      })
      continue
    }

    existing.quantity += item.quantity
    existing.totalCost = roundMoney(existing.totalCost + item.totalCost)
    existing.commissionCost = roundMoney(existing.commissionCost + item.commissionCost)
    existing.totalCostWithCommission = roundMoney(existing.totalCostWithCommission + item.totalCostWithCommission)
    existing.totalValue = roundMoney(existing.totalValue + item.totalValue)
    existing.profit = roundMoney(existing.profit + item.profit)
    existing.itemCount += 1

    const currentResponsibles = new Set(existing.responsible.split(',').map(name => name.trim()).filter(Boolean))
    for (const responsible of item.responsible.split(',')) {
      const trimmed = responsible.trim()
      if (trimmed) currentResponsibles.add(trimmed)
    }
    existing.responsible = Array.from(currentResponsibles).join(', ')
  }

  const tableItems: Array<ExpandedItemRow | GroupedOrderRow> = viewMode === 'os'
    ? Array.from(groupedOrdersMap.values())
    : expandedItems

  const factor = sortFactor(sortOrder)
  tableItems.sort((itemA, itemB) => {
    if (sortBy === 'client') return String(itemA.client).localeCompare(String(itemB.client), 'pt-BR', { sensitivity: 'base' }) * factor
    if (sortBy === 'orderNumber') return String(itemA.orderNumber).localeCompare(String(itemB.orderNumber), 'pt-BR', { sensitivity: 'base' }) * factor
    if (sortBy === 'itemDescription') return String('itemDescription' in itemA ? itemA.itemDescription : '').localeCompare(String('itemDescription' in itemB ? itemB.itemDescription : ''), 'pt-BR', { sensitivity: 'base' }) * factor
    if (sortBy === 'categoryName') return String('categoryName' in itemA ? itemA.categoryName : '').localeCompare(String('categoryName' in itemB ? itemB.categoryName : ''), 'pt-BR', { sensitivity: 'base' }) * factor
    if (sortBy === 'quantity') return (toNumber(itemA.quantity, 0) - toNumber(itemB.quantity, 0)) * factor
    if (sortBy === 'totalValue') return (toNumber(itemA.totalValue, 0) - toNumber(itemB.totalValue, 0)) * factor
    if (sortBy === 'totalCost') return (toNumber(itemA.totalCost, 0) - toNumber(itemB.totalCost, 0)) * factor
    if (sortBy === 'commissionCost') return (toNumber(itemA.commissionCost, 0) - toNumber(itemB.commissionCost, 0)) * factor
    if (sortBy === 'profit') return (toNumber(itemA.profit, 0) - toNumber(itemB.profit, 0)) * factor
    if (sortBy === 'responsible') return String(itemA.responsible).localeCompare(String(itemB.responsible), 'pt-BR', { sensitivity: 'base' }) * factor
    if (sortBy === 'status') return String(itemA.status).localeCompare(String(itemB.status), 'pt-BR', { sensitivity: 'base' }) * factor
    if (sortBy === 'paymentStatus') return String(itemA.paymentStatus).localeCompare(String(itemB.paymentStatus), 'pt-BR', { sensitivity: 'base' }) * factor
    if (sortBy === 'itemCount' && 'itemCount' in itemA && 'itemCount' in itemB) return (itemA.itemCount - itemB.itemCount) * factor
    return String(itemA.date || '').localeCompare(String(itemB.date || ''), 'pt-BR', { sensitivity: 'base' }) * factor
  })

  const summary = {
    totalRevenue: roundMoney(expandedItems.reduce((sum, item) => sum + item.totalValue, 0)),
    totalCost: roundMoney(expandedItems.reduce((sum, item) => sum + item.totalCost, 0)),
    totalCommissionCost: roundMoney(expandedItems.reduce((sum, item) => sum + item.commissionCost, 0)),
    totalProfit: roundMoney(expandedItems.reduce((sum, item) => sum + item.profit, 0)),
    totalQuantity: roundMoney(expandedItems.reduce((sum, item) => sum + item.quantity, 0)),
    itemCount: expandedItems.length,
    orderCount: groupedOrdersMap.size
  }

  const { data: paginatedItems, pagination } = paginate(tableItems, page, pageSize)

  let details: SalesItemDetailData | null = null
  if (includeDetails && selectedItemId) {
    const selectedItem = expandedItems.find(item => item.id === selectedItemId)
    if (selectedItem) {
      const orderItems = expandedItems.filter(item => item.orderId === selectedItem.orderId)
      details = {
        mode: 'item',
        id: selectedItem.id,
        orderId: selectedItem.orderId,
        currentItemId: selectedItem.id,
        orderNumber: selectedItem.orderNumber,
        client: selectedItem.client,
        responsible: selectedItem.responsible,
        status: selectedItem.status,
        paymentStatus: selectedItem.paymentStatus,
        paymentMethod: selectedItem.paymentMethod,
        date: selectedItem.date,
        categoryName: selectedItem.categoryName,
        costSource: selectedItem.costSource,
        itemDescription: selectedItem.itemDescription,
        quantity: selectedItem.quantity,
        unitCost: selectedItem.unitCost,
        totalCost: selectedItem.totalCost,
        commissionCost: selectedItem.commissionCost,
        totalCostWithCommission: selectedItem.totalCostWithCommission,
        totalValue: selectedItem.totalValue,
        profit: selectedItem.profit,
        itemCount: orderItems.length,
        items: orderItems
      }
    }
  }
  if (includeDetails && selectedOrderId) {
    const orderRow = groupedOrdersMap.get(selectedOrderId)
    const orderItems = expandedItems.filter(item => item.orderId === selectedOrderId)
    if (orderRow) {
      details = {
        mode: 'os',
        id: orderRow.id,
        orderId: orderRow.orderId,
        currentItemId: null,
        orderNumber: orderRow.orderNumber,
        client: orderRow.client,
        responsible: orderRow.responsible,
        status: orderRow.status,
        paymentStatus: orderRow.paymentStatus,
        paymentMethod: orderRow.paymentMethod,
        date: orderRow.date,
        categoryName: orderItems.map(item => item.categoryName).filter(Boolean).join(', '),
        costSource: orderItems.map(item => item.costSource).filter(Boolean).join(', '),
        itemDescription: `${orderRow.itemCount} item(ns)`,
        quantity: orderRow.quantity,
        unitCost: orderRow.quantity > 0 ? roundMoney(orderRow.totalCost / orderRow.quantity) : 0,
        totalCost: orderRow.totalCost,
        commissionCost: orderRow.commissionCost,
        totalCostWithCommission: orderRow.totalCostWithCommission,
        totalValue: orderRow.totalValue,
        profit: orderRow.profit,
        itemCount: orderRow.itemCount,
        items: orderItems
      }
    }
  }

  return {
    data: {
      salesItemsReport: {
        filters: {
          availableClients: clients
            .map(client => ({ value: client.id, label: client.name || 'Cliente sem nome' }))
            .sort((clientA, clientB) => clientA.label.localeCompare(clientB.label, 'pt-BR', { sensitivity: 'base' })),
          availableOrders: filteredOrders
            .map(order => ({ value: String(order.id || ''), label: `OS ${order.number || '-'}` }))
            .sort((orderA, orderB) => orderA.label.localeCompare(orderB.label, 'pt-BR', { sensitivity: 'base' })),
          availableResponsibles: employees
            .map(employee => ({ value: employee.id, label: employee.name || 'Sem nome' }))
            .sort((employeeA, employeeB) => employeeA.label.localeCompare(employeeB.label, 'pt-BR', { sensitivity: 'base' })),
          availableStatuses: Array.from(new Set(orders.map(order => String(order?.status || '')).filter(Boolean)))
            .sort((statusA, statusB) => statusA.localeCompare(statusB, 'pt-BR', { sensitivity: 'base' }))
            .map(status => ({ value: status, label: formatStatusLabel(status) })),
          availableCategories: categories
            .map(category => ({ value: category.id, label: category.name || 'Sem categoria' }))
            .sort((categoryA, categoryB) => categoryA.label.localeCompare(categoryB.label, 'pt-BR', { sensitivity: 'base' }))
        },
        summary,
        details,
        charts: {
          topItemsByQuantity: [...expandedItems]
            .sort((itemA, itemB) => itemB.quantity - itemA.quantity)
            .slice(0, 10)
            .map(item => ({ name: item.itemDescription, quantity: item.quantity, revenue: item.totalValue }))
        },
        table: {
          items: paginatedItems,
          pagination,
          sort: { sortBy, sortOrder },
          viewMode
        }
      }
    }
  }
})
