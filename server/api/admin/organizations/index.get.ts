import { defineEventHandler, getQuery } from 'h3'
import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'

/**
 * GET /api/admin/organizations
 * Lists all organizations in the system for admin use.
 * Restricted to users with is_owner = true.
 *
 * Query params:
 *   search    — filter by name or tax_id
 *   page      — page number (1-based, default 1)
 *   page_size — items per page (default 30)
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const supabase = getSupabaseAdminClient()
  const query = getQuery(event)

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.max(1, Math.min(Number(query.page_size) || 30, 100))
  const offset = (page - 1) * pageSize
  const search = String(query.search || '').trim()

  let dbQuery = supabase
    .from('organizations')
    .select('id, name, tax_id, email, phone, created_at, is_active, suspended_at', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (search) {
    dbQuery = dbQuery.or(`name.ilike.%${search}%,tax_id.ilike.%${search}%`)
  }

  const { data, error, count } = await dbQuery

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Erro ao listar organizações' })
  }

  // Fetch user counts per org
  const orgIds = (data || []).map((o: any) => o.id)
  const userCountMap: Record<string, number> = {}

  if (orgIds.length > 0) {
    const { data: userCounts } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .in('organization_id', orgIds)
      .is('deleted_at', null)

    for (const row of userCounts || []) {
      userCountMap[row.organization_id] = (userCountMap[row.organization_id] || 0) + 1
    }
  }

  const items = (data || []).map((org: any) => ({
    ...org,
    user_count: userCountMap[org.id] || 0
  }))

  return {
    items,
    total: count ?? items.length,
    page,
    page_size: pageSize
  }
})
