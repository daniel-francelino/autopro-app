import { defineEventHandler, getQuery } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchAllOrganizationRows } from '../../utils/supabase-pagination'
import { parseDateRange, toNumber, qArr, paginate, sortFactor, normalizeReportStatus } from '../../utils/report-helpers'
import { enforceReportAccess } from '../../utils/license'

interface ServiceOrderRecord {
  id?: string | null
  number?: string | number | null
  client_id?: string | null
  status?: string | null
  payment_status?: string | null
  payment_method?: string | null
  total_amount?: number | string | null
  expected_payment_date?: string | null
  entry_date?: string | null
  is_installment?: boolean | null
}

interface InstallmentRecord {
  id?: string | null
  service_order_id?: string | null
  status?: string | null
  amount?: number | string | null
  due_date?: string | null
  payment_method?: string | null
  installment_number?: number | null
  kind?: string | null
}

interface ReceivedTransactionRecord {
  service_order_installment_id?: string | null
  amount?: number | string | null
}

interface ClientRecord {
  id: string
  name?: string | null
  phone?: string | null
  email?: string | null
}

interface PendingItem {
  type: 'order' | 'installment'
  id: string | null | undefined
  orderId: string | null | undefined
  orderNumber: string
  number: string
  amount: number
  dueDate: string | null
  paymentMethod: string | null
  orderStatus: string | null
  daysOverdue: number
  status: 'overdue' | 'current'
}

interface DebtorAggregate {
  clientId: string
  totalOwed: number
  pendingItems: PendingItem[]
  daysOverdue: number
  earliestDue: string | null
}

interface DebtorClientRow extends DebtorAggregate {
  client?: ClientRecord | null
  clientName: string
  phone: string | null
  email: string | null
  status: 'overdue' | 'current'
}

interface DebtorOrderRow {
  rowId: string
  orderId: string | null
  orderNumber: string | null
  clientId: string
  clientName: string
  phone: string | null
  email: string | null
  totalOwed: number
  pendingItems: PendingItem[]
  daysOverdue: number
  earliestDue: string | null
  status: 'overdue' | 'current'
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)
  await enforceReportAccess(organizationId, 'debtors')

  const query = getQuery(event)

  const viewMode = query.viewMode === 'orders' ? 'orders' : 'clients'
  const sortBy = ['client_name', 'total_owed', 'days_overdue', 'earliest_due', 'status', 'order_number'].includes(query.sortBy as string) ? String(query.sortBy) : 'earliest_due'
  const sortOrder: 'asc' | 'desc' = query.sortOrder === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Math.floor(toNumber(query.page, 1)))
  const pageSize = Math.min(100, Math.max(1, Math.floor(toNumber(query.pageSize, 10))))
  const searchTerm = String(query.searchTerm || '').trim().toLowerCase()
  const statusFilters = qArr(query.statusFilters as string | string[] | undefined)
  const paymentMethodFilters = qArr(query.paymentMethodFilters as string | string[] | undefined)
  const clientIds = qArr(query.clientIds as string | string[] | undefined)
  const orderStatusFilters = qArr(query.orderStatusFilters as string | string[] | undefined)
  const allowedOrderStatuses = orderStatusFilters.length > 0 ? orderStatusFilters : null
  const { dateFrom, dateTo } = parseDateRange(query.dateFrom as string, query.dateTo as string)

  const [orders, installments, clients, receivedTransactions] = await Promise.all([
    fetchAllOrganizationRows<ServiceOrderRecord>(supabase, {
      table: 'service_orders',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'created_at' }
    }),
    fetchAllOrganizationRows<InstallmentRecord>(supabase, {
      table: 'service_order_installments',
      organizationId,
      nullColumns: ['deleted_at']
    }),
    fetchAllOrganizationRows<ClientRecord>(supabase, {
      table: 'clients',
      organizationId,
      nullColumns: ['deleted_at']
    }),
    fetchAllOrganizationRows<ReceivedTransactionRecord>(supabase, {
      table: 'financial_transactions',
      organizationId,
      eq: { type: 'income', status: 'paid' },
      nullColumns: ['deleted_at']
    })
  ])
  const clientsMap = new Map<string, ClientRecord>(clients.map(c => [String(c.id), c]))
  const ordersMap = new Map<string, ServiceOrderRecord>(orders.map(order => [String(order.id || ''), order]))

  // An installment can now be settled across more than one receipt
  // (partial payments) — what's still owed on it is its expected amount
  // minus everything already received against it, not the full amount.
  const receivedByInstallmentId = new Map<string, number>()
  for (const tx of receivedTransactions) {
    const installmentId = tx.service_order_installment_id ? String(tx.service_order_installment_id) : null
    if (!installmentId) continue
    receivedByInstallmentId.set(installmentId, (receivedByInstallmentId.get(installmentId) || 0) + toNumber(tx.amount, 0))
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const debtorsMap: Record<string, DebtorAggregate> = {}

  function getEligibleDueInfo(dueDate: string | null) {
    const dueDateObj = dueDate ? new Date(`${dueDate}T00:00:00`) : null
    if (!dueDateObj || Number.isNaN(dueDateObj.getTime())) return null
    if (dateFrom && dueDateObj < dateFrom) return null
    if (dateTo && dueDateObj > dateTo) return null

    const daysOverdue = Math.max(0, Math.floor((today.getTime() - dueDateObj.getTime()) / (1000 * 60 * 60 * 24)))
    const status = dueDateObj < today ? 'overdue' as const : 'current' as const
    return { daysOverdue, status }
  }

  function addPendingItem(clientId: string, item: PendingItem) {
    if (statusFilters.length > 0 && !statusFilters.includes(item.status)) return
    if (paymentMethodFilters.length > 0 && !paymentMethodFilters.includes(String(item.paymentMethod || 'no_payment'))) return

    if (!debtorsMap[clientId]) debtorsMap[clientId] = { clientId, totalOwed: 0, pendingItems: [], daysOverdue: 0, earliestDue: null }
    const debtor = debtorsMap[clientId]
    debtor.totalOwed += item.amount
    if (item.daysOverdue > debtor.daysOverdue) debtor.daysOverdue = item.daysOverdue
    if (item.dueDate && (!debtor.earliestDue || item.dueDate < debtor.earliestDue)) debtor.earliestDue = item.dueDate
    debtor.pendingItems.push(item)
  }

  // From service orders (non-installment, unpaid)
  for (const order of orders) {
    if (order?.status === 'cancelled' || order?.status === 'estimate') continue
    if (normalizeReportStatus(order?.payment_status) !== 'pending') continue
    if (order?.is_installment) continue
    if (allowedOrderStatuses && !allowedOrderStatuses.includes(String(order?.status || ''))) continue

    const clientId = String(order?.client_id || '')
    if (!clientId) continue

    const dueDate = order?.expected_payment_date || order?.entry_date || null
    const dueInfo = getEligibleDueInfo(dueDate)
    if (!dueInfo) continue

    const amount = toNumber(order?.total_amount, 0)
    addPendingItem(clientId, {
      type: 'order', id: order.id, orderId: order.id, orderNumber: String(order?.number || '-'), number: String(order?.number || '-'), amount,
      dueDate, paymentMethod: order?.payment_method || null,
      orderStatus: order?.status || null, daysOverdue: dueInfo.daysOverdue,
      status: dueInfo.status
    })
  }

  // From installments — 'partial' is included now: an installment settled
  // across more than one receipt still owes the remainder.
  for (const installment of installments) {
    if (!['pending', 'overdue', 'partial'].includes(String(installment?.status || '').toLowerCase())) continue

    const order = ordersMap.get(String(installment?.service_order_id || ''))
    if (!order) continue
    if (order?.status === 'cancelled' || order?.status === 'estimate') continue
    if (allowedOrderStatuses && !allowedOrderStatuses.includes(String(order?.status || ''))) continue
    const clientId = String(order?.client_id || '')
    if (!clientId) continue

    const dueDate = installment?.due_date || null
    const dueInfo = getEligibleDueInfo(dueDate)
    if (!dueInfo) continue

    const received = installment.id ? (receivedByInstallmentId.get(String(installment.id)) || 0) : 0
    const amount = toNumber(installment?.amount, 0) - received
    if (amount <= 0.01) continue

    addPendingItem(clientId, {
      type: 'installment', id: installment.id, orderId: order.id, orderNumber: String(order?.number || '-'), number: String(order?.number || '-'),
      amount, dueDate, paymentMethod: installment?.payment_method || null,
      orderStatus: order?.status || null, daysOverdue: dueInfo.daysOverdue,
      status: dueInfo.status
    })
  }

  let debtors: DebtorClientRow[] = Object.values(debtorsMap).map((debtor) => {
    const client = clientsMap.get(debtor.clientId)
    return {
      ...debtor,
      client,
      clientName: client?.name || 'Unknown',
      phone: client?.phone || null,
      email: client?.email || null,
      status: debtor.daysOverdue > 0 ? 'overdue' : 'current'
    }
  })

  const availableClients = debtors
    .map(d => ({ value: d.clientId, label: d.clientName }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))

  if (clientIds.length > 0) debtors = debtors.filter(d => clientIds.includes(d.clientId))
  if (searchTerm) {
    debtors = debtors.filter(d =>
      d.clientName.toLowerCase().includes(searchTerm)
      || (d.phone && d.phone.toLowerCase().includes(searchTerm))
      || (d.email && d.email.toLowerCase().includes(searchTerm))
    )
  }

  const factor = sortFactor(sortOrder)
  debtors.sort((a, b) => {
    if (sortBy === 'total_owed') return (a.totalOwed - b.totalOwed) * factor
    if (sortBy === 'days_overdue') return (a.daysOverdue - b.daysOverdue) * factor
    if (sortBy === 'earliest_due') return String(a.earliestDue || '').localeCompare(String(b.earliestDue || '')) * factor
    if (sortBy === 'status') return String(a.status).localeCompare(String(b.status)) * factor
    return a.clientName.localeCompare(b.clientName, 'pt-BR', { sensitivity: 'base' }) * factor
  })

  const orderRowsMap = new Map<string, DebtorOrderRow>()

  for (const debtor of debtors) {
    for (const item of debtor.pendingItems) {
      const baseOrderId = item.orderId ? String(item.orderId) : `${debtor.clientId}-${item.number}`
      const orderNumber = item.orderNumber || null
      const existing = orderRowsMap.get(baseOrderId)

      if (!existing) {
        orderRowsMap.set(baseOrderId, {
          rowId: baseOrderId,
          orderId: item.orderId ? String(item.orderId) : null,
          orderNumber,
          clientId: debtor.clientId,
          clientName: debtor.clientName,
          phone: debtor.phone,
          email: debtor.email,
          totalOwed: item.amount,
          pendingItems: [item],
          daysOverdue: item.daysOverdue,
          earliestDue: item.dueDate,
          status: item.daysOverdue > 0 ? 'overdue' : 'current'
        })
        continue
      }

      existing.totalOwed += item.amount
      existing.pendingItems.push(item)
      if (item.daysOverdue > existing.daysOverdue) existing.daysOverdue = item.daysOverdue
      if (item.dueDate && (!existing.earliestDue || item.dueDate < existing.earliestDue)) existing.earliestDue = item.dueDate
      if (existing.status !== 'overdue' && item.daysOverdue > 0) existing.status = 'overdue'
    }
  }

  const orderRows = Array.from(orderRowsMap.values())

  orderRows.sort((a, b) => {
    if (sortBy === 'order_number') return String(a.orderNumber || '').localeCompare(String(b.orderNumber || ''), 'pt-BR', { sensitivity: 'base' }) * factor
    if (sortBy === 'total_owed') return (a.totalOwed - b.totalOwed) * factor
    if (sortBy === 'days_overdue') return (a.daysOverdue - b.daysOverdue) * factor
    if (sortBy === 'earliest_due') return String(a.earliestDue || '').localeCompare(String(b.earliestDue || '')) * factor
    if (sortBy === 'status') return String(a.status).localeCompare(String(b.status), 'pt-BR', { sensitivity: 'base' }) * factor
    return a.clientName.localeCompare(b.clientName, 'pt-BR', { sensitivity: 'base' }) * factor
  })

  const totals = {
    total: debtors.reduce((s, d) => s + d.totalOwed, 0),
    overdue: debtors.filter(d => d.status === 'overdue').reduce((s, d) => s + d.totalOwed, 0),
    current: debtors.filter(d => d.status === 'current').reduce((s, d) => s + d.totalOwed, 0)
  }

  const sourceItems = viewMode === 'orders' ? orderRows : debtors
  const { data: paginatedItems, pagination } = paginate(sourceItems, page, pageSize)

  return {
    data: {
      debtorsReport: {
        filters: { availableClients },
        items: viewMode === 'clients' ? (paginatedItems as DebtorClientRow[]) : [],
        orderItems: viewMode === 'orders' ? (paginatedItems as DebtorOrderRow[]) : [],
        totals,
        counts: { clients: debtors.length, orders: orderRows.length },
        pagination,
        sort: { sortBy, sortOrder }
      }
    }
  }
})
