import { defineEventHandler } from 'h3'
import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'

/**
 * GET /api/admin/subscriptions/chart
 * Returns new and cancelled subscriptions per month for the last 12 months.
 * Restricted to users with is_owner = true.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const supabase = getSupabaseAdminClient()

  const now = new Date()
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)

  const { data, error } = await supabase
    .from('subscriptions')
    .select('created_at, cancellation_date, status')
    .gte('created_at', twelveMonthsAgo.toISOString())
    .is('deleted_at', null)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Erro ao buscar dados do gráfico' })
  }

  // Build last 12 months labels
  const months: string[] = []
  const monthKeys: string[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    months.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }))
  }

  const newByMonth: Record<string, number> = {}
  const cancelledByMonth: Record<string, number> = {}
  for (const key of monthKeys) {
    newByMonth[key] = 0
    cancelledByMonth[key] = 0
  }

  for (const sub of data || []) {
    if (sub.created_at) {
      const d = new Date(sub.created_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (key in newByMonth) newByMonth[key] = (newByMonth[key] ?? 0) + 1
    }
    if (sub.cancellation_date) {
      const d = new Date(sub.cancellation_date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (key in cancelledByMonth) cancelledByMonth[key] = (cancelledByMonth[key] ?? 0) + 1
    }
  }

  return {
    categories: months,
    series: [
      { name: 'Novas', data: monthKeys.map(k => newByMonth[k]) },
      { name: 'Canceladas', data: monthKeys.map(k => cancelledByMonth[k]) }
    ]
  }
})
