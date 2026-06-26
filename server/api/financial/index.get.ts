import { defineEventHandler, getQuery, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'

/**
 * GET /api/financial
 * List financial transactions with filtering and pagination.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const query = getQuery(event)
  const search = String(query.search || '').trim().toLowerCase()
  const statusFilter = String(query.status || 'all')
  const typeFilter = String(query.type || 'all')
  const categoryId = String(query.category_id || '').trim()
  const category = String(query.category || '').trim().toLowerCase()
  const dateFrom = query.date_from ? String(query.date_from) : null
  const dateTo = query.date_to ? String(query.date_to) : (dateFrom ?? null)
  const page = Math.max(1, parseInt(String(query.page || '1'), 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(query.page_size || '20'), 10)))

  let q = supabase
    .from('financial_transactions')
    .select('*, category_ref:financial_categories(id, name, icon, color)', { count: 'exact' })
    .eq('organization_id', organizationId)
    .is('deleted_at', null)

  if (statusFilter !== 'all') q = q.eq('status', statusFilter)
  if (typeFilter !== 'all') q = q.eq('type', typeFilter)
  if (categoryId) q = q.eq('category_id', categoryId)
  else if (category) q = q.ilike('category', `%${category}%`)
  if (dateFrom) q = q.gte('due_date', dateFrom)
  if (dateTo) q = q.lte('due_date', dateTo)
  if (search) q = q.ilike('description', `%${search}%`)

  q = q.order('due_date', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1)

  const { data, error, count } = await q

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return {
    items: data ?? [],
    total: count ?? 0,
    page,
    page_size: pageSize
  }
})
