import { defineEventHandler, readBody } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import type { SupabaseClientLike } from '../../utils/supabase-pagination'
import { buildReportDownloadData } from '../../utils/report-export'
import { formatCurrency, formatOptionalDate, formatStatusLabel } from '../../utils/report-helpers'
import { getEmployeeReport } from '../../utils/employee-report'

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(value)
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = (await readBody(event)) || {}
  const format = body?.format === 'pdf' ? 'pdf' : 'csv'
  const view = ['orders', 'commissions', 'items'].includes(body?.view) ? body.view : 'orders'

  const report = await getEmployeeReport(supabase as unknown as SupabaseClientLike, organizationId, {
    dateFrom: body?.dateFrom,
    dateTo: body?.dateTo,
    employeeId: body?.employeeId,
    orderStatusFilters: toStringArray(body?.orderStatusFilters),
    paymentStatusFilters: toStringArray(body?.paymentStatusFilters),
    paymentMethods: toStringArray(body?.paymentMethods),
    commissionStatus: toStringArray(body?.commissionStatus),
    recordType: toStringArray(body?.recordType)
  })

  const employeeName = report.employee?.name || 'Funcionário'
  const subtitle = `${employeeName} · Período: ${body?.dateFrom ? formatOptionalDate(body.dateFrom) : '-'} a ${body?.dateTo ? formatOptionalDate(body.dateTo) : '-'}`
  const generatedAt = formatDateTime(new Date())

  let columns: Array<{ header: string, widthRatio: number, align?: 'right' }>
  let dataRows: string[][]
  let title: string
  let fileNameBase: string
  let footerRows: Array<{ label: string, value: string }>

  if (view === 'commissions') {
    title = 'Relatório de Funcionários — Comissões'
    fileNameBase = 'relatorio_funcionario_comissoes'
    columns = [
      { header: 'REFERÊNCIA', widthRatio: 0.12 },
      { header: 'OS', widthRatio: 0.1 },
      { header: 'DESCRIÇÃO', widthRatio: 0.28 },
      { header: 'STATUS OS', widthRatio: 0.13 },
      { header: 'PGTO OS', widthRatio: 0.13 },
      { header: 'VALOR', widthRatio: 0.12, align: 'right' },
      { header: 'STATUS COM.', widthRatio: 0.12 }
    ]
    dataRows = report.commissionsView.map(row => [
      formatOptionalDate(row.referenceDate),
      row.orderNumber ? `#${row.orderNumber}` : '-',
      row.description || '-',
      formatStatusLabel(row.orderStatus),
      formatStatusLabel(row.orderPaymentStatus),
      formatCurrency(row.amount),
      formatStatusLabel(row.status)
    ])
    footerRows = [
      { label: 'Total de Linhas', value: String(report.commissionsView.length) },
      { label: 'Total de Comissões', value: formatCurrency(report.summary?.totalCommissions ?? 0) }
    ]
  } else if (view === 'items') {
    title = 'Relatório de Funcionários — Itens vendidos'
    fileNameBase = 'relatorio_funcionario_itens'
    columns = [
      { header: 'OS', widthRatio: 0.07 },
      { header: 'DATA', widthRatio: 0.07 },
      { header: 'ITEM', widthRatio: 0.32 },
      { header: 'CATEGORIA', widthRatio: 0.12 },
      { header: 'QTD', widthRatio: 0.06, align: 'right' },
      { header: 'VALOR', widthRatio: 0.1, align: 'right' },
      { header: 'CUSTO', widthRatio: 0.1, align: 'right' },
      { header: 'COMISSÃO', widthRatio: 0.16, align: 'right' }
    ]
    dataRows = report.itemsView.map(row => [
      `#${row.orderNumber}`,
      formatOptionalDate(row.date),
      row.itemDescription,
      row.categoryName,
      String(row.quantity),
      formatCurrency(row.totalValue),
      formatCurrency(row.totalCost),
      formatCurrency(row.commissionCost)
    ])
    footerRows = [
      { label: 'Total de Linhas', value: String(report.itemsView.length) },
      { label: 'Total de Vendas', value: formatCurrency(report.itemsView.reduce((sum, row) => sum + row.totalValue, 0)) }
    ]
  } else {
    title = 'Relatório de Funcionários — OS trabalhadas'
    fileNameBase = 'relatorio_funcionario_os'
    columns = [
      { header: 'OS', widthRatio: 0.07 },
      { header: 'ENTRADA', widthRatio: 0.08 },
      { header: 'CLIENTE', widthRatio: 0.26 },
      { header: 'STATUS', widthRatio: 0.1 },
      { header: 'PAGAMENTO', widthRatio: 0.1 },
      { header: 'VENDA BRUTA', widthRatio: 0.11, align: 'right' },
      { header: 'DESPESAS', widthRatio: 0.1, align: 'right' },
      { header: 'COMISSÃO', widthRatio: 0.18, align: 'right' }
    ]
    dataRows = report.ordersView.map(row => [
      `#${row.number}`,
      formatOptionalDate(row.entryDate),
      row.clientName,
      formatStatusLabel(row.status),
      formatStatusLabel(row.paymentStatus),
      formatCurrency(row.totalAmount),
      formatCurrency(row.totalCostAmount),
      formatCurrency(row.employeeCommission)
    ])
    footerRows = [
      { label: 'Total de Linhas', value: String(report.ordersView.length) },
      { label: 'Venda Bruta', value: formatCurrency(report.summary?.grossSales ?? 0) },
      { label: 'Despesas', value: formatCurrency(report.summary?.osExpenses ?? 0) },
      { label: 'Comissões', value: formatCurrency(report.summary?.totalCommissions ?? 0) },
      { label: 'Venda Líquida', value: formatCurrency(report.summary?.netSales ?? 0) }
    ]
  }

  const data = await buildReportDownloadData({
    format,
    title,
    subtitle,
    fileNameBase,
    columns,
    rows: dataRows,
    footerRows,
    footerMetaRows: [{ left: `Gerado em: ${generatedAt}` }]
  })

  return { success: true, data }
})
