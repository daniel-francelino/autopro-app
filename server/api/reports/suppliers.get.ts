import { defineEventHandler, getQuery } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchAllOrganizationRows } from '../../utils/supabase-pagination'
import { parseDateRange, toNumber, qArr, paginate, sortFactor } from '../../utils/report-helpers'

interface PurchaseItemRecord {
  description?: string | null
  quantity?: number | string | null
}

interface PurchaseRecord {
  id?: string | null
  supplier_id?: string | null
  total_amount?: number | string | null
  purchase_date?: string | null
  items?: PurchaseItemRecord[] | null
}

interface SupplierRecord {
  id: string
  name?: string | null
  trade_name?: string | null
  phone?: string | null
  email?: string | null
  contact_name?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  tax_id?: string | null
}

interface SupplierStats {
  totalPurchased: number
  purchaseCount: number
  itemCount: number
  lastPurchase: string | null
  topItemsMap: Record<string, number>
}

interface SupplierReportItem {
  id: string
  name: string
  tradeName: string | null
  phone: string | null
  email: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  taxId: string | null
  totalPurchased: number
  purchaseCount: number
  itemCount: number
  averagePurchase: number
  lastPurchase: string | null
  topItems: Array<[string, number]>
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'reports.suppliers', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const query = getQuery(event)

  const { dateFrom, dateTo } = parseDateRange(query.dateFrom as string, query.dateTo as string)
  const supplierIds = qArr(query.supplierIds as string | string[] | undefined)
  const selectedSupplierId = query.selectedSupplierId ? String(query.selectedSupplierId) : null
  const searchTerm = String(query.searchTerm || '').trim().toLowerCase()
  const sortBy = ['name', 'totalPurchased', 'purchaseCount', 'itemCount', 'averagePurchase', 'lastPurchase'].includes(query.sortBy as string)
    ? String(query.sortBy)
    : 'totalPurchased'
  const sortOrder: 'asc' | 'desc' = query.sortOrder === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Math.floor(toNumber(query.page, 1)))
  const pageSize = Math.min(100, Math.max(1, Math.floor(toNumber(query.pageSize, 10))))

  const [allPurchases, suppliers] = await Promise.all([
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
  const suppliersMap = new Map<string, SupplierRecord>(suppliers.map(supplier => [String(supplier.id), supplier]))

  let filteredPurchases = allPurchases
  if (dateFrom || dateTo) {
    filteredPurchases = filteredPurchases.filter((purchase) => {
      const purchaseDate = purchase?.purchase_date ? new Date(`${purchase.purchase_date}T00:00:00`) : null
      if (!purchaseDate || Number.isNaN(purchaseDate.getTime())) return false
      if (dateFrom && purchaseDate < dateFrom) return false
      if (dateTo && purchaseDate > dateTo) return false
      return true
    })
  }
  if (supplierIds.length > 0) {
    filteredPurchases = filteredPurchases.filter(purchase => supplierIds.includes(String(purchase?.supplier_id || '')))
  }

  const supplierStats: Record<string, SupplierStats> = {}

  for (const purchase of filteredPurchases) {
    const supplierId = String(purchase?.supplier_id || '')
    if (!supplierId) continue
    if (!supplierStats[supplierId]) {
      supplierStats[supplierId] = {
        totalPurchased: 0,
        purchaseCount: 0,
        itemCount: 0,
        lastPurchase: null,
        topItemsMap: {}
      }
    }

    const stats = supplierStats[supplierId]
    stats.totalPurchased += toNumber(purchase?.total_amount, 0)
    stats.purchaseCount += 1

    const items = Array.isArray(purchase?.items) ? purchase.items : []
    for (const item of items) {
      const description = String(item?.description || 'Sem descrição')
      const quantity = Number(item?.quantity) || 1
      stats.itemCount += quantity
      stats.topItemsMap[description] = (stats.topItemsMap[description] || 0) + quantity
    }

    const purchaseDate = String(purchase?.purchase_date || '')
    if (purchaseDate && (!stats.lastPurchase || purchaseDate > stats.lastPurchase)) {
      stats.lastPurchase = purchaseDate
    }
  }

  let supplierItems: SupplierReportItem[] = Object.entries(supplierStats).map(([supplierId, stats]) => {
    const supplier = suppliersMap.get(supplierId)
    const topItems = Object.entries(stats.topItemsMap)
      .sort(([, amountA], [, amountB]) => amountB - amountA)
      .slice(0, 5)

    return {
      id: supplierId,
      name: supplier?.name || 'Fornecedor sem nome',
      tradeName: supplier?.trade_name || null,
      phone: supplier?.phone || null,
      email: supplier?.email || null,
      contactName: supplier?.contact_name || null,
      contactPhone: supplier?.contact_phone || null,
      contactEmail: supplier?.contact_email || null,
      taxId: supplier?.tax_id || null,
      totalPurchased: stats.totalPurchased,
      purchaseCount: stats.purchaseCount,
      itemCount: stats.itemCount,
      averagePurchase: stats.purchaseCount > 0 ? stats.totalPurchased / stats.purchaseCount : 0,
      lastPurchase: stats.lastPurchase,
      topItems
    }
  })

  if (searchTerm) {
    supplierItems = supplierItems.filter((supplier) => {
      const haystack = [
        supplier.name,
        supplier.tradeName,
        supplier.phone,
        supplier.email,
        supplier.contactName,
        supplier.contactPhone,
        supplier.contactEmail,
        supplier.taxId
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(searchTerm)
    })
  }

  const factor = sortFactor(sortOrder)
  supplierItems.sort((supplierA, supplierB) => {
    if (sortBy === 'totalPurchased') return (supplierA.totalPurchased - supplierB.totalPurchased) * factor
    if (sortBy === 'purchaseCount') return (supplierA.purchaseCount - supplierB.purchaseCount) * factor
    if (sortBy === 'itemCount') return (supplierA.itemCount - supplierB.itemCount) * factor
    if (sortBy === 'averagePurchase') return (supplierA.averagePurchase - supplierB.averagePurchase) * factor
    if (sortBy === 'lastPurchase') return String(supplierA.lastPurchase || '').localeCompare(String(supplierB.lastPurchase || '')) * factor
    return supplierA.name.localeCompare(supplierB.name, 'pt-BR', { sensitivity: 'base' }) * factor
  })

  const charts = {
    topSuppliers: [...supplierItems]
      .sort((supplierA, supplierB) => supplierB.totalPurchased - supplierA.totalPurchased)
      .slice(0, 10)
      .map(supplier => ({
        name: supplier.name,
        total: supplier.totalPurchased
      }))
  }

  const summary = {
    totalPurchased: supplierItems.reduce((sum, supplier) => sum + supplier.totalPurchased, 0),
    supplierCount: supplierItems.length,
    purchaseCount: supplierItems.reduce((sum, supplier) => sum + supplier.purchaseCount, 0),
    itemCount: supplierItems.reduce((sum, supplier) => sum + supplier.itemCount, 0)
  }

  const { data: paginatedItems, pagination } = paginate(supplierItems, page, pageSize)

  const result: {
    data: {
      suppliersReport: {
        availableSuppliers: Array<{ value: string, label: string }>
        items: SupplierReportItem[]
        charts: { topSuppliers: Array<{ name: string, total: number }> }
        summary: {
          totalPurchased: number
          supplierCount: number
          purchaseCount: number
          itemCount: number
        }
        pagination: ReturnType<typeof paginate<SupplierReportItem>>['pagination']
        sort: { sortBy: string, sortOrder: 'asc' | 'desc' }
        selectedSupplierDaily?: Array<{ name: string, total: number }>
      }
    }
  } = {
    data: {
      suppliersReport: {
        availableSuppliers: suppliers
          .map(supplier => ({ value: supplier.id, label: supplier.name || 'Fornecedor sem nome' }))
          .sort((supplierA, supplierB) => supplierA.label.localeCompare(supplierB.label, 'pt-BR', { sensitivity: 'base' })),
        items: paginatedItems,
        charts,
        summary,
        pagination,
        sort: { sortBy, sortOrder }
      }
    }
  }

  if (selectedSupplierId) {
    const dailyMap: Record<string, number> = {}

    for (const purchase of filteredPurchases.filter(purchase => String(purchase?.supplier_id || '') === selectedSupplierId)) {
      const dateKey = String(purchase?.purchase_date || '')
      if (!dateKey) continue
      dailyMap[dateKey] = (dailyMap[dateKey] || 0) + toNumber(purchase?.total_amount, 0)
    }

    result.data.suppliersReport.selectedSupplierDaily = Object.entries(dailyMap)
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([name, total]) => ({ name, total }))
  }

  return result
})
