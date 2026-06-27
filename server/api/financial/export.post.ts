import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { buildReportDownloadData } from '../../utils/report-export'

function parseAmount(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? 0))
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCurrency(value: unknown) {
  return parseAmount(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(value: unknown) {
  const str = String(value || '')
  if (!str) return '—'
  const [year, month, day] = str.split('-')
  if (!year || !month || !day) return str
  return `${day}/${month}/${year}`
}

function normalizeStatus(value: unknown) {
  const s = String(value || '').trim().toLowerCase()
  if (s === 'paid') return 'Pago'
  if (s === 'pending') return 'Pendente'
  return s
}

function normalizeType(value: unknown) {
  const s = String(value || '').trim().toLowerCase()
  if (s === 'income') return 'Receita'
  if (s === 'expense') return 'Despesa'
  return s
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function normalizeRecurrence(value: unknown) {
  const s = String(value || '').trim().toLowerCase()
  if (!s || s === 'null' || s === 'none' || s === 'nao_recorrente') return 'Não recorrente'
  if (s === 'weekly' || s === 'semanal') return 'Semanal'
  if (s === 'monthly' || s === 'mensal') return 'Mensal'
  if (s === 'yearly' || s === 'anual') return 'Anual'
  return 'Não recorrente'
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = (await readBody(event)) || {}
  const format = body?.format === 'pdf' ? 'pdf' : 'csv'
  const search = String(body?.search || '').trim().toLowerCase()
  const statusFilter = String(body?.status || '')
  const typeFilter = String(body?.type || '')
  const dateFrom = body?.dateFrom ? String(body.dateFrom) : null
  const dateTo = body?.dateTo ? String(body.dateTo) : null

  const [transactionsResult, organizationResult] = await Promise.all([
    (() => {
      let q = supabase
        .from('financial_transactions')
        .select('*, category_ref:financial_categories(id, name, icon, color)')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('due_date', { ascending: false })
      if (statusFilter) q = q.eq('status', statusFilter)
      if (typeFilter) q = q.eq('type', typeFilter)
      if (dateFrom) q = q.gte('due_date', dateFrom)
      if (dateTo) q = q.lte('due_date', dateTo)
      if (search) q = q.ilike('description', `%${search}%`)
      return q
    })(),
    supabase.from('organizations').select('name').eq('id', organizationId).maybeSingle()
  ])

  if (transactionsResult.error) throw createError({ statusCode: 500, statusMessage: transactionsResult.error.message })

  const items = transactionsResult.data ?? []
  const organization = organizationResult.data

  if (items.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Não há dados para exportar.' })
  }

  const columns = [
    { header: 'Descrição', widthRatio: 0.28 },
    { header: 'Categoria', widthRatio: 0.14 },
    { header: 'Tipo', widthRatio: 0.10 },
    { header: 'Status', widthRatio: 0.10 },
    { header: 'Valor', widthRatio: 0.14, align: 'right' as const },
    { header: 'Vencimento', widthRatio: 0.12 },
    { header: 'Recorrência', widthRatio: 0.12 }
  ]

  const rows = items.map(item => [
    String(item.description || ''),
    String(item.category_ref?.name || '—'),
    normalizeType(item.type),
    normalizeStatus(item.status),
    formatCurrency(item.amount),
    formatDate(item.due_date),
    normalizeRecurrence(item.recurrence)
  ])

  const periodLabel = dateFrom && dateTo ? `${formatDate(dateFrom)} a ${formatDate(dateTo)}` : 'Todos os períodos'

  const totalIncome = items.filter(i => String(i.type || '') === 'income').reduce((sum, i) => sum + parseAmount(i.amount), 0)
  const totalExpense = items.filter(i => String(i.type || '') === 'expense').reduce((sum, i) => sum + parseAmount(i.amount), 0)
  const totalPaid = items.filter(i => String(i.status || '') === 'paid').reduce((sum, i) => sum + parseAmount(i.amount), 0)
  const totalPending = items.filter(i => String(i.status || '') !== 'paid').reduce((sum, i) => sum + parseAmount(i.amount), 0)
  const generatedAt = formatDateTime(new Date())

  const result = await buildReportDownloadData({
    format,
    title: 'Lançamentos Financeiros',
    subtitle: periodLabel,
    fileNameBase: 'financeiro',
    columns,
    rows,
    footerRows: [
      { label: 'Total de Lançamentos', value: String(items.length) },
      { label: 'Total de Receitas', value: formatCurrency(totalIncome) },
      { label: 'Total de Despesas', value: formatCurrency(totalExpense) },
      { label: 'Total Pago', value: formatCurrency(totalPaid) },
      { label: 'Total Pendente', value: formatCurrency(totalPending) },
      { label: 'Saldo', value: formatCurrency(totalIncome - totalExpense) }
    ],
    footerMetaRows: [
      { left: `Gerado em: ${generatedAt}`, right: organization?.name || '' }
    ]
  })

  return { success: true, data: result }
})
