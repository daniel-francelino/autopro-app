import { defineEventHandler, readBody } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { buildReportDownloadData } from '../../utils/report-export'
import { fetchAllOrganizationRows } from '../../utils/supabase-pagination'
import { parseDateRange, formatCurrency, formatOptionalDate, formatStatusLabel, normalizeReportStatus, sortFactor, toNumber } from '../../utils/report-helpers'
import type { EmployeeNameRecord, CommissionExportOrderRecord } from '../../types/reports'

interface OrganizationRecord {
  name?: string | null
}

interface EmployeeFinancialRecord {
  id: string
  employee_id?: string | null
  service_order_id?: string | null
  reference_date?: string | null
  payment_date?: string | null
  amount?: number | string | null
  status?: string | null
  record_type?: string | null
}

interface ExportCommissionRecord extends EmployeeFinancialRecord {
  employee_name: string
  order_number: string | number | null
  order_status: string | null
  order_payment_status: 'paid' | 'pending' | 'cancelled' | null
  order_entry_date: string | null
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(value)
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'reports.commissions', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = (await readBody(event)) || {}

  const { dateFrom, dateTo } = parseDateRange(body?.dateFrom, body?.dateTo)
  const employeeIds = Array.isArray(body?.employeeIds)
    ? body.employeeIds.map((value: unknown) => String(value)).filter(Boolean)
    : []
  const employeeId = body?.employeeId && body.employeeId !== 'all' ? String(body.employeeId) : null
  const status = body?.status && body.status !== 'all' ? normalizeReportStatus(body.status) : null
  const orderStatusFilters = Array.isArray(body?.orderStatusFilters)
    ? body.orderStatusFilters.map((value: unknown) => String(value)).filter(Boolean)
    : []
  const paymentStatusFilters = Array.isArray(body?.paymentStatusFilters)
    ? body.paymentStatusFilters.map((value: unknown) => String(value)).filter(Boolean)
    : []
  const paymentMethods = Array.isArray(body?.paymentMethods)
    ? body.paymentMethods.map((value: unknown) => String(value)).filter(Boolean)
    : []
  const recordType = body?.recordType && body.recordType !== 'all' ? String(body.recordType) : null
  const searchTerm = String(body?.searchTerm || '').trim().toLowerCase()
  const sortBy = ['employee', 'date', 'amount', 'status'].includes(body?.sortBy) ? body.sortBy : 'date'
  const sortOrder: 'asc' | 'desc' = body?.sortOrder === 'asc' ? 'asc' : 'desc'
  const format = body?.format === 'pdf' ? 'pdf' : 'csv'

  const [records, orders, employees, organizationResult] = await Promise.all([
    fetchAllOrganizationRows<EmployeeFinancialRecord>(supabase, {
      table: 'employee_financial_records',
      organizationId,
      order: { column: 'reference_date' }
    }),
    fetchAllOrganizationRows<CommissionExportOrderRecord>(supabase, {
      table: 'service_orders',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'created_at' }
    }),
    fetchAllOrganizationRows<EmployeeNameRecord>(supabase, {
      table: 'employees',
      organizationId,
      nullColumns: ['deleted_at']
    }),
    supabase
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .maybeSingle()
  ])

  const organization = (organizationResult.data ?? null) as OrganizationRecord | null

  const employeesMap = new Map<string, EmployeeNameRecord>(employees.map(employee => [String(employee.id), employee]))
  const ordersMap = new Map<string, CommissionExportOrderRecord>(orders.map(order => [String(order.id || ''), order]))

  const items: ExportCommissionRecord[] = records
    .filter((record) => {
      const order = record.service_order_id ? ordersMap.get(String(record.service_order_id)) : null
      const orderEntryDate = order?.entry_date ? new Date(`${order.entry_date}T00:00:00`) : null

      if (!orderEntryDate || Number.isNaN(orderEntryDate.getTime())) return false
      if (dateFrom && orderEntryDate < dateFrom) return false
      if (dateTo && orderEntryDate > dateTo) return false

      if (employeeIds.length > 0) {
        if (!employeeIds.includes(String(record.employee_id || ''))) return false
      } else if (employeeId && String(record.employee_id || '') !== employeeId) {
        return false
      }

      const normalizedStatus = normalizeReportStatus(record.status)
      if (status && normalizedStatus !== status) return false
      if (recordType && record.record_type !== recordType) return false

      if (paymentStatusFilters.length > 0) {
        const orderPaymentStatus = normalizeReportStatus(order?.payment_status)
        if (!paymentStatusFilters.includes(orderPaymentStatus)) return false
      }

      if (orderStatusFilters.length > 0) {
        const orderStatus = String(order?.status || '')
        if (!orderStatus || !orderStatusFilters.includes(orderStatus)) return false
      }

      if (paymentMethods.length > 0) {
        const paymentMethod = String(order?.payment_method || 'no_payment')
        if (!paymentMethods.includes(paymentMethod)) return false
      }

      if (searchTerm) {
        const employeeName = String(employeesMap.get(String(record.employee_id || ''))?.name || '').toLowerCase()
        if (!employeeName.includes(searchTerm)) return false
      }

      return true
    })
    .map((record) => {
      const order = record.service_order_id ? ordersMap.get(String(record.service_order_id)) : null
      return {
        ...record,
        status: normalizeReportStatus(record.status),
        employee_name: String(employeesMap.get(String(record.employee_id || ''))?.name || 'Desconhecido'),
        order_number: order?.number || null,
        order_status: order?.status || null,
        order_payment_status: order?.payment_status ? normalizeReportStatus(order.payment_status) : null,
        order_entry_date: order?.entry_date || null
      }
    })

  const factor = sortFactor(sortOrder)
  items.sort((recordA, recordB) => {
    if (sortBy === 'employee') {
      return String(recordA.employee_name || '').localeCompare(String(recordB.employee_name || ''), 'pt-BR', { sensitivity: 'base' }) * factor
    }
    if (sortBy === 'amount') {
      return (toNumber(recordA.amount, 0) - toNumber(recordB.amount, 0)) * factor
    }
    if (sortBy === 'status') {
      return String(recordA.status || '').localeCompare(String(recordB.status || ''), 'pt-BR', { sensitivity: 'base' }) * factor
    }

    return String(recordA.order_entry_date || recordA.reference_date || '').localeCompare(String(recordB.order_entry_date || recordB.reference_date || '')) * factor
  })

  const totalRows = items.length
  const totalCommission = items.reduce((sum, record) => sum + toNumber(record.amount, 0), 0)
  const generatedAt = formatDateTime(new Date())
  const columns = [
    { header: 'FUNC.', widthRatio: 0.17 },
    { header: 'OS', widthRatio: 0.16 },
    { header: 'REF. PGTO', widthRatio: 0.1 },
    { header: 'ST. OS', widthRatio: 0.09 },
    { header: 'ENT. OS', widthRatio: 0.09 },
    { header: 'VALOR', widthRatio: 0.09, align: 'right' as const },
    { header: 'PGTO OS', widthRatio: 0.1 },
    { header: 'ST. COM.', widthRatio: 0.1 },
    { header: 'DT. PGTO', widthRatio: 0.1 }
  ]

  const dataRows = items.map(record => [
    String(record.employee_name || 'Desconhecido'),
    record.order_number ? String(record.order_number) : '-',
    formatOptionalDate(record.reference_date),
    formatStatusLabel(record.order_status),
    formatOptionalDate(record.order_entry_date || record.reference_date),
    formatCurrency(record.amount),
    formatStatusLabel(record.order_payment_status),
    formatStatusLabel(record.status),
    formatOptionalDate(record.payment_date)
  ])

  const data = await buildReportDownloadData({
    format,
    title: 'Relatório de Comissões',
    subtitle: `Período: ${body?.dateFrom ? formatOptionalDate(body.dateFrom) : '-'} a ${body?.dateTo ? formatOptionalDate(body.dateTo) : '-'}`,
    fileNameBase: 'relatorio_comissoes',
    columns,
    rows: dataRows,
    footerRows: [
      { label: 'Total de Linhas', value: String(totalRows) },
      { label: 'Total da Comissão', value: formatCurrency(totalCommission) }
    ],
    footerMetaRows: [
      {
        left: `Gerado em: ${generatedAt}`,
        right: organization?.name || ''
      }
    ].filter(Boolean)
  })

  return { success: true, data }
})
