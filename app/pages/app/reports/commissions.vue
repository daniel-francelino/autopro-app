<script setup lang="ts">
import type { SortingState } from '@tanstack/vue-table'
import type { CommissionDetailData } from '~/components/reports/commissions/CommissionsDetailSlideover.vue'
import type { PayConfirmTarget } from '~/components/reports/commissions/CommissionsPayConfirmModal.vue'
import type { BulkDateStrategy } from '~/components/reports/commissions/CommissionsBulkPayModal.vue'
import type { CommissionReportItem } from '~/composables/useCommissionsReportList'
import { ActionCode } from '~/constants/action-codes'

// A commission pending for longer than this is flagged so the user can
// choose to backdate the payment to when the OS was actually completed,
// instead of silently recording it against today's competência.
const OLD_COMMISSION_THRESHOLD_DAYS = 45

function daysSince(dateIso: string): number {
  const [y, m, d] = dateIso.split('-').map(Number)
  const date = new Date(y!, (m ?? 1) - 1, d)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
}

function isOldCommission(referenceDate: string): boolean {
  return daysSince(referenceDate) > OLD_COMMISSION_THRESHOLD_DAYS
}

interface BankAccountItem {
  id: string
  account_name?: string
  bank_name?: string
}

interface CommissionDetailResponse {
  data?: {
    detail?: CommissionDetailData
  }
}

type BadgeColor = 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Relatório de Comissões' })

const { can } = useWorkshopPermissions()
const toast = useToast()

const { dateFrom, dateTo, orderStatusFilters, paymentStatusFilters, selectedEmployees, paymentMethodFilters } = useReportDateRange()
const paymentMethods = paymentMethodFilters

// Filter state
const commissionStatus = useReportQueryParam('commissionStatus', [] as string[])
const recordType = useReportQueryParam('recordType', [] as string[])

// Pagination / sorting
const sortByParam = useReportQueryParam('sortBy', 'reference_date')
const sortOrderParam = useReportQueryParam('sortOrder', 'desc')
const sorting = computed<SortingState>({
  get: () => [{ id: sortByParam.value, desc: sortOrderParam.value !== 'asc' }],
  set: (val) => {
    sortByParam.value = val[0]?.id ?? 'reference_date'
    sortOrderParam.value = val[0]?.desc === false ? 'asc' : 'desc'
  }
})

const sortByMap: Record<string, string> = {
  employee_name: 'employee',
  order_number: 'order',
  reference_date: 'date',
  amount: 'amount',
  status_col: 'status'
}
const sortBy = computed(() => sortByMap[sortByParam.value] ?? 'date')
const sortOrder = computed(() => sortOrderParam.value)

// Selection for bulk pay
const selectedIds = ref<string[]>([])
const bulkPayOpen = ref(false)
const bankAccounts = ref<BankAccountItem[]>([])
const bulkPayLoading = ref(false)
const detailOpen = ref(false)
const detailLoading = ref(false)
const detailData = ref<CommissionDetailData | null>(null)
const payConfirmOpen = ref(false)
const payConfirmTarget = ref<PayConfirmTarget | null>(null)
const payConfirmLoading = ref(false)

interface CommissionDeleteTarget {
  id: string
  employeeName: string
  amount: number
  referenceDate: string
  orderNumber: string | null
}

// Delete confirm
const deleteTarget = ref<CommissionDeleteTarget | null>(null)
const deleteLoading = ref(false)

// Bulk delete
const bulkDeleteOpen = ref(false)
const bulkDeleteLoading = ref(false)

// Export
const exporting = ref<'csv' | 'pdf' | null>(null)
const hasSelection = computed(() => selectedIds.value.length > 0)
const hasPendingSelection = computed(() => bulkPayItems.value.length > 0)

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

const {
  items: accumulatedItems,
  total: totalFromServer,
  hasMore,
  isLoading,
  isLoadingMore,
  load: loadCommissions,
  loadMore,
  softRefresh,
  summary,
  charts,
  employees
} = useCommissionsReportList({
  dateFrom, dateTo, selectedEmployees, commissionStatus, recordType,
  orderStatusFilters, paymentStatusFilters, paymentMethods, sortBy, sortOrder
})

await loadCommissions()

// The composable already resets the list itself for these same dependencies —
// this only clears the row selection, which is page-level UI state it doesn't know about.
watch(
  [dateFrom, dateTo, selectedEmployees, commissionStatus, recordType, orderStatusFilters, paymentStatusFilters, paymentMethods, sortBy, sortOrder],
  () => { selectedIds.value = [] }
)

// Status maps
const commissionStatusColorMap: Record<string, BadgeColor> = { pending: 'warning', paid: 'success', cancelled: 'error' }
const commissionStatusLabelMap: Record<string, string> = { pending: 'Pendente', paid: 'Pago', cancelled: 'Cancelado' }

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

// Columns
const canUpdate = computed(() => can(ActionCode.FINANCIAL_UPDATE))
const canDelete = computed(() => can(ActionCode.FINANCIAL_DELETE))

const columns = computed(() => [
  ...(canUpdate.value ? [{ id: 'select', header: '', enableSorting: false }] : []),
  { accessorKey: 'reference_date', header: 'Referência' },
  { accessorKey: 'employee_name', header: 'Funcionário' },
  { accessorKey: 'order_number', header: 'OS', meta: { class: { th: 'min-w-[110px]', td: 'min-w-[110px] whitespace-nowrap' } } },
  { accessorKey: 'order_entry_date', header: 'Entrada OS', enableSorting: false },
  { id: 'order_status_col', header: 'Status OS', enableSorting: false },
  { id: 'order_payment_col', header: 'Pgto OS', enableSorting: false },
  { accessorKey: 'amount', header: 'Comissão' },
  { id: 'status_col', header: 'Status Com.' },
  { id: 'actions', header: '', enableSorting: false }
])

// Helpers
function getInitials(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/)
  if (parts.length === 1) return (parts[0]?.charAt(0) ?? '?').toUpperCase()
  return ((parts[0]?.charAt(0) ?? '') + (parts[parts.length - 1]?.charAt(0) ?? '')).toUpperCase()
}

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(v: string) {
  if (!v) return '—'
  const [y, m, d] = v.split('-')
  return `${d}/${m}/${y}`
}

function rowItem(row: { original: unknown }): CommissionReportItem {
  return row.original as CommissionReportItem
}

// Selection
const allSelected = computed(
  () => accumulatedItems.value.length > 0 && accumulatedItems.value.every(item => selectedIds.value.includes(item.id))
)

function toggleSelectAll() {
  if (allSelected.value) {
    selectedIds.value = []
  } else {
    selectedIds.value = accumulatedItems.value.map(item => item.id)
  }
}

function toggleSelectRow(id: string) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter(v => v !== id)
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}

// Bulk pay — only pending commissions from selection are sent to backend
const bulkPayItems = computed(() =>
  accumulatedItems.value
    .filter(item => selectedIds.value.includes(item.id) && item.status === 'pending')
    .map(item => ({
      id: item.id,
      employeeName: item.employee_name,
      osLabel: item.order_number ? `#${item.order_number}` : null,
      dateLabel: formatDate(item.reference_date),
      amount: item.amount,
      isOld: isOldCommission(item.reference_date)
    }))
)

const bulkPayTotal = computed(() =>
  bulkPayItems.value.reduce((sum, item) => sum + parseFloat(String(item.amount || 0)), 0)
)

async function openBulkPay() {
  if (!bankAccounts.value.length) {
    const res = await $fetch<{ items: BankAccountItem[] }>('/api/bank-accounts', { query: { is_active: 'true' } })
    bankAccounts.value = res.items ?? []
  }
  bulkPayOpen.value = true
}

async function openDetail(row: CommissionReportItem) {
  detailOpen.value = true
  detailLoading.value = true
  detailData.value = null

  try {
    const response = await $fetch<CommissionDetailResponse>(`/api/reports/commissions/${row.id}`)
    if (!response.data?.detail)
      throw new Error('Commission detail not found')
    detailData.value = response.data?.detail ?? null
  } catch {
    toast.add({ title: 'Erro ao carregar detalhes da comissão', color: 'error' })
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

async function handleBulkPay(accountId: string, dateStrategy: BulkDateStrategy) {
  bulkPayLoading.value = true
  const pendingIds = bulkPayItems.value.map(item => item.id)
  try {
    await $fetch('/api/financial/pay-commissions-bulk', {
      method: 'POST',
      body: { registroIds: pendingIds, contaBancariaId: accountId, dateStrategy }
    })
    toast.add({ title: 'Comissões pagas com sucesso!', color: 'success' })
    bulkPayOpen.value = false
    selectedIds.value = selectedIds.value.filter(v => !pendingIds.includes(v))
    await softRefresh()
  } catch {
    toast.add({ title: 'Erro ao pagar comissões', color: 'error' })
  } finally {
    bulkPayLoading.value = false
  }
}

// Row actions
async function payCommission(id: string) {
  const item = accumulatedItems.value.find(candidate => candidate.id === id)

  if (item && isOldCommission(item.reference_date)) {
    payConfirmTarget.value = {
      id: item.id,
      employeeName: item.employee_name,
      osLabel: item.order_number ? `#${item.order_number}` : null,
      referenceDateIso: item.reference_date,
      referenceDateLabel: formatDate(item.reference_date),
      daysPending: daysSince(item.reference_date),
      amount: item.amount
    }
    payConfirmOpen.value = true
    return
  }

  try {
    await $fetch(`/api/reports/commissions/${id}/pay`, { method: 'POST' })
    toast.add({ title: 'Comissão marcada como paga!', color: 'success' })
    selectedIds.value = selectedIds.value.filter(v => v !== id)
    await softRefresh()
  } catch {
    toast.add({ title: 'Erro ao pagar comissão', color: 'error' })
  }
}

async function confirmPayFromModal(paymentDate: string) {
  if (!payConfirmTarget.value) return
  const id = payConfirmTarget.value.id
  payConfirmLoading.value = true
  try {
    await $fetch(`/api/reports/commissions/${id}/pay`, { method: 'POST', body: { paymentDate } })
    toast.add({ title: 'Comissão marcada como paga!', color: 'success' })
    payConfirmOpen.value = false
    payConfirmTarget.value = null
    selectedIds.value = selectedIds.value.filter(v => v !== id)
    await softRefresh()
  } catch {
    toast.add({ title: 'Erro ao pagar comissão', color: 'error' })
  } finally {
    payConfirmLoading.value = false
  }
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  deleteLoading.value = true
  const targetId = deleteTarget.value.id
  try {
    await $fetch(`/api/reports/commissions/${targetId}`, { method: 'DELETE' })
    toast.add({ title: 'Comissão excluída', color: 'success' })
    deleteTarget.value = null
    selectedIds.value = selectedIds.value.filter(v => v !== targetId)
    await softRefresh()
  } catch {
    toast.add({ title: 'Erro ao excluir comissão', color: 'error' })
  } finally {
    deleteLoading.value = false
  }
}

function setDeleteTarget(row: CommissionReportItem) {
  deleteTarget.value = {
    id: row.id,
    employeeName: row.employee_name,
    amount: row.amount,
    referenceDate: row.reference_date,
    orderNumber: row.order_number ?? null
  }
}

async function handleBulkDelete() {
  bulkDeleteLoading.value = true
  const idsToDelete = [...selectedIds.value]
  try {
    await Promise.all(idsToDelete.map(id => $fetch(`/api/reports/commissions/${id}`, { method: 'DELETE' })))
    toast.add({ title: `${idsToDelete.length} comissões excluídas`, color: 'success' })
    bulkDeleteOpen.value = false
    selectedIds.value = selectedIds.value.filter(v => !idsToDelete.includes(v))
    await softRefresh()
  } catch {
    toast.add({ title: 'Erro ao excluir comissões', color: 'error' })
  } finally {
    bulkDeleteLoading.value = false
  }
}

// Export
async function exportReport(format: 'csv' | 'pdf') {
  exporting.value = format
  try {
    const res = await $fetch<{ success: boolean, data: { fileName: string, contentType: string, base64: string } }>(
      '/api/reports/export-commissions',
      {
        method: 'POST',
        body: {
          format,
          dateFrom: dateFrom.value,
          dateTo: dateTo.value,
          employeeIds: selectedEmployees.value.length ? selectedEmployees.value : undefined,
          status: commissionStatus.value.length === 1 ? commissionStatus.value[0] : undefined,
          recordType: recordType.value.length === 1 ? recordType.value[0] : undefined,
          orderStatusFilters: orderStatusFilters.value.length ? orderStatusFilters.value : undefined,
          paymentStatusFilters: paymentStatusFilters.value.length ? paymentStatusFilters.value : undefined,
          paymentMethods: paymentMethods.value.length ? paymentMethods.value : undefined,
          sortBy: sortBy.value,
          sortOrder: sortOrder.value
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
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Relatório de Comissões" />
    </template>

    <template #body>
      <div class="space-y-4 p-4">
        <ReportsCommissionsFilters
          v-model:date-from="dateFrom"
          v-model:date-to="dateTo"
          v-model:selected-employees="selectedEmployees"
          v-model:commission-status="commissionStatus"
          v-model:record-type="recordType"
          v-model:order-status-filters="orderStatusFilters"
          v-model:payment-status-filters="paymentStatusFilters"
          v-model:payment-methods="paymentMethods"
          :employees="employees"
        />

        <ReportsCommissionsStats :summary="summary" />

        <ReportsCommissionsCharts
          :by-employee="charts.byEmployee"
          :status-distribution="charts.statusDistribution"
        />

        <AppDataTableInfinite
          v-model:sorting="sorting"
          :columns="columns"
          :data="accumulatedItems as unknown as Record<string, unknown>[]"
          :loading="isLoading"
          :loading-more="isLoadingMore"
          :has-more="hasMore"
          :total="totalFromServer"
          empty-icon="i-lucide-badge-percent"
          empty-title="Nenhuma comissão encontrada"
          empty-description="Não há comissões registradas para o período selecionado."
          @load-more="loadMore"
        >
          <template #toolbar-right>
            <UButton
              v-if="canUpdate"
              label="Pagar"
              color="success"
              icon="i-lucide-credit-card"
              size="sm"
              :disabled="!hasPendingSelection"
              @click="openBulkPay"
            />
            <UButton
              v-if="canDelete"
              label="Excluir"
              color="error"
              icon="i-lucide-trash-2"
              size="sm"
              :disabled="!hasSelection"
              @click="bulkDeleteOpen = true"
            />
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

          <!-- Select all header -->
          <template #select-header>
            <UCheckbox
              :model-value="allSelected"
              :disabled="accumulatedItems.length === 0"
              @update:model-value="toggleSelectAll"
            />
          </template>

          <!-- Select row cell -->
          <template #select-cell="{ row }">
            <UCheckbox
              :model-value="selectedIds.includes(rowItem(row).id)"
              @update:model-value="toggleSelectRow(rowItem(row).id)"
            />
          </template>

          <template #employee_name-cell="{ row }">
            <div class="flex items-center gap-2">
              <div class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <span class="text-xs font-bold text-primary">
                  {{ getInitials(rowItem(row).employee_name ?? '') }}
                </span>
              </div>
              <span class="truncate font-medium text-highlighted">{{ rowItem(row).employee_name }}</span>
            </div>
          </template>

          <template #order_number-cell="{ row }">
            <span v-if="rowItem(row).order_number" class="font-mono text-sm text-muted">
              #{{ rowItem(row).order_number }}
            </span>
            <span v-else class="text-muted">—</span>
          </template>

          <template #reference_date-cell="{ row }">
            {{ formatDate(rowItem(row).reference_date) }}
          </template>

          <template #order_entry_date-cell="{ row }">
            {{ rowItem(row).order_entry_date ? formatDate(rowItem(row).order_entry_date || '') : '—' }}
          </template>

          <template #order_status_col-cell="{ row }">
            <UBadge
              v-if="rowItem(row).order_status"
              :color="orderStatusColorMap[rowItem(row).order_status || ''] ?? 'neutral'"
              variant="subtle"
              :label="orderStatusLabelMap[rowItem(row).order_status || ''] ?? String(rowItem(row).order_status)"
              size="sm"
            />
            <span v-else class="text-sm text-muted">—</span>
          </template>

          <template #order_payment_col-cell="{ row }">
            <UBadge
              v-if="rowItem(row).order_payment_status"
              :color="paymentStatusColorMap[rowItem(row).order_payment_status || ''] ?? 'neutral'"
              variant="subtle"
              :label="paymentStatusLabelMap[rowItem(row).order_payment_status || ''] ?? String(rowItem(row).order_payment_status)"
              size="sm"
            />
            <span v-else class="text-sm text-muted">—</span>
          </template>

          <template #amount-cell="{ row }">
            <span class="font-bold text-success">{{ formatCurrency(rowItem(row).amount) }}</span>
          </template>

          <template #status_col-cell="{ row }">
            <UBadge
              :color="commissionStatusColorMap[rowItem(row).status] ?? 'neutral'"
              variant="subtle"
              :label="commissionStatusLabelMap[rowItem(row).status] ?? String(rowItem(row).status)"
              size="sm"
            />
          </template>

          <template #actions-cell="{ row }">
            <div class="flex items-center justify-end gap-1">
              <UTooltip text="Ver detalhes">
                <UButton
                  icon="i-lucide-eye"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="openDetail(rowItem(row))"
                />
              </UTooltip>
              <UTooltip v-if="canUpdate && rowItem(row).status === 'pending'" text="Marcar como pago">
                <UButton
                  icon="i-lucide-circle-check"
                  color="success"
                  variant="ghost"
                  size="xs"
                  @click="payCommission(rowItem(row).id)"
                />
              </UTooltip>
              <UTooltip v-if="canDelete" text="Excluir comissão">
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  @click="setDeleteTarget(rowItem(row))"
                />
              </UTooltip>
            </div>
          </template>
        </AppDataTableInfinite>
      </div>
    </template>
  </UDashboardPanel>

  <ReportsCommissionsDetailSlideover
    :open="detailOpen"
    :loading="detailLoading"
    :data="detailData"
    @update:open="value => { detailOpen = value; if (!value) detailData = null }"
  />

  <!-- Bulk pay modal -->
  <ReportsCommissionsBulkPayModal
    v-model:open="bulkPayOpen"
    :items="bulkPayItems"
    :total="bulkPayTotal"
    :accounts="bankAccounts"
    :loading="bulkPayLoading"
    @confirm="handleBulkPay"
  />

  <!-- Single pay confirm modal (old commissions) -->
  <ReportsCommissionsPayConfirmModal
    v-model:open="payConfirmOpen"
    :target="payConfirmTarget"
    :loading="payConfirmLoading"
    @confirm="confirmPayFromModal"
  />

  <!-- Delete confirm modal -->
  <AppConfirmModal
    :open="deleteTarget !== null"
    title="Excluir comissão"
    confirm-label="Excluir"
    confirm-color="error"
    :loading="deleteLoading"
    @update:open="v => !v && (deleteTarget = null)"
    @confirm="confirmDelete"
  >
    <template #description>
      <div class="space-y-3">
        <p class="text-sm text-muted">
          Esta ação não pode ser desfeita.
        </p>
        <div class="rounded-lg bg-elevated p-3 space-y-1.5 text-sm">
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted">Funcionário</span>
            <span class="font-medium text-highlighted">{{ deleteTarget?.employeeName }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted">Referência</span>
            <span class="font-medium">{{ deleteTarget ? formatDate(deleteTarget.referenceDate) : '—' }}</span>
          </div>
          <div v-if="deleteTarget?.orderNumber" class="flex items-center justify-between gap-2">
            <span class="text-muted">OS</span>
            <span class="font-mono font-medium">#{{ deleteTarget.orderNumber }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted">Valor</span>
            <span class="font-bold text-error">{{ deleteTarget ? formatCurrency(deleteTarget.amount) : '—' }}</span>
          </div>
        </div>
      </div>
    </template>
  </AppConfirmModal>

  <!-- Bulk delete confirm modal -->
  <AppConfirmModal
    :open="bulkDeleteOpen"
    title="Excluir comissões selecionadas"
    confirm-label="Excluir tudo"
    confirm-color="error"
    :loading="bulkDeleteLoading"
    @update:open="v => !v && (bulkDeleteOpen = false)"
    @confirm="handleBulkDelete"
  >
    <template #description>
      <div class="space-y-2">
        <p class="text-sm text-muted">
          Esta ação não pode ser desfeita.
        </p>
        <p class="text-sm font-medium text-highlighted">
          {{ selectedIds.length }} comissão{{ selectedIds.length !== 1 ? 'ões' : '' }} serão excluídas permanentemente.
        </p>
      </div>
    </template>
  </AppConfirmModal>
</template>
