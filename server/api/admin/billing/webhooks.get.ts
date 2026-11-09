import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'

const STATUSES = ['received', 'processed', 'ignored', 'failed']

/** GET /api/admin/billing/webhooks?status=&page= — eventos recebidos do Stripe (sem o payload). */
export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = 50
  const status = typeof query.status === 'string' && STATUSES.includes(query.status) ? query.status : null

  let db = getSupabaseAdminClient()
    .from('stripe_webhook_events')
    .select('id, type, received_at, processed_at, status, error_message, organization_id', { count: 'exact' })
    .order('received_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)
  if (status) db = db.eq('status', status)

  const { data, error, count } = await db
  if (error) {
    // 42P01 = tabela inexistente (migration 102 ainda não aplicada)
    const missing = error.code === '42P01' || error.code === 'PGRST205'
    throw createError({
      statusCode: missing ? 503 : 500,
      statusMessage: missing ? 'Aplique a migration 20240101000102_create_stripe_webhook_events.sql.' : 'Erro ao listar eventos'
    })
  }
  return { data: data ?? [], total: count ?? 0, page, pageSize }
})
