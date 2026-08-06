<script setup lang="ts">
import type { RowSelectionState, SortingState } from '@tanstack/vue-table'
import type { DebtorDetailData, DebtorPendingItem } from '~/components/reports/debtors/DebtorsDetailSlideover.vue'
import {
  debtorStatusColor,
  formatDebtorStatusLabel
} from '~/utils/report-debtors'

interface DebtorClient {
  id?: string
  name?: string | null
  phone?: string | null
  email?: string | null
}

interface DebtorReportItem {
  clientId: string
  clientName: string
  phone: string | null
  email: string | null
  totalOwed: number
  pendingItems: DebtorPendingItem[]
  daysOverdue: number
  earliestDue: string | null
  status: string
  client?: DebtorClient | null
}

interface DebtorOrderRow {
  rowId: string
  orderId: string | null
  orderNumber: string | null
  clientId: string
  clientName: string
  phone: string | null
  email: string | null
  totalOwed: number
  pendingItems: DebtorPendingItem[]
  daysOverdue: number
  earliestDue: string | null
  status: string
}

interface DebtorsTotals {
  total?: number
  overdue?: number
  current?: number
}

interface DebtorsPagination {
  totalItems?: number
}

interface DebtorsFilters {
  availableClients?: Array<{ value: string, label: string }>
}

interface DebtorsReportResponse {
  data?: {
    debtorsReport?: {
      filters?: DebtorsFilters
      items?: DebtorReportItem[]
      orderItems?: DebtorOrderRow[]
      totals?: DebtorsTotals
      counts?: { clients?: number, orders?: number }
      pagination?: DebtorsPagination | null
      sort?: { sortBy?: string, sortOrder?: string }
    }
  }
}

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Relatório de Devedores' })

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { dateFrom, dateTo, orderStatusFilters, paymentMethodFilters, clientIds } = useReportDateRange()
const search = useReportQueryParam('q', '')
const pageSize = 20
const viewMode = useReportQueryParam('debtorsView', 'clients' as 'clients' | 'orders')

const page = ref(1)
const accumulatedItems = ref<Array<DebtorReportItem | DebtorOrderRow>>([])
const totalFromServer = ref(0)
const statusFilters = useReportQueryParam('debtorStatus', [] as string[])
const detailOpen = ref(false)
const detailData = ref<DebtorDetailData | null>(null)

const rowSelection = ref<RowSelectionState>({})
function getRowId(row: Record<string, unknown>) {
  return String(viewMode.value === 'clients' ? row.clientId : row.rowId)
}
const selectedIds = computed(() =>
  Object.entries(rowSelection.value).filter(([, v]) => v).map(([id]) => id)
)
const selectedCount = computed(() => selectedIds.value.length)
const selectedEntries = computed(() =>
  accumulatedItems.value.filter(item => selectedIds.value.includes(getRowId(item as Record<string, unknown>)))
)
const selectionSummary = computed(() => {
  let total = 0
  let overdue = 0
  let current = 0
  for (const item of selectedEntries.value) {
    const owed = Number(item.totalOwed || 0)
    total += owed
    if (item.status === 'overdue') overdue += owed
    else current += owed
  }
  return { total, overdue, current }
})

const sortByParam = useReportQueryParam('sortBy', 'earliestDue')
const sortOrderParam = useReportQueryParam('sortOrder', 'asc')
const sorting = computed<SortingState>({
  get: () => [{ id: sortByParam.value, desc: sortOrderParam.value !== 'asc' }],
  set: (val) => {
    sortByParam.value = val[0]?.id ?? 'earliestDue'
    sortOrderParam.value = val[0]?.desc === false ? 'asc' : 'desc'
    accumulatedItems.value = []
    page.value = 1
  }
})

const sortByMap: Record<string, string> = {
  clientName: 'client_name',
  totalOwed: 'total_owed',
  daysOverdue: 'days_overdue',
  earliestDue: 'earliest_due',
  status_col: 'status',
  orderNumber: 'order_number'
}

const sortBy = computed(() => sortByMap[sortByParam.value] ?? 'earliest_due')
const sortOrder = computed(() => sortOrderParam.value)

watch([dateFrom, dateTo, search, clientIds, statusFilters, paymentMethodFilters, orderStatusFilters, viewMode, sortBy, sortOrder], () => {
  accumulatedItems.value = []
  page.value = 1
  rowSelection.value = {}
})

const queryKey = computed(() =>
  `report-debtors-${viewMode.value}-${page.value}-${search.value}-${dateFrom.value}-${dateTo.value}-${clientIds.value.join(',')}-${statusFilters.value.join(',')}-${paymentMethodFilters.value.join(',')}-${orderStatusFilters.value.join(',')}-${sortBy.value}-${sortOrder.value}`
)

const { data, status } = await useAsyncData(
  () => queryKey.value,
  () => requestFetch<DebtorsReportResponse>('/api/reports/debtors', {
    headers: requestHeaders,
    query: {
      viewMode: viewMode.value,
      page: page.value,
      pageSize,
      searchTerm: search.value || undefined,
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      clientIds: clientIds.value.length ? clientIds.value : undefined,
      statusFilters: statusFilters.value.length ? statusFilters.value : undefined,
      paymentMethodFilters: paymentMethodFilters.value.length ? paymentMethodFilters.value : undefined,
      orderStatusFilters: orderStatusFilters.value.length ? orderStatusFilters.value : undefined,
      sortBy: sortBy.value,
      sortOrder: sortOrder.value
    }
  }),
  { watch: [queryKey] }
)

const report = computed(() => data.value?.data?.debtorsReport)
const totals = computed<DebtorsTotals>(() => report.value?.totals ?? {})
const counts = computed(() => report.value?.counts ?? { clients: 0, orders: 0 })
const availableClients = computed(() => report.value?.filters?.availableClients ?? [])

watch(data, (newData) => {
  const r = newData?.data?.debtorsReport
  const newItems = (viewMode.value === 'clients'
    ? (r?.items ?? [])
    : (r?.orderItems ?? [])) as Array<DebtorReportItem | DebtorOrderRow>
  totalFromServer.value = r?.pagination?.totalItems ?? 0
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

const clientColumns = [
  { accessorKey: 'clientName', header: 'Cliente' },
  { id: 'pending_items', header: 'Itens', enableSorting: false },
  { accessorKey: 'earliestDue', header: 'Vencimento' },
  { accessorKey: 'totalOwed', header: 'Total devido' },
  { id: 'status_col', header: 'Status' },
  { id: 'actions', header: '', enableSorting: false }
]

const orderColumns = [
  { accessorKey: 'orderNumber', header: 'OS' },
  { accessorKey: 'clientName', header: 'Cliente' },
  { id: 'pending_items', header: 'Itens', enableSorting: false },
  { accessorKey: 'earliestDue', header: 'Vencimento' },
  { accessorKey: 'totalOwed', header: 'Total devido' },
  { id: 'status_col', header: 'Status' },
  { id: 'actions', header: '', enableSorting: false }
]

const columns = computed(() => (viewMode.value === 'clients' ? clientColumns : orderColumns))

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(v: string | null | undefined) {
  if (!v) return '—'
  const [year, month, day] = v.split('-')
  if (!year || !month || !day) return '—'
  return `${day}/${month}/${year}`
}

function formatPhone(phone: string | null | undefined) {
  if (!phone) return 'â€”'
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  if (digits.length === 11) return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  return phone
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0]?.charAt(0) ?? '?').toUpperCase()
  return ((parts[0]?.charAt(0) ?? '') + (parts[parts.length - 1]?.charAt(0) ?? '')).toUpperCase()
}

function openClientDetails(row: DebtorReportItem) {
  detailData.value = {
    mode: 'clients',
    clientId: row.clientId,
    clientName: row.clientName,
    phone: row.phone,
    email: row.email,
    status: row.status,
    daysOverdue: row.daysOverdue,
    totalOwed: row.totalOwed,
    earliestDue: row.earliestDue,
    pendingItems: row.pendingItems
  }
  detailOpen.value = true
}

function openOrderDetails(row: DebtorOrderRow) {
  detailData.value = {
    mode: 'orders',
    clientId: row.clientId,
    clientName: row.clientName,
    phone: row.phone,
    email: row.email,
    status: row.status,
    daysOverdue: row.daysOverdue,
    totalOwed: row.totalOwed,
    earliestDue: row.earliestDue,
    pendingItems: row.pendingItems,
    orderNumber: row.orderNumber,
    orderId: row.orderId
  }
  detailOpen.value = true
}

function handleOpenDetails(row: DebtorReportItem | DebtorOrderRow) {
  if (viewMode.value === 'clients') {
    openClientDetails(row as DebtorReportItem)
  } else {
    openOrderDetails(row as DebtorOrderRow)
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Relatório de Devedores" />
    </template>

    <template #body>
      <div class="space-y-4 p-4">
        <ReportsDebtorsFilters
          v-model:date-from="dateFrom"
          v-model:date-to="dateTo"
          v-model:client-ids="clientIds"
          v-model:status-filters="statusFilters"
          v-model:payment-method-filters="paymentMethodFilters"
          v-model:order-status-filters="orderStatusFilters"
          :clients="availableClients"
        />

        <ReportsDebtorsSummary
          :totals="totals"
          :counts="counts"
        />

        <AppDataTableInfinite
          v-model:sorting="sorting"
          v-model:search-term="search"
          v-model:row-selection="rowSelection"
          :columns="columns"
          :data="accumulatedItems as Record<string, unknown>[]"
          :loading="status === 'pending' && page === 1"
          :loading-more="loadingMore"
          :has-more="hasMore"
          :total="totalFromServer"
          :selectable="true"
          :get-row-id="getRowId"
          show-search
          search-placeholder="Buscar por nome, telefone ou e-mail..."
          empty-icon="i-lucide-badge-alert"
          empty-title="Nenhum devedor encontrado"
          empty-description="Ótimo! Não há pendências para os filtros selecionados."
          @load-more="loadMore"
        >
          <template #toolbar-right>
            <div class="flex items-center gap-2">
              <ReportsDebtorsSelectionSummaryPopover
                v-if="selectedCount > 0"
                :count="selectedCount"
                :total="selectionSummary.total"
                :overdue="selectionSummary.overdue"
                :current="selectionSummary.current"
              />

              <div class="inline-flex">
                <UTooltip :text="`Visualização por cliente (${counts.clients ?? 0})`">
                  <UButton
                    icon="i-lucide-user-round"
                    color="neutral"
                    class="rounded-r-none"
                    :variant="viewMode === 'clients' ? 'solid' : 'outline'"
                    @click="viewMode = 'clients'"
                  />
                </UTooltip>
                <UTooltip :text="`Visualização por OS (${counts.orders ?? 0})`">
                  <UButton
                    icon="i-lucide-file-text"
                    color="neutral"
                    class="-ml-px rounded-l-none"
                    :variant="viewMode === 'orders' ? 'solid' : 'outline'"
                    @click="viewMode = 'orders'"
                  />
                </UTooltip>
              </div>
            </div>
          </template>

          <template #clientName-cell="{ row }">
            <div class="flex items-center gap-2">
              <div class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <span class="text-xs font-bold text-primary">
                  {{ getInitials(String(row.original.clientName ?? '')) }}
                </span>
              </div>
              <div class="min-w-0">
                <p class="truncate font-medium text-highlighted">
                  {{ row.original.clientName }}
                </p>
                <p v-if="row.original.phone || row.original.email" class="truncate text-xs text-muted">
                  {{ row.original.phone ? formatPhone(String(row.original.phone)) : row.original.email }}
                </p>
              </div>
            </div>
          </template>

          <template #orderNumber-cell="{ row }">
            <span class="font-mono text-sm text-highlighted">
              #{{ row.original.orderNumber || '—' }}
            </span>
          </template>

          <template #pending_items-cell="{ row }">
            <UBadge
              color="info"
              variant="soft"
              size="xs"
              :label="String((row.original.pendingItems as unknown[] | undefined)?.length ?? 0)"
            />
          </template>

          <template #earliestDue-cell="{ row }">
            {{ formatDate(String(row.original.earliestDue ?? '')) }}
          </template>

          <template #totalOwed-cell="{ row }">
            <span class="font-medium">{{ formatCurrency(Number(row.original.totalOwed ?? 0)) }}</span>
          </template>

          <template #status_col-cell="{ row }">
            <div class="flex items-center justify-start gap-2">
              <UBadge
                :color="debtorStatusColor(String(row.original.status ?? ''))"
                variant="subtle"
                :label="formatDebtorStatusLabel(String(row.original.status ?? ''))"
                size="xs"
              />
              <span v-if="Number(row.original.daysOverdue ?? 0) > 0" class="text-xs text-muted">
                {{ row.original.daysOverdue }} dia(s)
              </span>
            </div>
          </template>

          <template #actions-cell="{ row }">
            <UButton
              icon="i-lucide-eye"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="handleOpenDetails(row.original as DebtorReportItem | DebtorOrderRow)"
            />
          </template>
        </AppDataTableInfinite>
      </div>

      <ReportsDebtorsDetailSlideover
        :open="detailOpen"
        :loading="false"
        :data="detailData"
        @update:open="detailOpen = $event"
      />
    </template>
  </UDashboardPanel>
</template>
