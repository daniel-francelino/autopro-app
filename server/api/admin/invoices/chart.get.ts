import { defineEventHandler } from 'h3'
import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'

/**
 * GET /api/admin/invoices/chart
 * Returns paid invoice amounts grouped by month for the last 12 months.
 * Restricted to users with is_owner = true.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const supabase = getSupabaseAdminClient()

  const now = new Date()
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)

  const { data, error } = await supabase
    .from('billing_invoices')
    .select('amount, status, payment_date, created_at')
    .gte('created_at', twelveMonthsAgo.toISOString())
    .is('deleted_at', null)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Erro ao buscar dados do gráfico de faturas' })
  }

  // Build last 12 months labels
  const months: string[] = []
  const monthKeys: string[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    months.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }))
  }

  const paidByMonth: Record<string, number> = {}
  const pendingByMonth: Record<string, number> = {}
  const failedByMonth: Record<string, number> = {}
  for (const key of monthKeys) {
    paidByMonth[key] = 0
    pendingByMonth[key] = 0
    failedByMonth[key] = 0
  }

  for (const inv of data || []) {
    const dateStr = inv.payment_date || inv.created_at
    if (!dateStr) continue
    const d = new Date(dateStr)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const amount = Number(inv.amount) || 0

    if (inv.status === 'paid') {
      if (key in paidByMonth) paidByMonth[key] = (paidByMonth[key] ?? 0) + amount
    } else if (inv.status === 'pending') {
      if (key in pendingByMonth) pendingByMonth[key] = (pendingByMonth[key] ?? 0) + amount
    } else if (inv.status === 'failed') {
      if (key in failedByMonth) failedByMonth[key] = (failedByMonth[key] ?? 0) + amount
    }
  }

  return {
    categories: months,
    series: [
      { name: 'Pagas', data: monthKeys.map(k => paidByMonth[k]) },
      { name: 'Pendentes', data: monthKeys.map(k => pendingByMonth[k]) },
      { name: 'Falhas', data: monthKeys.map(k => failedByMonth[k]) }
    ]
  }
})
