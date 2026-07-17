import { defineEventHandler, getQuery, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'

/**
 * GET /api/financial/summary
 * Returns aggregate totals (total / paid / pending) for the current filters.
 * Only fetches type, status, amount, but pages through all matching rows.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const query = getQuery(event)
  const search = String(query.search || '').trim().toLowerCase()
  const typeFilter = String(query.type || 'all')
  const categoryId = query.category_id ? String(query.category_id) : null
  const dateFrom = query.date_from ? String(query.date_from) : null
  const dateTo = query.date_to ? String(query.date_to) : (dateFrom ?? null)

  // Supabase/PostgREST caps unranged selects at 1000 rows by default, so a wide
  // date range with many transactions would silently undercount — page through
  // all matching rows explicitly.
  const FETCH_PAGE_SIZE = 1000
  const items: Array<{ type: string, status: string, amount: string | number }> = []

  for (let offset = 0; ; offset += FETCH_PAGE_SIZE) {
    let q = supabase
      .from('financial_transactions')
      .select('type, status, amount')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)

    if (typeFilter !== 'all') q = q.eq('type', typeFilter)
    if (categoryId) q = q.eq('category_id', categoryId)
    if (dateFrom) q = q.gte('due_date', dateFrom)
    if (dateTo) q = q.lte('due_date', dateTo)
    if (search) q = q.ilike('description', `%${search}%`)

    const { data, error } = await q.range(offset, offset + FETCH_PAGE_SIZE - 1)

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })

    items.push(...(data ?? []))
    if (!data || data.length < FETCH_PAGE_SIZE) break
  }

  let totalIncome = 0, totalExpense = 0
  let paidIncome = 0, paidExpense = 0
  let pendingIncome = 0, pendingExpense = 0

  for (const item of items) {
    const type = String(item.type || '').toLowerCase()
    const status = String(item.status || '').toLowerCase()
    const amount = Number.parseFloat(String(item.amount || 0)) || 0

    if (type === 'income') {
      totalIncome += amount
      if (status === 'paid') paidIncome += amount
      else pendingIncome += amount
    } else if (type === 'expense') {
      totalExpense += amount
      if (status === 'paid') paidExpense += amount
      else pendingExpense += amount
    }
  }

  return {
    total: {
      income: totalIncome,
      expense: totalExpense,
      balance: totalIncome - totalExpense
    },
    paid: {
      income: paidIncome,
      expense: paidExpense,
      balance: paidIncome - paidExpense
    },
    pending: {
      income: pendingIncome,
      expense: pendingExpense,
      balance: pendingIncome - pendingExpense
    }
  }
})
