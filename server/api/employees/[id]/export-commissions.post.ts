import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { resolveOrganizationId } from '../../../utils/organization'
import { getEmployeeCommissionReport } from '../../../utils/employee-commission-report'
import { buildReportDownloadData } from '../../../utils/report-export'
import { formatCurrency, formatOptionalDate } from '../../../utils/report-helpers'

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(value)
}

function formatCommissionRule(type: string | null, base: string | null, percentage: number | null) {
  if (type === 'percentage') {
    const baseLabel = base === 'profit' ? 'sobre lucro' : 'sobre receita'
    return `${percentage ?? 0}% ${baseLabel}`
  }

  if (type === 'fixed_amount') {
    return `${formatCurrency(percentage ?? 0)} por item`
  }

  return 'Sem regra definida'
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'employees.read', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)
  const employeeId = getRouterParam(event, 'id')
  const body = (await readBody(event)) || {}

  if (!employeeId) {
    throw createError({ statusCode: 400, statusMessage: 'Employee id is required' })
  }

  try {
    const [report, organizationResult] = await Promise.all([
      getEmployeeCommissionReport({
        supabase,
        organizationId,
        employeeId,
        dateFrom: body?.dateFrom ? String(body.dateFrom) : null,
        dateTo: body?.dateTo ? String(body.dateTo) : null
      }),
      supabase
        .from('organizations')
        .select('name')
        .eq('id', organizationId)
        .maybeSingle()
    ])

    const format = body?.format === 'pdf' ? 'pdf' : 'csv'
    const data = await buildReportDownloadData({
      format,
      title: `Comissões do funcionário - ${report.employee.name}`,
      subtitle: `Período: ${formatOptionalDate(report.period.dateFrom)} a ${formatOptionalDate(report.period.dateTo)}`,
      fileNameBase: `funcionario_${report.employee.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_comissoes`,
      columns: [
        { header: 'OS', widthRatio: 0.1 },
        { header: 'REF.', widthRatio: 0.1 },
        { header: 'ITEM', widthRatio: 0.22 },
        { header: 'CLIENTE', widthRatio: 0.18 },
        { header: 'BASE', widthRatio: 0.1, align: 'right' },
        { header: 'REGRA', widthRatio: 0.13 },
        { header: 'COMISSAO', widthRatio: 0.09, align: 'right' },
        { header: 'STATUS', widthRatio: 0.08 }
      ],
      rows: report.items.map(item => [
        item.orderNumber ? `#${item.orderNumber}` : '-',
        formatOptionalDate(item.referenceDate),
        item.itemName || item.description || '-',
        item.orderClientName || '-',
        formatCurrency(item.baseAmount),
        formatCommissionRule(item.commissionType, item.commissionBase, item.commissionPercentage),
        formatCurrency(item.amount),
        item.status === 'paid' ? 'Pago' : item.status === 'cancelled' ? 'Cancelado' : 'Pendente'
      ]),
      footerRows: [
        { label: 'Total de comissões', value: formatCurrency(report.summary.totalCommissions) },
        { label: 'Total pago', value: formatCurrency(report.summary.totalPaid) },
        { label: 'Total pendente', value: formatCurrency(report.summary.totalPending) },
        { label: 'Itens com comissão', value: String(report.summary.itemsCount) },
        { label: 'OS com comissão', value: String(report.summary.orderCount) }
      ],
      footerMetaRows: [
        {
          left: `Gerado em: ${formatDateTime(new Date())}`,
          right: String(organizationResult.data?.name || '')
        }
      ]
    })

    return { success: true, data }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to export employee commissions'

    if (message === 'Employee not found') {
      throw createError({ statusCode: 404, statusMessage: 'Funcionário não encontrado' })
    }

    throw createError({ statusCode: 500, statusMessage: message })
  }
})
