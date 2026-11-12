import { defineEventHandler, getQuery } from 'h3'
import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'

/**
 * GET /api/admin/invoices
 * Lists all billing invoices for admin use.
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
    .from('billing_invoices')
    .select(
      'id, organization_id, user_email, stripe_invoice_id, invoice_number, amount, status, issue_date, due_date, payment_date, pdf_url, created_at',
      { count: 'exact' }
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (statusFilter) {
    dbQuery = dbQuery.eq('status', statusFilter)
  }

  if (search) {
    dbQuery = dbQuery.or(`user_email.ilike.%${search}%,invoice_number.ilike.%${search}%`)
  }

  const { data, error, count } = await dbQuery

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Erro ao listar faturas' })
  }

  const orgIds = [...new Set((data || []).map((inv: { organization_id?: string | null }) => inv.organization_id).filter(Boolean))]
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

  const items = (data || []).map((inv: { organization_id?: string | null }) => ({
    ...inv,
    organization_name: orgNameMap[inv.organization_id as string] ?? '—'
  }))

  return { items, total: count ?? items.length, page, page_size: pageSize }
})
