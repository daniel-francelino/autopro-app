import { defineEventHandler, getQuery } from 'h3'
import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'

/**
 * GET /api/admin/subscriptions
 * Lists all subscriptions with organization name for admin use.
 * Restricted to users with is_owner = true.
 *
 * Query params:
 *   page      — page number (1-based, default 1)
 *   page_size — items per page (default 30, max 100)
 *   search    — filter by org name or email
 *   status    — filter by status
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const supabase = getSupabaseAdminClient()
  const query = getQuery(event)

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.max(1, Math.min(Number(query.page_size) || 30, 100))
  const offset = (page - 1) * pageSize
  const search = String(query.search || '').trim()
  const statusFilter = String(query.status || '').trim()

  let dbQuery = supabase
    .from('subscriptions')
    .select('*', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (statusFilter) {
    dbQuery = dbQuery.eq('status', statusFilter)
  }

  if (search) {
    dbQuery = dbQuery.or(`user_email.ilike.%${search}%,plan_name.ilike.%${search}%`)
  }

  const { data, error, count } = await dbQuery

  if (error) {
    console.error('[admin/subscriptions] Supabase error:', error)
    throw createError({ statusCode: 500, statusMessage: 'Erro ao listar assinaturas' })
  }

  const orgIds = [...new Set((data || []).map((s: { organization_id: string | null }) => s.organization_id).filter(Boolean) as string[])]
  const orgNameMap: Record<string, string> = {}

  if (orgIds.length > 0) {
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name')
      .in('id', orgIds)

    for (const org of orgs || []) {
      orgNameMap[org.id] = org.name || '—'
    }
  }

  const items = (data || []).map((sub: Record<string, unknown>) => ({
    ...sub,
    organization_name: orgNameMap[sub.organization_id] ?? '—'
  }))

  return { items, total: count ?? items.length, page, page_size: pageSize }
})
