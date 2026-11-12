import { defineEventHandler, getQuery } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchAllOrganizationRows } from '../../utils/supabase-pagination'
import { parseDateRange, toNumber, formatDateKey, formatDayLabel, normalizeReportStatus } from '../../utils/report-helpers'

interface OverviewItem { description?: string, name?: string, quantity?: unknown }
interface OverviewOrder { entry_date?: string | null, status?: string | null, total_amount?: unknown, total_cost_amount?: unknown, client_id?: string | null, items?: OverviewItem[] | null }
interface OverviewClient { created_at?: string | null }
interface OverviewTransaction { due_date?: string | null, type?: string | null, status?: unknown, amount?: unknown }

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const query = getQuery(event)

  // Default to current month
  const now = new Date()
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const fromStr = String(query.dateFrom || defaultFrom)
  const toStr = String(query.dateTo || (query.dateFrom ? query.dateFrom : defaultTo))
  const { dateFrom, dateTo } = parseDateRange(fromStr, toStr) as { dateFrom: Date, dateTo: Date }

  const [orders, clients, transactions] = await Promise.all([
    fetchAllOrganizationRows<OverviewOrder>(supabase, {
      table: 'service_orders',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'created_at' }
    }),
    fetchAllOrganizationRows<OverviewClient>(supabase, {
      table: 'clients',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'created_at' }
    }),
    fetchAllOrganizationRows<OverviewTransaction>(supabase, {
      table: 'financial_transactions',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'due_date' }
    })
  ])

  const ordersInPeriod = orders.filter((o) => {
    const entryDate = o?.entry_date ? new Date(`${o.entry_date}T00:00:00`) : null
    return entryDate && !Number.isNaN(entryDate.getTime()) && entryDate >= dateFrom && entryDate <= dateTo
  })

  const newClientsCount = clients.filter((c) => {
    const createdAt = c?.created_at ? new Date(c.created_at) : null
    return createdAt && !Number.isNaN(createdAt.getTime()) && createdAt >= dateFrom && createdAt <= dateTo
  }).length

  const completedOrders = ordersInPeriod.filter(o => o?.status === 'completed' || o?.status === 'invoiced' || o?.status === 'delivered')

  const costsInPeriod = transactions.filter((t) => {
    const dueDate = t?.due_date ? new Date(`${t.due_date}T00:00:00`) : null
    return dueDate && !Number.isNaN(dueDate.getTime()) && t?.type === 'expense' && normalizeReportStatus(t?.status) === 'paid' && dueDate >= dateFrom && dueDate <= dateTo
  })

  const grossRevenue = completedOrders.reduce((sum: number, o) => sum + toNumber(o?.total_amount, 0), 0)
  const totalCosts = costsInPeriod.reduce((sum: number, t) => sum + toNumber(t?.amount, 0), 0)
  const itemsCost = completedOrders.reduce((sum: number, o) => sum + toNumber(o?.total_cost_amount, 0), 0)
  const netProfit = grossRevenue - totalCosts
  const profitMargin = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0
  const averageTicket = completedOrders.length > 0 ? grossRevenue / completedOrders.length : 0
  const activeClients = new Set(completedOrders.map(o => String(o?.client_id || ''))).size

  // Daily chart
  const dailyData: Record<string, { revenue: number, cost: number }> = {}
  const cursor = new Date(dateFrom)
  while (cursor <= dateTo) {
    dailyData[formatDateKey(cursor)] = { revenue: 0, cost: 0 }
    cursor.setDate(cursor.getDate() + 1)
  }
  for (const o of completedOrders) {
    const key = String(o?.entry_date || '')
    if (dailyData[key]) dailyData[key].revenue += toNumber(o?.total_amount, 0)
  }
  for (const t of costsInPeriod) {
    const key = String(t?.due_date || '')
    if (dailyData[key]) dailyData[key].cost += toNumber(t?.amount, 0)
  }
  const chartData = Object.entries(dailyData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ name: formatDayLabel(date), ...v }))

  // Top items by quantity
  const itemCounts: Record<string, number> = {}
  for (const o of completedOrders) {
    const items = Array.isArray(o?.items) ? o.items : []
    for (const item of items) {
      const desc = String(item?.description || item?.name || 'Unknown')
      itemCounts[desc] = (itemCounts[desc] || 0) + (Number(item?.quantity) || 1)
    }
  }
  const topItems = Object.entries(itemCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }))

  return {
    data: {
      overview: {
        grossRevenue,
        totalCosts,
        itemsCost,
        netProfit,
        profitMargin,
        averageTicket,
        activeClients,
        totalOrders: completedOrders.length,
        newClients: newClientsCount,
        chartData,
        topItems
      }
    }
  }
})
