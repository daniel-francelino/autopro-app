import { defineEventHandler, getQuery } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchAllOrganizationRows, type SupabaseReportRow } from '../../utils/supabase-pagination'
import { parseDateRange, toNumber, qArr, formatDateKey, formatDayLabel, normalizeStatusFilters, matchesStatusFilters, paginate, sortFactor, getPreviousRangeByMode, calculateVariation, getComparisonModeLabel, formatPeriodLabel, normalizeReportStatus } from '../../utils/report-helpers'
import { enforceReportAccess } from '../../utils/license'

type ReportRow = SupabaseReportRow

const UNCATEGORIZED_KEY = 'uncategorized'
const UNCATEGORIZED_META = { name: 'Sem categoria', icon: 'i-lucide-circle-help', color: '#64748b' }

function calculatePeriodData(orders: ReportRow[], transactions: ReportRow[], start: Date, end: Date, statusFilters: string[]) {
  const periodOrders = orders.filter((o: ReportRow) => {
    const entryDate = o?.entry_date ? new Date(`${o.entry_date}T00:00:00`) : null
    const isCompleted = o?.status === 'completed' || o?.status === 'invoiced' || o?.status === 'delivered'
    return !!entryDate && !Number.isNaN(entryDate.getTime()) && isCompleted && matchesStatusFilters(o?.payment_status, statusFilters) && entryDate >= start && entryDate <= end
  })
  const periodCosts = transactions.filter((t: ReportRow) => {
    const dueDate = t?.due_date ? new Date(`${t.due_date}T00:00:00`) : null
    const isCost = t?.type === 'expense'
    const isCancelled = normalizeReportStatus(t?.status) === 'cancelled'
    return !!dueDate && !Number.isNaN(dueDate.getTime()) && isCost && !isCancelled && matchesStatusFilters(t?.status, statusFilters) && dueDate >= start && dueDate <= end
  })
  const revenue = periodOrders.reduce((acc: number, o: ReportRow) => acc + toNumber(o?.total_amount, 0), 0)
  const costs = periodCosts.reduce((acc: number, t: ReportRow) => acc + toNumber(t?.amount, 0), 0)
  const profit = revenue - costs
  return { revenue, costs, profit, profitMargin: revenue > 0 ? (profit / revenue) * 100 : 0, orderCount: periodOrders.length, orders: periodOrders, costsData: periodCosts }
}

function buildEvolutionData(periodData: { orders?: ReportRow[], costsData?: ReportRow[] } | null, start: Date, end: Date) {
  const dailyData: Record<string, { revenue: number, costs: number, profit: number }> = {}
  const cursor = new Date(start)
  while (cursor <= end) {
    dailyData[formatDateKey(cursor)] = { revenue: 0, costs: 0, profit: 0 }
    cursor.setDate(cursor.getDate() + 1)
  }
  for (const o of periodData?.orders || []) {
    const key = String(o?.entry_date || '')
    if (dailyData[key]) dailyData[key].revenue += toNumber(o?.total_amount, 0)
  }
  for (const t of periodData?.costsData || []) {
    const key = String(t?.due_date || '')
    if (dailyData[key]) dailyData[key].costs += toNumber(t?.amount, 0)
  }
  return Object.entries(dailyData).map(([date, v]) => ({ name: formatDayLabel(date), ...v, profit: v.revenue - v.costs }))
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)
  await enforceReportAccess(organizationId, 'costs')

  const query = getQuery(event)

  const dateFrom = parseDateStart(query.dateFrom as string)
  const dateTo = parseDateEnd(query.dateTo as string)
  const categoryRaw = query.category && query.category !== 'all' ? String(query.category) : null
  const categoryIdsFromParam = categoryRaw && categoryRaw.includes(',') ? categoryRaw.split(',').map((v: string) => v.trim()).filter(Boolean) : []
  const categoryIds = qArr(query.categoryIds)
  const combinedCategoryIds = categoryIds.length > 0 ? categoryIds : categoryIdsFromParam
  const categoryFilter = combinedCategoryIds.length === 0 && categoryRaw ? categoryRaw : null
  const statusFilters = normalizeStatusFilters(query.status)
  const searchTerm = String(query.searchTerm || '').trim().toLowerCase()
  const sortBy = ['category', 'amount', 'percentage'].includes(query.sortBy as string) ? String(query.sortBy) : 'amount'
  const sortOrder: 'asc' | 'desc' = query.sortOrder === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Math.floor(toNumber(query.page, 1)))
  const pageSize = Math.min(100, Math.max(1, Math.floor(toNumber(query.pageSize, 10))))
  const includeRawData = query.includeRawData === 'true'
  const includeProfitReport = query.includeProfitReport === 'true'
  const includeCategoryDetails = query.includeCategoryDetails === 'true'
  const compareWithPreviousPeriod = query.compareWithPreviousPeriod !== 'false'
  const compareMode = ['same_period_last_year', 'previous_month', 'previous_quarter'].includes(query.compareMode as string) ? String(query.compareMode) : 'previous_period'
  const selectedCategory = String(query.selectedCategory || '').trim()

  const [transactions, orders, categories] = await Promise.all([
    fetchAllOrganizationRows(supabase, {
      table: 'financial_transactions',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'due_date' }
    }),
    fetchAllOrganizationRows(supabase, {
      table: 'service_orders',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'created_at' }
    }),
    fetchAllOrganizationRows(supabase, {
      table: 'financial_categories',
      organizationId,
      columns: 'id, name, icon, color',
      nullColumns: ['deleted_at']
    })
  ])

  const categoriesById = new Map<string, { name: string, icon: string, color: string }>(
    (categories as Array<{ id: string, name: string, icon: string, color: string }>).map(c => [c.id, { name: c.name, icon: c.icon, color: c.color }])
  )

  function categoryMeta(categoryId: string) {
    if (categoryId === UNCATEGORIZED_KEY) return UNCATEGORIZED_META
    return categoriesById.get(categoryId) ?? UNCATEGORIZED_META
  }

  const expenseList = transactions.filter((t: ReportRow) => {
    if (t?.type !== 'expense') return false
    const st = normalizeReportStatus(t?.status)
    if (st === 'cancelled') return false
    if (statusFilters.length > 0 && !statusFilters.includes(st)) return false
    return true
  })

  const availableCategories = (Array.from(new Set(expenseList.map((t: ReportRow) => String(t?.category_id || UNCATEGORIZED_KEY)))) as string[])
    .map(categoryId => ({ id: categoryId, ...categoryMeta(categoryId) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))

  const filteredExpenses = expenseList.filter((t: ReportRow) => {
    const dueDate = t?.due_date ? new Date(`${t.due_date}T00:00:00`) : null
    if (!dueDate || Number.isNaN(dueDate.getTime())) return false
    if (dateFrom && dueDate < dateFrom) return false
    if (dateTo && dueDate > dateTo) return false
    const cat = String(t?.category_id || UNCATEGORIZED_KEY)
    if (combinedCategoryIds.length > 0 && !combinedCategoryIds.includes(cat)) return false
    if (categoryFilter && cat !== categoryFilter) return false
    if (searchTerm) {
      const description = String(t?.description || '').toLowerCase()
      const categoryLabel = categoryMeta(cat).name.toLowerCase()
      if (!description.includes(searchTerm) && !categoryLabel.includes(searchTerm)) return false
    }
    return true
  })

  const filteredOrders = orders.filter((o: ReportRow) => {
    const entryDate = o?.entry_date ? new Date(`${o.entry_date}T00:00:00`) : null
    if (!entryDate || Number.isNaN(entryDate.getTime())) return false
    if (dateFrom && entryDate < dateFrom) return false
    if (dateTo && entryDate > dateTo) return false
    if (!(o?.status === 'completed' || o?.status === 'invoiced' || o?.status === 'delivered')) return false
    return matchesStatusFilters(o?.payment_status, statusFilters)
  })

  const totalCosts = filteredExpenses.reduce((s: number, t: ReportRow) => s + toNumber(t?.amount, 0), 0)
  const totalRevenue = filteredOrders.reduce((s: number, o: ReportRow) => s + toNumber(o?.total_amount, 0), 0)
  const netProfit = totalRevenue - totalCosts
  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

  const categoryAmounts: Record<string, number> = {}
  for (const t of filteredExpenses) {
    const cat = String(t?.category_id || UNCATEGORIZED_KEY)
    categoryAmounts[cat] = (categoryAmounts[cat] || 0) + toNumber(t?.amount, 0)
  }

  const categoryRows = Object.entries(categoryAmounts).map(([categoryKey, amount]) => {
    const meta = categoryMeta(categoryKey)
    return {
      categoryKey,
      category: meta.name,
      icon: meta.icon,
      color: meta.color,
      amount,
      percentage: totalCosts > 0 ? (amount / totalCosts) * 100 : 0
    }
  })

  const factor = sortFactor(sortOrder)
  categoryRows.sort((a, b) => {
    if (sortBy === 'category') return a.category.localeCompare(b.category, 'pt-BR', { sensitivity: 'base' }) * factor
    if (sortBy === 'percentage') return (a.percentage - b.percentage) * factor
    return (a.amount - b.amount) * factor
  })

  const { data: categoryPage, pagination } = paginate(categoryRows, page, pageSize)

  const dailyMap: Record<string, { cost: number }> = {}
  for (const t of filteredExpenses) {
    const date = String(t?.due_date || '')
    if (!date) continue
    if (!dailyMap[date]) dailyMap[date] = { cost: 0 }
    dailyMap[date].cost += toNumber(t?.amount, 0)
  }
  const evolutionData = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ name: date, ...v }))

  const responseData: Record<string, unknown> = {
    costsReport: {
      availableCategories,
      summary: { totalCosts, totalRevenue, netProfit, profitMargin },
      charts: { categories: categoryRows, evolution: evolutionData },
      table: {
        items: categoryPage,
        pagination,
        sort: { sortBy, sortOrder, status: statusFilters.length > 0 ? statusFilters.join(',') : 'all' }
      }
    }
  }

  if (includeCategoryDetails && selectedCategory) {
    const categoryEntries = filteredExpenses
      .filter((t: ReportRow) => String(t?.category_id || UNCATEGORIZED_KEY) === selectedCategory)
      .sort((a: ReportRow, b: ReportRow) => String(b?.due_date || '').localeCompare(String(a?.due_date || '')))
    const totalCategoryValue = categoryEntries.reduce((s: number, t: ReportRow) => s + toNumber(t?.amount, 0), 0)
    const selectedMeta = categoryMeta(selectedCategory)
    responseData.costsCategoryDetails = {
      categoryKey: selectedCategory,
      category: selectedMeta.name,
      icon: selectedMeta.icon,
      color: selectedMeta.color,
      totalItems: categoryEntries.length,
      totalValue: totalCategoryValue,
      items: categoryEntries.map((t: ReportRow) => ({
        id: t?.id, description: t?.description || 'No description', category: selectedMeta.name,
        amount: toNumber(t?.amount, 0), status: normalizeReportStatus(t?.status),
        type: String(t?.type || 'expense').toLowerCase(), due_date: t?.due_date || null,
        recurrence: t?.recurrence || null, is_installment: Boolean(t?.is_installment),
        current_installment: t?.current_installment ?? null, installment_count: t?.installment_count ?? null,
        notes: t?.notes || null
      }))
    }
  }

  if (includeProfitReport) {
    const hasPeriod = !!dateFrom && !!dateTo
    const currentData = hasPeriod ? calculatePeriodData(orders, transactions, dateFrom, dateTo, statusFilters) : null
    let previousData = null
    let comparisonMeta = null
    if (hasPeriod && compareWithPreviousPeriod) {
      const { previousStartDate, previousEndDate } = getPreviousRangeByMode(dateFrom, dateTo, compareMode)
      previousData = calculatePeriodData(orders, transactions, previousStartDate, previousEndDate, statusFilters)
      comparisonMeta = {
        mode: compareMode, modeLabel: getComparisonModeLabel(compareMode),
        currentPeriodLabel: formatPeriodLabel(dateFrom, dateTo),
        previousPeriodLabel: formatPeriodLabel(previousStartDate, previousEndDate),
        currentStartDate: formatDateKey(dateFrom), currentEndDate: formatDateKey(dateTo),
        previousStartDate: formatDateKey(previousStartDate), previousEndDate: formatDateKey(previousEndDate)
      }
    }
    const topProfitableOrders = (currentData?.orders || []).map((o: ReportRow) => {
      const revenue = toNumber(o?.total_amount, 0)
      const cost = toNumber(o?.total_cost_amount, 0)
      const profit = revenue - cost
      return { number: o?.number, revenue, cost, profit, margin: revenue > 0 ? (profit / revenue) * 100 : 0 }
    }).sort((a, b) => b.profit - a.profit).slice(0, 10)

    const variations = currentData && previousData
      ? {
          revenue: calculateVariation(currentData.revenue, previousData.revenue),
          costs: calculateVariation(currentData.costs, previousData.costs),
          profit: calculateVariation(currentData.profit, previousData.profit),
          margin: calculateVariation(currentData.profitMargin, previousData.profitMargin)
        }
      : null

    responseData.profitReport = {
      currentData, previousData, variations, comparisonMeta,
      evolutionData: hasPeriod && currentData ? buildEvolutionData(currentData, dateFrom, dateTo) : [],
      topProfitableOrders
    }
  }

  if (includeRawData) {
    responseData.transactions = transactions
    responseData.orders = orders
  }

  return { data: responseData }
})
