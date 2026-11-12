import { defineEventHandler, getQuery } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchAllOrganizationRows } from '../../utils/supabase-pagination'
import { toNumber, qArr, paginate, sortFactor, formatDayLabel, getPurchasePaymentStatus } from '../../utils/report-helpers'

interface PurchaseRecord {
  supplier_id?: string | null
  purchase_date?: string | null
  total_amount?: number | string | null
  invoice_number?: string | null
  due_date?: string | null
  payment_status?: string | null
  [key: string]: unknown
}

interface SupplierRecord {
  id: string
  name?: string | null
}

interface PurchaseReportItem extends PurchaseRecord {
  supplierName: string
  paymentStatus: string
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const query = getQuery(event)

  const dateFrom = parseDateStart(query.dateFrom as string)
  const dateTo = parseDateEnd(query.dateTo as string)
  const supplierIds = qArr(query.supplierIds as string | string[] | undefined)
  const statusFilters = qArr(query.status as string | string[] | undefined).filter(status => ['pending', 'paid', 'overdue'].includes(status))
  const searchTerm = String(query.searchTerm || '').trim().toLowerCase()
  const sortBy = ['purchase_date', 'total_amount', 'supplier', 'invoice_number', 'status'].includes(query.sortBy as string) ? String(query.sortBy) : 'purchase_date'
  const sortOrder: 'asc' | 'desc' = query.sortOrder === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Math.floor(toNumber(query.page, 1)))
  const pageSize = Math.min(100, Math.max(1, Math.floor(toNumber(query.pageSize, 20))))

  const [purchasesRaw, suppliers] = await Promise.all([
    fetchAllOrganizationRows<PurchaseRecord>(supabase, {
      table: 'purchases',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'purchase_date' }
    }),
    fetchAllOrganizationRows<SupplierRecord>(supabase, {
      table: 'suppliers',
      organizationId,
      nullColumns: ['deleted_at']
    })
  ])
  const suppliersMap = new Map<string, SupplierRecord>(suppliers.map(s => [String(s.id), s]))

  let filteredPurchases: PurchaseReportItem[] = purchasesRaw.map(p => ({
    ...p,
    supplierName: suppliersMap.get(String(p?.supplier_id || ''))?.name || 'Sem fornecedor',
    paymentStatus: getPurchasePaymentStatus(p)
  }))

  if (dateFrom || dateTo) {
    filteredPurchases = filteredPurchases.filter((p) => {
      const purchaseDate = p?.purchase_date ? new Date(`${p.purchase_date}T00:00:00`) : null
      if (!purchaseDate || Number.isNaN(purchaseDate.getTime())) return false
      if (dateFrom && purchaseDate < dateFrom) return false
      if (dateTo && purchaseDate > dateTo) return false
      return true
    })
  }

  if (supplierIds.length > 0) filteredPurchases = filteredPurchases.filter(p => supplierIds.includes(String(p?.supplier_id || '')))
  if (statusFilters.length > 0) filteredPurchases = filteredPurchases.filter(p => statusFilters.includes(String(p.paymentStatus || '')))
  if (searchTerm) {
    filteredPurchases = filteredPurchases.filter(p =>
      p.supplierName.toLowerCase().includes(searchTerm)
      || String(p?.invoice_number || '').toLowerCase().includes(searchTerm)
    )
  }

  const factor = sortFactor(sortOrder)
  filteredPurchases.sort((a, b) => {
    if (sortBy === 'total_amount') return (toNumber(a?.total_amount, 0) - toNumber(b?.total_amount, 0)) * factor
    if (sortBy === 'supplier') return a.supplierName.localeCompare(b.supplierName, 'pt-BR', { sensitivity: 'base' }) * factor
    if (sortBy === 'invoice_number') return String(a?.invoice_number || '').localeCompare(String(b?.invoice_number || '')) * factor
    if (sortBy === 'status') return String(a.paymentStatus || '').localeCompare(String(b.paymentStatus || ''), 'pt-BR', { sensitivity: 'base' }) * factor
    return String(a?.purchase_date || '').localeCompare(String(b?.purchase_date || '')) * factor
  })

  const totalPurchased = filteredPurchases.reduce((s: number, p) => s + toNumber(p?.total_amount, 0), 0)
  const totalPaid = filteredPurchases.filter(p => p.paymentStatus === 'paid').reduce((s: number, p) => s + toNumber(p?.total_amount, 0), 0)

  // Chart: top 10 suppliers by total
  const supplierTotals: Record<string, { name: string, total: number }> = {}
  for (const p of filteredPurchases) {
    const name = p.supplierName
    if (!supplierTotals[name]) supplierTotals[name] = { name, total: 0 }
    supplierTotals[name].total += toNumber(p?.total_amount, 0)
  }
  const bySupplierChart = Object.values(supplierTotals).sort((a, b) => b.total - a.total).slice(0, 10)

  // Chart: daily totals
  const dailyMap: Record<string, number> = {}
  for (const p of filteredPurchases) {
    const d = String(p?.purchase_date || '')
    if (!d) continue
    dailyMap[d] = (dailyMap[d] || 0) + toNumber(p?.total_amount, 0)
  }
  if (dateFrom && dateTo) {
    const cursor = new Date(dateFrom)
    while (cursor <= dateTo) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      if (!dailyMap[key]) dailyMap[key] = 0
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  const byDayChart = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ name: formatDayLabel(date), total }))

  const { data: paginatedItems, pagination } = paginate(filteredPurchases, page, pageSize)

  return {
    data: {
      items: paginatedItems,
      pagination,
      summary: { totalPurchased, totalPaid, totalPending: totalPurchased - totalPaid, count: filteredPurchases.length },
      charts: { bySupplier: bySupplierChart, byDay: byDayChart },
      suppliers: suppliers.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR'))
    }
  }
})
