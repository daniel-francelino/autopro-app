<script setup lang="ts">
import type { SortingState } from '@tanstack/vue-table'

interface PurchaseReportItem {
  purchase_date?: string | null
  total_amount?: number | string | null
  invoice_number?: string | null
  paymentStatus?: string | null
  payment_status?: string | null
  supplierName?: string | null
  supplier_name?: string | null
  suppliers?: { name?: string | null } | null
}

interface PurchaseSummary {
  totalPurchased?: number
  totalPaid?: number
  totalPending?: number
  count?: number
}

interface PurchasePagination {
  totalItems?: number
}

interface PurchaseSupplierOption {
  id: string
  name: string
}

interface PurchaseCharts {
  bySupplier: Array<{ name: string, total: number }>
  byDay: Array<{ name: string, total: number }>
}

type BadgeColor = 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'

interface PurchaseReportResponse {
  data?: {
    items?: PurchaseReportItem[]
    summary?: PurchaseSummary
    pagination?: PurchasePagination | null
    charts?: PurchaseCharts
    suppliers?: PurchaseSupplierOption[]
  }
}

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Relatório de Compras' })

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const toast = useToast()

const { dateFrom, dateTo } = useReportDateRange()

const search = useReportQueryParam('q', '')
const paymentStatus = useReportQueryParam('purchaseStatus', [] as string[])
const supplierIds = useReportQueryParam('suppliers', [] as string[])
const page = useReportQueryParam('page', 1)
const pageSize = 20
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

const sortByParam = useReportQueryParam<string>('sortBy', 'purchase_date')
const sortOrderParam = useReportQueryParam<string>('sortOrder', 'desc')
const sorting = computed<SortingState>({
  get: () => [{ id: sortByParam.value, desc: sortOrderParam.value !== 'asc' }],
  set: (val) => {
    sortByParam.value = val[0]?.id ?? 'purchase_date'
    sortOrderParam.value = val[0]?.desc === false ? 'asc' : 'desc'
    page.value = 1
  }
})

const sortByMap: Record<string, string> = {
  supplier: 'supplier',
  purchase_date: 'purchase_date',
  invoice_number: 'invoice_number',
  total_amount: 'total_amount',
  pay_status: 'status'
}

const sortBy = computed(() => sortByMap[sortByParam.value] ?? 'purchase_date')
const sortOrder = computed(() => sortOrderParam.value)

watch([dateFrom, dateTo, search, paymentStatus, supplierIds, sortBy, sortOrder], () => {
  page.value = 1
})

const queryKey = computed(() =>
  `report-purchases-${dateFrom.value}-${dateTo.value}-${page.value}-${search.value}-${paymentStatus.value.join(',')}-${supplierIds.value.join(',')}-${sortBy.value}-${sortOrder.value}`
)

const { data, status } = await useAsyncData(
  () => queryKey.value,
  () => requestFetch<PurchaseReportResponse>('/api/reports/purchases', {
    headers: requestHeaders,
    query: {
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      page: page.value,
      pageSize,
      searchTerm: search.value || undefined,
      supplierIds: supplierIds.value.length ? supplierIds.value : undefined,
      status: paymentStatus.value.length ? paymentStatus.value : undefined,
      sortBy: sortBy.value,
      sortOrder: sortOrder.value
    }
  }),
  { watch: [queryKey] }
)

const items = computed<PurchaseReportItem[]>(() => data.value?.data?.items ?? [])
const summary = computed<PurchaseSummary>(() => data.value?.data?.summary ?? {})
const pagination = computed<PurchasePagination | null>(() => data.value?.data?.pagination ?? null)
const charts = computed<PurchaseCharts>(() => data.value?.data?.charts ?? { bySupplier: [], byDay: [] })
const suppliers = computed<PurchaseSupplierOption[]>(() => data.value?.data?.suppliers ?? [])

const payStatusColor: Record<string, BadgeColor> = {
  pending: 'warning',
  paid: 'success',
  overdue: 'error'
}

const payStatusLabel: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  overdue: 'Vencido'
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0]?.charAt(0) ?? '?').toUpperCase()
  return ((parts[0]?.charAt(0) ?? '') + (parts[parts.length - 1]?.charAt(0) ?? '')).toUpperCase()
}

const columns = [
  { id: 'supplier', header: 'Fornecedor', enableSorting: true },
  { accessorKey: 'purchase_date', header: 'Data' },
  { accessorKey: 'invoice_number', header: 'Nota fiscal' },
  { accessorKey: 'total_amount', header: 'Total' },
  { id: 'pay_status', header: 'Status', enableSorting: true }
]

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(v: string) {
  if (!v) return '—'
  const [y, m, d] = v.split('-')
  return `${d}/${m}/${y}`
}

async function exportReport(format: 'csv' | 'pdf') {
  exporting.value = format
  try {
    const res = await $fetch<{ success: boolean, data: { fileName: string, contentType: string, base64: string } }>(
      '/api/reports/export-purchases',
      {
        method: 'POST',
        body: {
          format,
          dateFrom: dateFrom.value,
          dateTo: dateTo.value,
          supplierIds: supplierIds.value.length ? supplierIds.value : undefined,
          status: paymentStatus.value.length ? paymentStatus.value : undefined,
          searchTerm: search.value || undefined,
          sortBy: sortBy.value,
          sortOrder: sortOrder.value
        }
      }
    )

    if (res.data?.base64) {
      const binary = atob(res.data.base64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
      const blob = new Blob([bytes], { type: res.data.contentType })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = res.data.fileName
      link.click()
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
      <AppPageHeader title="Relatório de Compras" />
    </template>

    <template #body>
      <div class="space-y-4 p-4">
        <ReportsPurchasesFilters
          v-model:date-from="dateFrom"
          v-model:date-to="dateTo"
          v-model:payment-status="paymentStatus"
          v-model:supplier-ids="supplierIds"
          :suppliers="suppliers"
        />

        <ReportsPurchasesSummary :summary="summary" />

        <ReportsPurchasesCharts
          :by-supplier="charts.bySupplier"
          :by-day="charts.byDay"
        />

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
          search-placeholder="Buscar fornecedor ou nota fiscal..."
          empty-icon="i-lucide-shopping-cart"
          empty-title="Nenhuma compra encontrada"
          empty-description="Não há compras registradas para o período e filtros selecionados."
          @search-change="page = 1"
        >
          <template #toolbar-right>
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
          </template>

          <template #supplier-cell="{ row }">
            <div
              v-if="row.original.suppliers?.name ?? row.original.supplierName ?? row.original.supplier_name"
              class="flex items-center gap-2"
            >
              <div class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <span class="text-xs font-bold text-primary">
                  {{ getInitials(String(row.original.suppliers?.name ?? row.original.supplierName ?? row.original.supplier_name ?? '')) }}
                </span>
              </div>
              <span class="truncate font-medium text-highlighted">
                {{ row.original.suppliers?.name ?? row.original.supplierName ?? row.original.supplier_name ?? '—' }}
              </span>
            </div>
            <span v-else class="text-sm text-muted">—</span>
          </template>

          <template #purchase_date-cell="{ row }">
            {{ formatDate(row.original.purchase_date as string) }}
          </template>

          <template #invoice_number-cell="{ row }">
            <span class="font-mono text-sm text-muted">
              {{ row.original.invoice_number || '—' }}
            </span>
          </template>

          <template #total_amount-cell="{ row }">
            <span class="font-medium">{{ formatCurrency(row.original.total_amount as number) }}</span>
          </template>

          <template #pay_status-cell="{ row }">
            <UBadge
              :color="payStatusColor[String(row.original.paymentStatus ?? row.original.payment_status)] ?? 'neutral'"
              variant="subtle"
              :label="payStatusLabel[String(row.original.paymentStatus ?? row.original.payment_status)] ?? String(row.original.paymentStatus ?? row.original.payment_status ?? '—')"
              size="sm"
            />
          </template>
        </AppDataTable>
      </div>
    </template>
  </UDashboardPanel>
</template>
