<script setup lang="ts">
/**
 * Report content for a single employee inside one accordion item on the
 * Employees report page. Mounted lazily by ReportsEmployeesAccordion (only
 * once its item is expanded for the first time), so the fetch below only
 * ever runs for employees the user actually opened — not for every employee
 * selected in the filter.
 */

type BadgeColor = 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'
type ViewMode = 'orders' | 'commissions' | 'items'

interface EmployeeOrderRow {
  id: string
  number: string
  entryDate: string | null
  clientName: string
  status: string | null
  paymentStatus: 'paid' | 'pending' | 'cancelled' | null
  totalAmount: number
  totalCostAmount: number
  employeeCommission: number
  otherEmployeesCommission: number
  netAmount: number
}

interface EmployeeCommissionRow {
  id: string
  referenceDate: string | null
  description: string | null
  orderId: string | null
  orderNumber: string | null
  orderStatus: string | null
  orderPaymentStatus: 'paid' | 'pending' | 'cancelled' | null
  amount: number
  status: 'paid' | 'pending' | 'cancelled'
  recordType: string | null
}

interface EmployeeItemRow {
  id: string
  orderId: string
  orderNumber: string
  date: string | null
  itemDescription: string
  categoryName: string
  quantity: number
  totalValue: number
  totalCost: number
  commissionCost: number
  otherEmployeesCommissionCost: number
  profit: number
}

interface EmployeeReportSummary {
  grossSales: number
  osExpenses: number
  totalCommissions: number
  otherEmployeesCommissions: number
  netSales: number
  orderCount: number
}

interface EmployeeReportResponse {
  data?: {
    summary?: EmployeeReportSummary | null
    ordersView?: EmployeeOrderRow[]
    commissionsView?: EmployeeCommissionRow[]
    itemsView?: EmployeeItemRow[]
  }
}

const props = defineProps<{
  employeeId: string
  employeeName: string
  dateFrom?: string
  dateTo?: string
  orderStatusFilters: string[]
  paymentStatusFilters: string[]
  paymentMethods: string[]
  commissionStatus: string[]
  recordType: string[]
}>()

const toast = useToast()

const summary = ref<EmployeeReportSummary | null>(null)
const ordersView = ref<EmployeeOrderRow[]>([])
const commissionsView = ref<EmployeeCommissionRow[]>([])
const itemsView = ref<EmployeeItemRow[]>([])
const isLoading = ref(false)

async function loadReport() {
  isLoading.value = true
  try {
    const res = await $fetch<EmployeeReportResponse>('/api/reports/employees', {
      query: {
        dateFrom: props.dateFrom,
        dateTo: props.dateTo,
        employeeId: props.employeeId,
        orderStatusFilters: props.orderStatusFilters.length ? props.orderStatusFilters : undefined,
        paymentStatusFilters: props.paymentStatusFilters.length ? props.paymentStatusFilters : undefined,
        paymentMethods: props.paymentMethods.length ? props.paymentMethods : undefined,
        commissionStatus: props.commissionStatus.length ? props.commissionStatus : undefined,
        recordType: props.recordType.length ? props.recordType : undefined
      }
    })
    summary.value = res.data?.summary ?? null
    ordersView.value = res.data?.ordersView ?? []
    commissionsView.value = res.data?.commissionsView ?? []
    itemsView.value = res.data?.itemsView ?? []
  } catch {
    toast.add({ title: 'Erro ao carregar relatório do funcionário', color: 'error' })
  } finally {
    isLoading.value = false
  }
}

onMounted(loadReport)

// Refetch only for panels that are already mounted (i.e. the accordion item
// has been opened before) — collapsed-and-never-opened items skip filter
// changes entirely since they haven't mounted yet.
watch(
  [
    () => props.dateFrom, () => props.dateTo, () => props.orderStatusFilters,
    () => props.paymentStatusFilters, () => props.paymentMethods,
    () => props.commissionStatus, () => props.recordType
  ],
  loadReport,
  { deep: true }
)

const view = ref<ViewMode>('orders')

const activeData = computed<Record<string, unknown>[]>(() => {
  if (view.value === 'commissions') return commissionsView.value as unknown as Record<string, unknown>[]
  if (view.value === 'items') return itemsView.value as unknown as Record<string, unknown>[]
  return ordersView.value as unknown as Record<string, unknown>[]
})

const viewItems = [
  { label: 'OS trabalhadas', value: 'orders' as const, icon: 'i-lucide-clipboard-list' },
  { label: 'Comissões', value: 'commissions' as const, icon: 'i-lucide-hand-coins' },
  { label: 'Itens vendidos', value: 'items' as const, icon: 'i-lucide-package-search' }
]

// Every column gets a view-prefixed `id` (Vue disallows two <template #slot>
// blocks with the same slot name in one element, even guarded by different
// v-if branches, so the 3 views can't share slot names like "orderNumber").
const columnsByView: Record<ViewMode, { accessorKey?: string, id: string, header: string }[]> = {
  orders: [
    { id: 'o_number', accessorKey: 'number', header: 'OS' },
    { id: 'o_entryDate', accessorKey: 'entryDate', header: 'Entrada' },
    { id: 'o_clientName', accessorKey: 'clientName', header: 'Cliente' },
    { id: 'o_status', header: 'Status' },
    { id: 'o_payment', header: 'Pagamento' },
    { id: 'o_totalAmount', accessorKey: 'totalAmount', header: 'Venda bruta' },
    { id: 'o_totalCostAmount', accessorKey: 'totalCostAmount', header: 'Despesas' },
    { id: 'o_employeeCommission', accessorKey: 'employeeCommission', header: 'Comissão' },
    { id: 'o_netAmount', accessorKey: 'netAmount', header: 'Líquido' }
  ],
  commissions: [
    { id: 'c_referenceDate', accessorKey: 'referenceDate', header: 'Referência' },
    { id: 'c_orderNumber', accessorKey: 'orderNumber', header: 'OS' },
    { id: 'c_description', accessorKey: 'description', header: 'Descrição' },
    { id: 'c_orderStatus', header: 'Status OS' },
    { id: 'c_orderPayment', header: 'Pagamento OS' },
    { id: 'c_amount', accessorKey: 'amount', header: 'Valor' },
    { id: 'c_status', header: 'Status comissão' }
  ],
  items: [
    { id: 'i_orderNumber', accessorKey: 'orderNumber', header: 'OS' },
    { id: 'i_date', accessorKey: 'date', header: 'Data' },
    { id: 'i_itemDescription', accessorKey: 'itemDescription', header: 'Item' },
    { id: 'i_categoryName', accessorKey: 'categoryName', header: 'Categoria' },
    { id: 'i_quantity', accessorKey: 'quantity', header: 'Qtd' },
    { id: 'i_totalValue', accessorKey: 'totalValue', header: 'Valor' },
    { id: 'i_totalCost', accessorKey: 'totalCost', header: 'Custo' },
    { id: 'i_commissionCost', accessorKey: 'commissionCost', header: 'Comissão' },
    { id: 'i_profit', accessorKey: 'profit', header: 'Líquido' }
  ]
}

const columns = computed(() => columnsByView[view.value])

const emptyStateByView: Record<ViewMode, { icon: string, title: string, description: string }> = {
  orders: { icon: 'i-lucide-clipboard-list', title: 'Nenhuma OS encontrada', description: 'Não há ordens de serviço para esse funcionário no período selecionado.' },
  commissions: { icon: 'i-lucide-hand-coins', title: 'Nenhuma comissão encontrada', description: 'Não há comissões registradas para esse funcionário no período selecionado.' },
  items: { icon: 'i-lucide-package-search', title: 'Nenhum item encontrado', description: 'Não há itens vendidos por esse funcionário no período selecionado.' }
}
const emptyState = computed(() => emptyStateByView[view.value])

// Status maps
const orderStatusColorMap: Record<string, BadgeColor> = {
  open: 'info', in_progress: 'warning', waiting_for_part: 'warning',
  completed: 'success', invoiced: 'primary', delivered: 'success', estimate: 'neutral'
}
const orderStatusLabelMap: Record<string, string> = {
  open: 'Aberta', in_progress: 'Em andamento', waiting_for_part: 'Aguard. peça',
  completed: 'Concluída', invoiced: 'Faturada', delivered: 'Entregue', estimate: 'Orçamento'
}
const paymentStatusColorMap: Record<string, BadgeColor> = { pending: 'warning', paid: 'success', partial: 'info' }
const paymentStatusLabelMap: Record<string, string> = { pending: 'Pendente', paid: 'Pago', partial: 'Parcial' }
const commissionStatusColorMap: Record<string, BadgeColor> = { pending: 'warning', paid: 'success', cancelled: 'error' }
const commissionStatusLabelMap: Record<string, string> = { pending: 'Pendente', paid: 'Pago', cancelled: 'Cancelado' }

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(v: string | null) {
  if (!v) return '—'
  const [y, m, d] = v.split('-')
  return `${d}/${m}/${y}`
}

function orderRow(row: { original: unknown }): EmployeeOrderRow {
  return row.original as EmployeeOrderRow
}
function commissionRow(row: { original: unknown }): EmployeeCommissionRow {
  return row.original as EmployeeCommissionRow
}
function itemRow(row: { original: unknown }): EmployeeItemRow {
  return row.original as EmployeeItemRow
}

// Export
const exporting = ref<'csv' | 'pdf' | null>(null)

const exportItems = computed(() => [[
  {
    label: 'Exportar CSV',
    icon: 'i-lucide-file-spreadsheet',
    disabled: exporting.value !== null || activeData.value.length === 0,
    onSelect: () => exportReport('csv')
  },
  {
    label: 'Exportar PDF',
    icon: 'i-lucide-file-text',
    disabled: exporting.value !== null || activeData.value.length === 0,
    onSelect: () => exportReport('pdf')
  }
]])

async function exportReport(format: 'csv' | 'pdf') {
  exporting.value = format
  try {
    const res = await $fetch<{ success: boolean, data: { fileName: string, contentType: string, base64: string } }>(
      '/api/reports/export-employees',
      {
        method: 'POST',
        body: {
          format,
          view: view.value,
          dateFrom: props.dateFrom,
          dateTo: props.dateTo,
          employeeId: props.employeeId,
          orderStatusFilters: props.orderStatusFilters.length ? props.orderStatusFilters : undefined,
          paymentStatusFilters: props.paymentStatusFilters.length ? props.paymentStatusFilters : undefined,
          paymentMethods: props.paymentMethods.length ? props.paymentMethods : undefined,
          commissionStatus: props.commissionStatus.length ? props.commissionStatus : undefined,
          recordType: props.recordType.length ? props.recordType : undefined
        }
      }
    )
    if (res.data?.base64) {
      const bstr = atob(res.data.base64)
      const bytes = new Uint8Array(bstr.length)
      for (let i = 0; i < bstr.length; i++) bytes[i] = bstr.charCodeAt(i)!
      const blob = new Blob([bytes], { type: res.data.contentType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.data.fileName
      a.click()
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
  <div class="space-y-4">
    <ReportsEmployeesStats :summary="summary" />

    <UTabs
      v-model="view"
      :items="viewItems"
      variant="link"
      class="w-full"
    />

    <AppDataTableInfinite
      :key="view"
      class="rounded-lg! border-0! shadow-none!"
      :columns="columns"
      :data="activeData"
      :loading="isLoading"
      :has-more="false"
      :total="activeData.length"
      :empty-icon="emptyState.icon"
      :empty-title="emptyState.title"
      :empty-description="emptyState.description"
    >
      <template #toolbar-right>
        <UTooltip :text="`Exportar relatório de ${employeeName}`">
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

      <!-- OS trabalhadas -->
      <template #o_number-cell="{ row }">
        <span class="font-mono text-sm text-muted">#{{ orderRow(row).number }}</span>
      </template>
      <template #o_entryDate-cell="{ row }">
        {{ formatDate(orderRow(row).entryDate) }}
      </template>
      <template #o_status-cell="{ row }">
        <UBadge
          v-if="orderRow(row).status"
          :color="orderStatusColorMap[orderRow(row).status || ''] ?? 'neutral'"
          variant="subtle"
          :label="orderStatusLabelMap[orderRow(row).status || ''] ?? String(orderRow(row).status)"
          size="sm"
        />
        <span v-else class="text-sm text-muted">—</span>
      </template>
      <template #o_payment-cell="{ row }">
        <UBadge
          v-if="orderRow(row).paymentStatus"
          :color="paymentStatusColorMap[orderRow(row).paymentStatus || ''] ?? 'neutral'"
          variant="subtle"
          :label="paymentStatusLabelMap[orderRow(row).paymentStatus || ''] ?? String(orderRow(row).paymentStatus)"
          size="sm"
        />
        <span v-else class="text-sm text-muted">—</span>
      </template>
      <template #o_totalAmount-cell="{ row }">
        {{ formatCurrency(orderRow(row).totalAmount) }}
      </template>
      <template #o_totalCostAmount-cell="{ row }">
        <span class="text-error">{{ formatCurrency(orderRow(row).totalCostAmount) }}</span>
      </template>
      <template #o_employeeCommission-cell="{ row }">
        <span class="text-warning">{{ formatCurrency(orderRow(row).employeeCommission) }}</span>
      </template>
      <template #o_netAmount-cell="{ row }">
        <span class="font-bold" :class="orderRow(row).netAmount >= 0 ? 'text-success' : 'text-error'">
          {{ formatCurrency(orderRow(row).netAmount) }}
        </span>
      </template>

      <!-- Comissões -->
      <template #c_referenceDate-cell="{ row }">
        {{ formatDate(commissionRow(row).referenceDate) }}
      </template>
      <template #c_orderNumber-cell="{ row }">
        <span v-if="commissionRow(row).orderNumber" class="font-mono text-sm text-muted">
          #{{ commissionRow(row).orderNumber }}
        </span>
        <span v-else class="text-muted">—</span>
      </template>
      <template #c_orderStatus-cell="{ row }">
        <UBadge
          v-if="commissionRow(row).orderStatus"
          :color="orderStatusColorMap[commissionRow(row).orderStatus || ''] ?? 'neutral'"
          variant="subtle"
          :label="orderStatusLabelMap[commissionRow(row).orderStatus || ''] ?? String(commissionRow(row).orderStatus)"
          size="sm"
        />
        <span v-else class="text-sm text-muted">—</span>
      </template>
      <template #c_orderPayment-cell="{ row }">
        <UBadge
          v-if="commissionRow(row).orderPaymentStatus"
          :color="paymentStatusColorMap[commissionRow(row).orderPaymentStatus || ''] ?? 'neutral'"
          variant="subtle"
          :label="paymentStatusLabelMap[commissionRow(row).orderPaymentStatus || ''] ?? String(commissionRow(row).orderPaymentStatus)"
          size="sm"
        />
        <span v-else class="text-sm text-muted">—</span>
      </template>
      <template #c_amount-cell="{ row }">
        <span class="font-bold text-success">{{ formatCurrency(commissionRow(row).amount) }}</span>
      </template>
      <template #c_status-cell="{ row }">
        <UBadge
          :color="commissionStatusColorMap[commissionRow(row).status] ?? 'neutral'"
          variant="subtle"
          :label="commissionStatusLabelMap[commissionRow(row).status] ?? String(commissionRow(row).status)"
          size="sm"
        />
      </template>

      <!-- Itens vendidos -->
      <template #i_orderNumber-cell="{ row }">
        <span class="font-mono text-sm text-muted">#{{ itemRow(row).orderNumber }}</span>
      </template>
      <template #i_date-cell="{ row }">
        {{ formatDate(itemRow(row).date) }}
      </template>
      <template #i_totalValue-cell="{ row }">
        {{ formatCurrency(itemRow(row).totalValue) }}
      </template>
      <template #i_totalCost-cell="{ row }">
        <span class="text-error">{{ formatCurrency(itemRow(row).totalCost) }}</span>
      </template>
      <template #i_commissionCost-cell="{ row }">
        <span class="text-warning">{{ formatCurrency(itemRow(row).commissionCost) }}</span>
      </template>
      <template #i_profit-cell="{ row }">
        <span class="font-bold" :class="itemRow(row).profit >= 0 ? 'text-success' : 'text-error'">
          {{ formatCurrency(itemRow(row).profit) }}
        </span>
      </template>
    </AppDataTableInfinite>
  </div>
</template>
