<script setup lang="ts">
import type { SortingState } from '@tanstack/vue-table'
import type { SupplierDetailData } from '~/components/reports/suppliers/SuppliersDetailSlideover.vue'

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

interface SuppliersReportResponse {
  data?: {
    suppliersReport?: {
      availableSuppliers?: Array<{ value: string, label: string }>
      items?: SupplierReportItem[]
      charts?: { topSuppliers?: Array<{ name: string, total: number }> }
      summary?: {
        totalPurchased?: number
        supplierCount?: number
        purchaseCount?: number
        itemCount?: number
      }
      pagination?: { totalItems?: number } | null
      selectedSupplierDaily?: Array<{ name: string, total: number }>
    }
  }
}

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Relatório de Fornecedores' })

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const toast = useToast()

const { dateFrom, dateTo } = useReportDateRange()
const search = useReportQueryParam('q', '')
const page = useReportQueryParam('page', 1)
const pageSize = 20
const supplierIds = useReportQueryParam('suppliers', [] as string[])
const detailOpen = ref(false)
const detailLoading = ref(false)
const detailData = ref<SupplierDetailData | null>(null)

const sortByParam = useReportQueryParam<string>('sortBy', 'totalPurchased')
const sortOrderParam = useReportQueryParam<string>('sortOrder', 'desc')
const sorting = computed<SortingState>({
  get: () => [{ id: sortByParam.value, desc: sortOrderParam.value !== 'asc' }],
  set: (val) => {
    sortByParam.value = val[0]?.id ?? 'totalPurchased'
    sortOrderParam.value = val[0]?.desc === false ? 'asc' : 'desc'
    page.value = 1
  }
})

const sortByMap: Record<string, string> = {
  name: 'name',
  totalPurchased: 'totalPurchased',
  purchaseCount: 'purchaseCount',
  itemCount: 'itemCount',
  averagePurchase: 'averagePurchase',
  lastPurchase: 'lastPurchase'
}

const sortBy = computed(() => sortByMap[sortByParam.value] ?? 'totalPurchased')
const sortOrder = computed(() => sortOrderParam.value)

watch([dateFrom, dateTo, search, supplierIds, sortBy, sortOrder], () => {
  page.value = 1
})

const queryKey = computed(() =>
  `report-suppliers-${dateFrom.value}-${dateTo.value}-${page.value}-${search.value}-${supplierIds.value.join(',')}-${sortBy.value}-${sortOrder.value}`
)

const { data, status } = await useAsyncData(
  () => queryKey.value,
  () => requestFetch<SuppliersReportResponse>('/api/reports/suppliers', {
    headers: requestHeaders,
    query: {
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      page: page.value,
      pageSize,
      searchTerm: search.value || undefined,
      supplierIds: supplierIds.value.length ? supplierIds.value : undefined,
      sortBy: sortBy.value,
      sortOrder: sortOrder.value
    }
  }),
  { watch: [queryKey] }
)

const report = computed(() => data.value?.data?.suppliersReport)
const items = computed<SupplierReportItem[]>(() => report.value?.items ?? [])
const summary = computed(() => report.value?.summary ?? {})
const charts = computed(() => report.value?.charts ?? { topSuppliers: [] })
const pagination = computed(() => report.value?.pagination ?? null)
const availableSuppliers = computed(() => report.value?.availableSuppliers ?? [])

const columns = [
  { accessorKey: 'name', header: 'Fornecedor' },
  { accessorKey: 'totalPurchased', header: 'Total comprado' },
  { accessorKey: 'purchaseCount', header: 'Compras' },
  { accessorKey: 'itemCount', header: 'Itens' },
  { accessorKey: 'averagePurchase', header: 'Ticket médio' },
  { accessorKey: 'lastPurchase', header: 'Última compra' },
  { id: 'actions', header: '', enableSorting: false }
]

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(v: string | null | undefined) {
  if (!v) return '—'
  const [year, month, day] = v.split('-')
  if (!year || !month || !day) return '—'
  return `${day}/${month}/${year}`
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0]?.charAt(0) ?? '?').toUpperCase()
  return ((parts[0]?.charAt(0) ?? '') + (parts[parts.length - 1]?.charAt(0) ?? '')).toUpperCase()
}

async function openDetail(row: SupplierReportItem) {
  detailOpen.value = true
  detailLoading.value = true
  detailData.value = null

  try {
    const response = await $fetch<SuppliersReportResponse>('/api/reports/suppliers', {
      query: {
        selectedSupplierId: row.id,
        dateFrom: dateFrom.value,
        dateTo: dateTo.value,
        supplierIds: supplierIds.value.length ? supplierIds.value : undefined,
        searchTerm: search.value || undefined
      }
    })

    detailData.value = {
      ...row,
      daily: response.data?.suppliersReport?.selectedSupplierDaily ?? []
    }
  } catch {
    toast.add({ title: 'Erro ao carregar detalhes do fornecedor', color: 'error' })
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Relatório de Fornecedores" />
    </template>

    <template #body>
      <div class="space-y-4 p-4">
        <ReportsSuppliersFilters
          v-model:date-from="dateFrom"
          v-model:date-to="dateTo"
          v-model:supplier-ids="supplierIds"
          :suppliers="availableSuppliers"
        />

        <ReportsSuppliersSummary :summary="summary" />

        <ReportsSuppliersCharts :top-suppliers="charts.topSuppliers ?? []" />

        <AppDataTable
          v-model:page="page"
          v-model:sorting="sorting"
          v-model:search-term="search"
          :columns="columns"
          :data="items as Record<string, unknown>[]"
          :loading="status === 'pending'"
          :page-size="pageSize"
          :total="pagination?.totalItems ?? items.length"
          :show-page-size-selector="false"
          show-search
          search-placeholder="Buscar fornecedor..."
          empty-icon="i-lucide-building-2"
          empty-title="Nenhum fornecedor encontrado"
          empty-description="Não há fornecedores com compras nos filtros selecionados."
          @search-change="page = 1"
        >
          <template #name-cell="{ row }">
            <div class="flex items-center gap-2">
              <div class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <span class="text-xs font-bold text-primary">
                  {{ getInitials(String(row.original.name ?? '')) }}
                </span>
              </div>
              <div class="min-w-0">
                <p class="truncate font-medium text-highlighted">
                  {{ row.original.name }}
                </p>
                <p
                  v-if="row.original.tradeName || row.original.contactName"
                  class="truncate text-xs text-muted"
                >
                  {{ row.original.tradeName || row.original.contactName }}
                </p>
              </div>
            </div>
          </template>

          <template #totalPurchased-cell="{ row }">
            <span class="font-medium text-primary">
              {{ formatCurrency(Number(row.original.totalPurchased ?? 0)) }}
            </span>
          </template>

          <template #purchaseCount-cell="{ row }">
            {{ row.original.purchaseCount ?? 0 }}
          </template>

          <template #itemCount-cell="{ row }">
            {{ row.original.itemCount ?? 0 }}
          </template>

          <template #averagePurchase-cell="{ row }">
            {{ formatCurrency(Number(row.original.averagePurchase ?? 0)) }}
          </template>

          <template #lastPurchase-cell="{ row }">
            {{ formatDate(String(row.original.lastPurchase ?? '')) }}
          </template>

          <template #actions-cell="{ row }">
            <UButton
              icon="i-lucide-eye"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="openDetail(row.original as SupplierReportItem)"
            />
          </template>
        </AppDataTable>
      </div>

      <ReportsSuppliersDetailSlideover
        :open="detailOpen"
        :loading="detailLoading"
        :data="detailData"
        @update:open="detailOpen = $event"
      />
    </template>
  </UDashboardPanel>
</template>
