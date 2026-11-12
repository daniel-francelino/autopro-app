<script setup lang="ts">
import type { SortingState } from '@tanstack/vue-table'
import type { CustomerDetailData } from '~/components/reports/customers/CustomersDetailSlideover.vue'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Relatório de Clientes' })

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server
  ? useRequestHeaders(['cookie'])
  : undefined

const { dateFrom, dateTo, orderStatusFilters, paymentStatusFilters } = useReportDateRange()
const search = useReportQueryParam('q', '')
const page = useReportQueryParam('page', 1)
const pageSize = 20

// Sorting
const sortByParam = useReportQueryParam<string>('sortBy', 'totalSpent')
const sortOrderParam = useReportQueryParam<string>('sortOrder', 'desc')
const sorting = computed<SortingState>({
  get: () => [{ id: sortByParam.value, desc: sortOrderParam.value !== 'asc' }],
  set: (val) => {
    sortByParam.value = val[0]?.id ?? 'totalSpent'
    sortOrderParam.value = val[0]?.desc === false ? 'asc' : 'desc'
    page.value = 1
  }
})
const sortBy = computed(() => sortByParam.value)
const sortOrder = computed(() => sortOrderParam.value)

const isDetailOpen = ref(false)
const detailLoading = ref(false)
const detailData = ref<CustomerDetailData | null>(null)
const toast = useToast()

const { data, status } = await useAsyncData(
  () => `report-customers-${dateFrom.value}-${dateTo.value}-${page.value}-${search.value}-${orderStatusFilters.value.join(',')}-${paymentStatusFilters.value.join(',')}-${sortBy.value}-${sortOrder.value}`,
  () =>
    requestFetch<{ data: unknown }>('/api/reports/customers', {
      headers: requestHeaders,
      query: {
        dateFrom: dateFrom.value,
        dateTo: dateTo.value,
        page: page.value,
        pageSize,
        searchTerm: search.value || undefined,
        orderStatusFilters: orderStatusFilters.value.length ? orderStatusFilters.value : undefined,
        paymentStatusFilters: paymentStatusFilters.value.length ? paymentStatusFilters.value : undefined,
        sortBy: sortBy.value,
        sortOrder: sortOrder.value
      }
    }),
  {
    watch: [dateFrom, dateTo, page, search, orderStatusFilters, paymentStatusFilters, sortBy, sortOrder]
  }
)

const items = computed(
  () => (data.value as { data?: { items?: unknown[] } })?.data?.items ?? []
)
const summary = computed(
  () => (data.value as { data?: { summary?: Record<string, number> } })?.data?.summary ?? {}
)
const pagination = computed(
  () => (data.value as { data?: { pagination?: { totalItems: number } } })?.data?.pagination ?? null
)

async function openDetail(clientId: string) {
  isDetailOpen.value = true
  detailLoading.value = true
  detailData.value = null
  try {
    const res = await $fetch<{ data: { selectedCustomerDetail: CustomerDetailData } }>(
      '/api/reports/customers',
      {
        query: {
          selectedClientId: clientId,
          skipList: 'true',
          dateFrom: dateFrom.value,
          dateTo: dateTo.value
        }
      }
    )
    detailData.value = res.data?.selectedCustomerDetail ?? null
  } catch {
    toast.add({ title: 'Erro ao carregar detalhes do cliente', color: 'error' })
    isDetailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

function formatDate(v: string) {
  if (!v) return '—'
  const [y, m, d] = v.split('-')
  return `${d}/${m}/${y}`
}

const columns = [
  { accessorKey: 'name', header: 'Cliente' },
  { accessorKey: 'totalSpent', header: 'Total gasto' },
  { accessorKey: 'totalPaid', header: 'Total pago' },
  { accessorKey: 'totalOrders', header: 'OS', enableSorting: false },
  { accessorKey: 'averageTicket', header: 'Ticket médio' },
  { accessorKey: 'lastVisit', header: 'Última visita' },
  { id: 'actions', header: '' }
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Relatório de Clientes" />
    </template>

    <template #body>
      <div class="space-y-4 p-4">
        <ReportsCustomersFilters
          v-model:date-from="dateFrom"
          v-model:date-to="dateTo"
          v-model:order-status-filters="orderStatusFilters"
          v-model:payment-status-filters="paymentStatusFilters"
        />

        <ReportsCustomersSummary :summary="summary" />

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
          search-placeholder="Buscar cliente..."
          empty-icon="i-lucide-users"
          empty-title="Nenhum cliente encontrado"
          empty-description="Não há clientes com movimentação no período selecionado."
          @search-change="page = 1"
        >
          <template #totalSpent-cell="{ row }">
            <span class="font-medium">{{ formatCurrency(row.original.totalSpent as number) }}</span>
          </template>
          <template #totalPaid-cell="{ row }">
            {{ formatCurrency(row.original.totalPaid as number) }}
          </template>
          <template #averageTicket-cell="{ row }">
            {{ formatCurrency((row.original.averageTicket as number) ?? 0) }}
          </template>
          <template #lastVisit-cell="{ row }">
            {{ formatDate(row.original.lastVisit as string) }}
          </template>
          <template #actions-cell="{ row }">
            <UButton
              icon="i-lucide-eye"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="openDetail(row.original.id as string)"
            />
          </template>
        </AppDataTable>
      </div>

      <ReportsCustomersDetailSlideover
        :open="isDetailOpen"
        :loading="detailLoading"
        :data="detailData"
        @update:open="isDetailOpen = $event"
      />
    </template>
  </UDashboardPanel>
</template>
