import { defineEventHandler, getQuery, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'

/**
 * GET /api/financial/summary
 * Returns aggregate totals (total / paid / pending) for the current filters.
 * Only fetches type, status, amount — no pagination, lightweight.
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

  const { data, error } = await q

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const items = data ?? []

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
