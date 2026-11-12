import { defineEventHandler, readBody } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

/**
 * POST /api/service-orders/export-csv
 * Exports service orders to CSV format.
 */

function escapeCsv(value: unknown): string {
  const str = String(value ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function formatDate(value: unknown): string {
  if (!value) return ''
  const date = new Date(String(value))
  if (isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('pt-BR')
}

function formatCurrency(value: unknown): string {
  const num = Number(value || 0)
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STATUS_LABELS: Record<string, string> = {
  estimate: 'Orçamento',
  open: 'Aberta',
  in_progress: 'Em Andamento',
  waiting_for_part: 'Aguardando Peça',
  completed: 'Concluída',
  delivered: 'Entregue',
  cancelled: 'Cancelada'
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  partial: 'Parcial'
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'orders.read', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)
  const filters = body?.filters || {}

  // Fetch data
  let ordersQuery = supabase
    .from('service_orders')
    .select('*')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (filters.status && filters.status !== 'all') {
    ordersQuery = ordersQuery.eq('status', filters.status)
  }

  const [ordersResult, clientsResult] = await Promise.all([
    ordersQuery,
    supabase.from('clients').select('id, name').eq('organization_id', organizationId).is('deleted_at', null)
  ])

  const orders = ordersResult.data || []
  const clientNameById = new Map((clientsResult.data || []).map(c => [c.id, c.name]))

  // Build CSV
  const headers = [
    'Número',
    'Status',
    'Status Pagamento',
    'Cliente',
    'Data Entrada',
    'Data Conclusão',
    'Defeito Relatado',
    'Valor Total',
    'Desconto',
    'Forma de Pagamento',
    'Observações'
  ]

  const rows = orders.map(order => [
    escapeCsv(order.number),
    escapeCsv(STATUS_LABELS[order.status] || order.status),
    escapeCsv(PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status),
    escapeCsv(clientNameById.get(order.client_id) || ''),
    escapeCsv(formatDate(order.entry_date)),
    escapeCsv(formatDate(order.completion_date)),
    escapeCsv(order.reported_defect),
    escapeCsv(formatCurrency(order.total_amount)),
    escapeCsv(formatCurrency(order.discount)),
    escapeCsv(order.payment_method || ''),
    escapeCsv(order.notes)
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n')

  // Add BOM for Excel compatibility
  const bom = '\uFEFF'

  return {
    data: {
      csv: bom + csvContent,
      filename: `ordens-servico-${new Date().toISOString().split('T')[0]}.csv`,
      totalRecords: orders.length
    }
  }
})
