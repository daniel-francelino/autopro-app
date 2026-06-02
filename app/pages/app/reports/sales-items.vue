<script setup lang="ts">
import type { SortingState } from '@tanstack/vue-table'
import type { SalesItemsDetailData } from '~/components/reports/sales-items/SalesItemsDetailSlideover.vue'

interface SalesItemRow {
  id: string
  orderId: string
  clientId: string | null
  client: string
  orderNumber: string
  itemDescription: string
  quantity: number
  totalCost: number
  commissionCost: number
  totalCostWithCommission: number
  totalValue: number
  profit: number
  responsible: string
  status: string
  paymentStatus: string
  paymentMethod: string
  date: string
  categoryId: string | null
  categoryName: string
  costSource: 'item' | 'product' | 'none'
}

interface SalesOrderRow {
  id: string
  orderId: string
  clientId: string | null
  client: string
  orderNumber: string
  quantity: number
  totalCost: number
  commissionCost: number
  totalCostWithCommission: number
  totalValue: number
  profit: number
  responsible: string
  status: string
  paymentStatus: string
  paymentMethod: string
  date: string
  itemCount: number
}

interface SalesItemsReportResponse {
  data?: {
    salesItemsReport?: {
      filters?: {
        availableClients?: Array<{ value: string, label: string }>
        availableOrders?: Array<{ value: string, label: string }>
        availableResponsibles?: Array<{ value: string, label: string }>
        availableStatuses?: Array<{ value: string, label: string }>
        availableCategories?: Array<{ value: string, label: string }>
      }
      summary?: {
        totalQuantity?: number
        totalRevenue?: number
        totalCost?: number
        totalCommissionCost?: number
        totalProfit?: number
        itemCount?: number
        orderCount?: number
      }
      details?: SalesItemsDetailData | null
      charts?: {
        topItemsByQuantity?: Array<{ name: string, quantity: number, revenue: number }>
      }
      table?: {
        items?: Array<SalesItemRow | SalesOrderRow>
        pagination?: { totalItems?: number } | null
      }
    }
  }
}

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Itens Vendidos' })

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const toast = useToast()

const { dateFrom, dateTo, orderStatusFilters: statusFilters, paymentStatusFilters, paymentMethodFilters } = useReportDateRange()
const search = useReportQueryParam('q', '')
const pageSize = 20
const viewMode = useReportQueryParam('view', 'item' as 'item' | 'os')

const page = ref(1)
const accumulatedItems = ref<Array<SalesItemRow | SalesOrderRow>>([])
const totalFromServer = ref(0)

const clientIds = useReportQueryParam('clients', [] as string[])
const orderIds = useReportQueryParam('orders', [] as string[])
const responsibleIds = useReportQueryParam('responsibles', [] as string[])
const categoryIds = useReportQueryParam('categories', [] as string[])
const costFilters = useReportQueryParam('costFilters', [] as string[])
const costSources = useReportQueryParam('costSources', [] as string[])

const detailOpen = ref(false)
const detailLoading = ref(false)
const detailData = ref<SalesItemsDetailData | null>(null)
const exporting = ref<'csv' | 'pdf' | null>(null)

const exportItems = computed(() => [[
  {
    label: 'Exportar CSV',
    icon: 'i-lucide-file-spreadsheet',
    disabled: exporting.value !== null,
    onSelect: () => exportReport('csv')
  },
  {
    label: 'Exportar PDF',
    icon: 'i-lucide-file-text',
    disabled: exporting.value !== null,
    onSelect: () => exportReport('pdf')
  }
]])

const sortByParam = useReportQueryParam('sortBy', 'totalValue')
const sortOrderParam = useReportQueryParam('sortOrder', 'desc')
const sorting = computed<SortingState>({
  get: () => [{ id: sortByParam.value, desc: sortOrderParam.value !== 'asc' }],
  set: (val) => {
    sortByParam.value = val[0]?.id ?? 'totalValue'
    sortOrderParam.value = val[0]?.desc === false ? 'asc' : 'desc'
    accumulatedItems.value = []
    page.value = 1
  }
})
const sortByMap: Record<string, string> = {
  client: 'client',
  orderNumber: 'orderNumber',
  itemDescription: 'itemDescription',
  totalValue: 'totalValue',
  totalCost: 'totalCost',
  commissionCost: 'commissionCost',
  responsible: 'responsible',
  itemCount: 'itemCount'
}

const sortBy = computed(() => sortByMap[sortByParam.value] ?? 'totalValue')
const sortOrder = computed(() => sortOrderParam.value)

watch([
  dateFrom,
  dateTo,
  search,
  viewMode,
  clientIds,
  orderIds,
  responsibleIds,
  statusFilters,
  paymentStatusFilters,
  paymentMethodFilters,
  categoryIds,
  costFilters,
  costSources,
  sortBy,
  sortOrder
], () => {
  accumulatedItems.value = []
  page.value = 1
})

const queryKey = computed(() =>
  `report-sales-items-${dateFrom.value}-${dateTo.value}-${search.value}-${page.value}-${viewMode.value}-${clientIds.value.join(',')}-${orderIds.value.join(',')}-${responsibleIds.value.join(',')}-${statusFilters.value.join(',')}-${paymentStatusFilters.value.join(',')}-${paymentMethodFilters.value.join(',')}-${categoryIds.value.join(',')}-${costFilters.value.join(',')}-${costSources.value.join(',')}-${sortBy.value}-${sortOrder.value}`
)

const { data, status } = await useAsyncData(
  () => queryKey.value,
  () => requestFetch<SalesItemsReportResponse>('/api/reports/sales-items', {
    headers: requestHeaders,
    query: {
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      searchTerm: search.value || undefined,
      page: page.value,
      pageSize,
      viewMode: viewMode.value,
      clientIds: clientIds.value.length ? clientIds.value : undefined,
      orderIds: orderIds.value.length ? orderIds.value : undefined,
      responsibleIds: responsibleIds.value.length ? responsibleIds.value : undefined,
      statusFilters: statusFilters.value.length ? statusFilters.value : undefined,
      paymentStatusFilters: paymentStatusFilters.value.length ? paymentStatusFilters.value : undefined,
      paymentMethodFilters: paymentMethodFilters.value.length ? paymentMethodFilters.value : undefined,
      categoryIds: categoryIds.value.length ? categoryIds.value : undefined,
      costFilters: costFilters.value.length ? costFilters.value : undefined,
      costSources: costSources.value.length ? costSources.value : undefined,
      sortBy: sortBy.value,
      sortOrder: sortOrder.value
    }
  }),
  { watch: [queryKey] }
)

const report = computed(() => data.value?.data?.salesItemsReport)
const summary = computed(() => report.value?.summary ?? {})
const filters = computed(() => report.value?.filters ?? {})
const topItemsChart = computed(() => report.value?.charts?.topItemsByQuantity ?? [])

watch(data, (newData) => {
  const table = newData?.data?.salesItemsReport?.table
  const newItems = (table?.items ?? []) as Array<SalesItemRow | SalesOrderRow>
  totalFromServer.value = table?.pagination?.totalItems ?? 0
  if (page.value === 1) {
    accumulatedItems.value = newItems
  } else {
    accumulatedItems.value = [...accumulatedItems.value, ...newItems]
  }
}, { immediate: true })

const hasMore = computed(() => accumulatedItems.value.length < totalFromServer.value)
const loadingMore = computed(() => status.value === 'pending' && page.value > 1)

function loadMore() {
  if (hasMore.value && status.value !== 'pending') {
    page.value++
  }
}

const itemColumns = [
  { accessorKey: 'client', header: 'Cliente' },
  { accessorKey: 'orderNumber', header: 'OS' },
  { accessorKey: 'itemDescription', header: 'Item' },
  { accessorKey: 'responsible', header: 'Responsável' },
  { accessorKey: 'totalCost', header: 'Custo' },
  { accessorKey: 'commissionCost', header: 'Comissão' },
  { accessorKey: 'totalValue', header: 'Valor' },
  { id: 'actions', header: '', enableSorting: false }
]

const orderColumns = [
  { accessorKey: 'client', header: 'Cliente' },
  { accessorKey: 'orderNumber', header: 'OS' },
  { accessorKey: 'itemCount', header: 'Itens' },
  { accessorKey: 'responsible', header: 'Responsável' },
  { accessorKey: 'totalCost', header: 'Custo' },
  { accessorKey: 'commissionCost', header: 'Comissão' },
  { accessorKey: 'totalValue', header: 'Valor' },
  { id: 'actions', header: '', enableSorting: false }
]

const columns = computed(() => (viewMode.value === 'os' ? orderColumns : itemColumns))

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

function getResponsibleNames(value: string | null | undefined) {
  if (!value) return []

  return Array.from(
    new Set(
      value
        .split(',')
        .map(name => name.trim())
        .filter(Boolean)
    )
  )
}

async function openDetail(row: SalesItemRow | SalesOrderRow) {
  detailOpen.value = true
  detailLoading.value = true
  detailData.value = null

  try {
    const response = await $fetch<SalesItemsReportResponse>('/api/reports/sales-items', {
      query: {
        dateFrom: dateFrom.value,
        dateTo: dateTo.value,
        searchTerm: search.value || undefined,
        viewMode: viewMode.value,
        clientIds: clientIds.value.length ? clientIds.value : undefined,
        orderIds: orderIds.value.length ? orderIds.value : undefined,
        responsibleIds: responsibleIds.value.length ? responsibleIds.value : undefined,
        statusFilters: statusFilters.value.length ? statusFilters.value : undefined,
        paymentStatusFilters: paymentStatusFilters.value.length ? paymentStatusFilters.value : undefined,
        paymentMethodFilters: paymentMethodFilters.value.length ? paymentMethodFilters.value : undefined,
        categoryIds: categoryIds.value.length ? categoryIds.value : undefined,
        costFilters: costFilters.value.length ? costFilters.value : undefined,
        costSources: costSources.value.length ? costSources.value : undefined,
        includeDetails: 'true',
        selectedItemId: viewMode.value === 'item' ? row.id : undefined,
        selectedOrderId: viewMode.value === 'os' ? row.orderId : undefined
      }
    })

    detailData.value = response.data?.salesItemsReport?.details ?? null
  } catch {
    toast.add({ title: 'Erro ao carregar detalhes', color: 'error' })
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

async function exportReport(format: 'csv' | 'pdf') {
  exporting.value = format
  try {
    const response = await $fetch<{ success: boolean, data: { fileName: string, contentType: string, base64: string } }>(
      '/api/reports/export-sales-items',
      {
        method: 'POST',
        body: {
          format,
          viewMode: viewMode.value,
          dateFrom: dateFrom.value,
          dateTo: dateTo.value,
          clientIds: clientIds.value.length ? clientIds.value : undefined,
          orderIds: orderIds.value.length ? orderIds.value : undefined,
          responsibleIds: responsibleIds.value.length ? responsibleIds.value : undefined,
          statusFilters: statusFilters.value.length ? statusFilters.value : undefined,
          paymentStatusFilters: paymentStatusFilters.value.length ? paymentStatusFilters.value : undefined,
          paymentMethods: paymentMethodFilters.value.length ? paymentMethodFilters.value : undefined,
          categoryIds: categoryIds.value.length ? categoryIds.value : undefined,
          costFilter: costFilters.value.length ? costFilters.value : undefined,
          costSource: costSources.value.length ? costSources.value : undefined,
          sortBy: sortBy.value,
          sortOrder: sortOrder.value
        }
      }
    )

    if (response.data?.base64) {
      const binaryString = atob(response.data.base64)
      const bytes = new Uint8Array(binaryString.length)
      for (let index = 0; index < binaryString.length; index++) bytes[index] = binaryString.charCodeAt(index)
      const blob = new Blob([bytes], { type: response.data.contentType })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = response.data.fileName
      anchor.click()
      URL.revokeObjectURL(url)
    }
  } catch {
    toast.add({ title: 'Erro ao exportar relatório', color: 'error' })
  } finally {
    exporting.value = null
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader :title="viewMode === 'os' ? 'Relatório por Ordem de Serviço' : 'Itens Vendidos'" />
    </template>

    <template #body>
      <div class="space-y-4 p-4">
        <ReportsSalesItemsFilters
          v-model:date-from="dateFrom"
          v-model:date-to="dateTo"
          v-model:client-ids="clientIds"
          v-model:order-ids="orderIds"
          v-model:responsible-ids="responsibleIds"
          v-model:status-filters="statusFilters"
          v-model:payment-status-filters="paymentStatusFilters"
          v-model:payment-method-filters="paymentMethodFilters"
          v-model:category-ids="categoryIds"
          v-model:cost-filters="costFilters"
          v-model:cost-sources="costSources"
          :clients="filters.availableClients ?? []"
          :orders="filters.availableOrders ?? []"
          :responsibles="filters.availableResponsibles ?? []"
          :statuses="filters.availableStatuses ?? []"
          :categories="filters.availableCategories ?? []"
        />

        <ReportsSalesItemsSummary
          :summary="summary"
          :view-mode="viewMode"
        />

        <AppDataTableInfinite
          v-model:sorting="sorting"
          v-model:search-term="search"
          :columns="columns"
          :data="accumulatedItems as Record<string, unknown>[]"
          :loading="status === 'pending' && page === 1"
          :loading-more="loadingMore"
          :has-more="hasMore"
          :total="totalFromServer"
          show-search
          search-placeholder="Buscar item, OS, cliente, responsável ou categoria..."
          empty-icon="i-lucide-list-checks"
          :empty-title="viewMode === 'os' ? 'Nenhuma OS encontrada' : 'Nenhum item encontrado'"
          :empty-description="viewMode === 'os' ? 'Não há ordens de serviço para os filtros selecionados.' : 'Não há itens vendidos para os filtros selecionados.'"
          @load-more="loadMore"
        >
          <template #toolbar-right>
            <div class="flex items-center gap-2">
              <div class="inline-flex">
                <UTooltip :text="`Visualização por item (${summary.itemCount ?? 0})`">
                  <UButton
                    icon="i-lucide-package"
                    color="neutral"
                    class="rounded-r-none"
                    :variant="viewMode === 'item' ? 'solid' : 'outline'"
                    @click="viewMode = 'item'"
                  />
                </UTooltip>
                <UTooltip :text="`Visualização por OS (${summary.orderCount ?? 0})`">
                  <UButton
                    icon="i-lucide-file-text"
                    color="neutral"
                    class="-ml-px rounded-l-none"
                    :variant="viewMode === 'os' ? 'solid' : 'outline'"
                    @click="viewMode = 'os'"
                  />
                </UTooltip>
              </div>

              <UTooltip text="Exportar relatório">
                <UDropdownMenu
                  :items="exportItems"
                  :content="{ align: 'end' }"
                  :ui="{ content: 'min-w-44' }"
                >
                  <UButton
                    icon="i-lucide-download"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    square
                    :loading="exporting !== null"
                  />
                </UDropdownMenu>
              </UTooltip>
            </div>
          </template>

          <template #client-cell="{ row }">
            <div class="flex items-center gap-2">
              <div class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <span class="text-xs font-bold text-primary">
                  {{ getInitials(String(row.original.client ?? '')) }}
                </span>
              </div>
              <span class="truncate font-medium text-highlighted">
                {{ row.original.client }}
              </span>
            </div>
          </template>

          <template #orderNumber-cell="{ row }">
            <span class="font-mono text-sm text-highlighted">
              #{{ row.original.orderNumber }}
            </span>
          </template>

          <template #itemDescription-cell="{ row }">
            <div class="min-w-0">
              <p class="truncate font-medium text-highlighted">
                {{ row.original.itemDescription }}
              </p>
            </div>
          </template>

          <template #responsible-cell="{ row }">
            <div
              v-if="getResponsibleNames(String(row.original.responsible ?? '')).length"
              class="flex flex-wrap items-center gap-1"
            >
              <UTooltip
                v-for="name in getResponsibleNames(String(row.original.responsible ?? ''))"
                :key="name"
                :text="name"
              >
                <span class="flex size-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                  {{ getInitials(name) }}
                </span>
              </UTooltip>
            </div>
            <span v-else class="text-sm text-muted">
              —
            </span>
          </template>

          <template #totalValue-cell="{ row }">
            <span class="font-medium text-success">
              {{ formatCurrency(Number(row.original.totalValue ?? 0)) }}
            </span>
          </template>

          <template #totalCost-cell="{ row }">
            <span class="font-medium text-error">
              {{ formatCurrency(Number(row.original.totalCost ?? 0)) }}
            </span>
          </template>

          <template #commissionCost-cell="{ row }">
            {{ formatCurrency(Number(row.original.commissionCost ?? 0)) }}
          </template>

          <template #actions-cell="{ row }">
            <UButton
              icon="i-lucide-eye"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="openDetail(row.original as unknown as SalesItemRow | SalesOrderRow)"
            />
          </template>
        </AppDataTableInfinite>
      </div>

      <ReportsSalesItemsDetailSlideover
        :open="detailOpen"
        :loading="detailLoading"
        :data="detailData"
        @update:open="detailOpen = $event"
      />
    </template>
  </UDashboardPanel>
</template>
