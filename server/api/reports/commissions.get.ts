import { defineEventHandler, getQuery } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchAllOrganizationRows } from '../../utils/supabase-pagination'
import { parseDateRange, toNumber, qArr, paginate, sortFactor, normalizeReportStatus } from '../../utils/report-helpers'

interface EmployeeRecord {
  id: string
  name?: string | null
}

interface ServiceOrderRecord {
  id?: string | null
  number?: string | number | null
  status?: string | null
  payment_status?: string | null
  client_name?: string | null
  entry_date?: string | null
  completion_date?: string | null
  total_amount?: number | string | null
}

interface EmployeeFinancialRecord {
  id: string
  employee_id?: string | null
  service_order_id?: string | null
  reference_date?: string | null
  amount?: number | string | null
  status?: string | null
  record_type?: string | null
}

interface NormalizedCommissionRecord extends EmployeeFinancialRecord {
  status: 'paid' | 'pending' | 'cancelled'
}

interface EnrichedCommissionRecord extends NormalizedCommissionRecord {
  employee_name: string
  order_number: string | number
  order_status: string | null
  order_payment_status: 'paid' | 'pending' | 'cancelled' | null
  order_client_name: string | null
  order_entry_date: string | null
  order_completion_date: string | null
  order_total_amount: number
}

interface CommissionSummary {
  total: number
  paid: number
  pending: number
  count: number
  totalCommissions: number
  totalPaid: number
  totalPending: number
  employeeCount: number
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const query = getQuery(event)

  const { dateFrom, dateTo } = parseDateRange(query.dateFrom as string, query.dateTo as string)
  const employeeIds = qArr(query.employeeIds as string | string[] | undefined)
  const employeeId = query.employeeId && query.employeeId !== 'all' ? String(query.employeeId) : null
  const status = query.status && query.status !== 'all' ? normalizeReportStatus(query.status) : null
  const orderStatusFilters = qArr(query.orderStatusFilters as string | string[] | undefined)
  const paymentStatusFilters = qArr(query.paymentStatusFilters as string | string[] | undefined)
  const paymentMethods = qArr(query.paymentMethods as string | string[] | undefined)
  const recordType = query.recordType && query.recordType !== 'all' ? String(query.recordType) : null
  const searchTerm = String(query.searchTerm || '').trim().toLowerCase()
  const sortBy = ['employee', 'order', 'date', 'amount', 'status'].includes(query.sortBy as string) ? String(query.sortBy) : 'date'
  const sortOrder: 'asc' | 'desc' = query.sortOrder === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Math.floor(toNumber(query.page, 1)))
  const pageSize = Math.min(100, Math.max(1, Math.floor(toNumber(query.pageSize, 10))))

  const [records, orders, employees] = await Promise.all([
    fetchAllOrganizationRows<EmployeeFinancialRecord>(supabase, {
      table: 'employee_financial_records',
      organizationId,
      order: { column: 'reference_date' }
    }),
    fetchAllOrganizationRows<ServiceOrderRecord>(supabase, {
      table: 'service_orders',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'created_at' }
    }),
    fetchAllOrganizationRows<EmployeeRecord>(supabase, {
      table: 'employees',
      organizationId,
      nullColumns: ['deleted_at']
    })
  ])

  const employeesMap = new Map<string, EmployeeRecord>(employees.map(employee => [String(employee.id), employee]))
  const ordersMap = new Map<string, ServiceOrderRecord>(orders.map(order => [String(order.id || ''), order]))

  const filteredRecords = records.filter((record) => {
    const order = record?.service_order_id ? ordersMap.get(String(record.service_order_id)) : null

    // Bonus records (see docs/finance/bonuses-feature-design.md) aren't tied
    // to a service order — filter those by their own reference_date instead
    // of requiring an order with a valid entry_date.
    if (String(record?.record_type || '') === 'bonus') {
      const referenceDate = record?.reference_date ? new Date(`${record.reference_date}T00:00:00`) : null
      if (!referenceDate || Number.isNaN(referenceDate.getTime())) return false
      if (dateFrom && referenceDate < dateFrom) return false
      if (dateTo && referenceDate > dateTo) return false
    } else {
      const orderEntryDate = order?.entry_date ? new Date(`${order.entry_date}T00:00:00`) : null
      if (!orderEntryDate || Number.isNaN(orderEntryDate.getTime())) return false
      if (dateFrom && orderEntryDate < dateFrom) return false
      if (dateTo && orderEntryDate > dateTo) return false
    }

    if (employeeIds.length > 0) {
      if (!employeeIds.includes(String(record?.employee_id || ''))) return false
    } else if (employeeId && record?.employee_id !== employeeId) {
      return false
    }

    if (paymentStatusFilters.length > 0) {
      const orderPaymentStatus = normalizeReportStatus(order?.payment_status)
      if (!paymentStatusFilters.includes(orderPaymentStatus)) return false
    }

    const recordStatus = normalizeReportStatus(record?.status)
    if (status && recordStatus !== status) return false

    if (orderStatusFilters.length > 0) {
      const orderStatus = String(order?.status || '')
      if (!orderStatus || !orderStatusFilters.includes(orderStatus)) return false
    }

    if (paymentMethods.length > 0) {
      const method = String(order?.payment_method || 'no_payment')
      if (!paymentMethods.includes(method)) return false
    }

    if (recordType && record?.record_type !== recordType) return false

    if (searchTerm) {
      const employeeName = String(employeesMap.get(String(record?.employee_id || ''))?.name || '').toLowerCase()
      if (!employeeName.includes(searchTerm)) return false
    }

    return true
  })

  const normalizedRecords: NormalizedCommissionRecord[] = filteredRecords.map(record => ({
    ...record,
    status: normalizeReportStatus(record?.status)
  }))

  // Bonus rows can be part of normalizedRecords (e.g. no recordType filter,
  // "Todos") but the headline "Total de comissões" must never blend the two
  // — always sum commission-only here, independent of which record types
  // the active filter lets into the list/table.
  const commissionOnlyRecords = normalizedRecords.filter(record => String(record?.record_type || '') === 'commission')
  const totalCommissions = commissionOnlyRecords.reduce((sum, record) => sum + toNumber(record?.amount, 0), 0)
  const paidCommissions = commissionOnlyRecords
    .filter(record => record.status === 'paid')
    .reduce((sum, record) => sum + toNumber(record?.amount, 0), 0)
  const pendingCommissions = commissionOnlyRecords
    .filter(record => record.status === 'pending')
    .reduce((sum, record) => sum + toNumber(record?.amount, 0), 0)

  const summary: CommissionSummary = {
    total: totalCommissions,
    paid: paidCommissions,
    pending: pendingCommissions,
    count: normalizedRecords.length,
    totalCommissions,
    totalPaid: paidCommissions,
    totalPending: pendingCommissions,
    employeeCount: 0
  }

  const byEmployeeMap: Record<string, { name: string, total: number, paid: number, pending: number }> = {}
  for (const record of normalizedRecords) {
    const employeeName = String(employeesMap.get(String(record?.employee_id || ''))?.name || 'Unknown')
    if (!byEmployeeMap[employeeName]) {
      byEmployeeMap[employeeName] = { name: employeeName, total: 0, paid: 0, pending: 0 }
    }
    const amount = toNumber(record?.amount, 0)
    byEmployeeMap[employeeName].total += amount
    if (record.status === 'paid') byEmployeeMap[employeeName].paid += amount
    else byEmployeeMap[employeeName].pending += amount
  }

  const employeeChartData = Object.values(byEmployeeMap).sort((employeeA, employeeB) => employeeB.total - employeeA.total)
  summary.employeeCount = employeeChartData.length

  const statusDistribution = [
    { name: 'Pagas', value: paidCommissions, color: '#22c55e' },
    { name: 'Pendentes', value: pendingCommissions, color: '#f59e0b' }
  ]

  const enrichedRecords: EnrichedCommissionRecord[] = normalizedRecords.map((record) => {
    const order = record?.service_order_id ? ordersMap.get(String(record.service_order_id)) : null
    return {
      ...record,
      employee_name: String(employeesMap.get(String(record?.employee_id || ''))?.name || 'Unknown'),
      order_number: order?.number || 'N/A',
      order_status: order?.status || null,
      order_payment_status: order?.payment_status ? normalizeReportStatus(order.payment_status) : null,
      order_client_name: order?.client_name || null,
      order_entry_date: order?.entry_date || null,
      order_completion_date: order?.completion_date || null,
      order_total_amount: toNumber(order?.total_amount, 0)
    }
  })

  const factor = sortFactor(sortOrder)
  enrichedRecords.sort((recordA, recordB) => {
    if (sortBy === 'employee') {
      return String(recordA.employee_name || '').localeCompare(String(recordB.employee_name || ''), 'pt-BR', { sensitivity: 'base' }) * factor
    }
    if (sortBy === 'order') {
      return String(recordA.order_number || '').localeCompare(String(recordB.order_number || ''), 'pt-BR', {
        sensitivity: 'base',
        numeric: true
      }) * factor
    }
    if (sortBy === 'amount') {
      return (toNumber(recordA?.amount, 0) - toNumber(recordB?.amount, 0)) * factor
    }
    if (sortBy === 'status') {
      return String(recordA?.status || '').localeCompare(String(recordB?.status || ''), 'pt-BR', { sensitivity: 'base' }) * factor
    }

    const dateA = String(recordA?.order_entry_date || recordA?.reference_date || '')
    const dateB = String(recordB?.order_entry_date || recordB?.reference_date || '')
    return dateA.localeCompare(dateB) * factor
  })

  const { data: items, pagination } = paginate(enrichedRecords, page, pageSize)

  return {
    data: {
      items,
      pagination,
      sort: { sortBy, sortOrder },
      summary,
      charts: { byEmployee: employeeChartData, statusDistribution },
      employees: employees.map(employee => ({
        value: employee.id,
        label: employee.name || 'Unknown'
      }))
    }
  }
})
