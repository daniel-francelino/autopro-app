<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import type { RowSelectionState, SortingState } from '@tanstack/table-core'
import { ActionCode } from '~/constants/action-codes'
import type { ViewMode } from '~/types/ui'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Devoluções' })

type ReturnStatusFilter = 'all' | 'pending' | 'completed'
type ReturnReasonFilter = 'all' | 'warranty' | 'wrong_part' | 'manufacturing_defect' | 'damaged_product' | 'incompatible' | 'other'

type PurchaseLineItem = {
  part_id?: string | null
  description?: string
  quantity?: number
  unit_cost_price?: number
  unit_sale_price?: number | null
  total_item_price?: number
}

type PurchaseOption = {
  id: string
  supplier_id: string
  suppliers?: { name: string } | null
  invoice_number?: string | null
  purchase_date?: string | null
  items?: PurchaseLineItem[] | null
}

type PurchaseReturnItem = {
  id: string
  purchase_id: string
  supplier_id: string
  return_date: string
  reason: Exclude<ReturnReasonFilter, 'all'>
  status: Exclude<ReturnStatusFilter, 'all'>
  total_returned_amount: number
  notes: string | null
  returned_items: unknown[] | null
  suppliers?: { id: string, name: string } | null
}

type PurchaseReturnsResponse = {
  items: PurchaseReturnItem[]
  total: number
  page: number
  page_size: number
}

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const MANAGED_QUERY_KEYS = ['search', 'status', 'reason', 'page', 'pageSize', 'view', 'sortBy', 'sortOrder'] as const

const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const route = useRoute()
const router = useRouter()

const canRead = computed(() => workshop.can(ActionCode.RETURNS_READ))
const canCreate = computed(() => workshop.can(ActionCode.RETURNS_CREATE))
const canUpdate = computed(() => workshop.can(ActionCode.RETURNS_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.RETURNS_DELETE))

function parsePage(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1
}

function parsePageSize(value: unknown) {
  const parsed = Number(value)
  return PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : DEFAULT_PAGE_SIZE
}

function parseView(value: unknown): ViewMode {
  return value === 'card' ? 'card' : 'table'
}

function parseStatus(value: unknown): ReturnStatusFilter {
  return value === 'pending' || value === 'completed' ? value : 'all'
}

function parseReason(value: unknown): ReturnReasonFilter {
  return value === 'warranty'
    || value === 'wrong_part'
    || value === 'manufacturing_defect'
    || value === 'damaged_product'
    || value === 'incompatible'
    || value === 'other'
    ? value
    : 'all'
}

const search = ref(typeof route.query.search === 'string' ? route.query.search : '')
const debouncedSearch = ref(search.value)
const statusFilter = ref<ReturnStatusFilter>(parseStatus(route.query.status))
const reasonFilter = ref<ReturnReasonFilter>(parseReason(route.query.reason))
const page = ref(parsePage(route.query.page))
const pageSize = ref(parsePageSize(route.query.pageSize))
const viewMode = ref<ViewMode>(parseView(route.query.view))

const DEFAULT_SORT = { id: 'return_date', desc: true }
const sorting = ref<SortingState>(
  typeof route.query.sortBy === 'string' && route.query.sortBy
    ? [{ id: route.query.sortBy, desc: route.query.sortOrder === 'desc' }]
    : [DEFAULT_SORT]
)

const requestQuery = computed(() => ({
  search: debouncedSearch.value || undefined,
  status: statusFilter.value !== 'all' ? statusFilter.value : undefined,
  reason: reasonFilter.value !== 'all' ? reasonFilter.value : undefined,
  page: page.value,
  page_size: pageSize.value,
  sort_by: sorting.value[0]?.id || undefined,
  sort_order: sorting.value[0]?.desc ? 'desc' : 'asc'
}))

const { data, status, refresh } = await useAsyncData(
  () => `purchase-returns-${debouncedSearch.value}-${statusFilter.value}-${reasonFilter.value}-${page.value}-${pageSize.value}-${sorting.value[0]?.id}-${sorting.value[0]?.desc}`,
  async () => {
    if (!canRead.value) {
      return {
        items: [],
        total: 0,
        page: 1,
        page_size: pageSize.value
      } satisfies PurchaseReturnsResponse
    }

    return requestFetch<PurchaseReturnsResponse>('/api/purchase-returns', {
      headers: requestHeaders,
      query: requestQuery.value
    })
  },
  {
    watch: [requestQuery],
    default: () => ({
      items: [],
      total: 0,
      page: 1,
      page_size: pageSize.value
    })
  }
)

const { data: purchasesData } = await useAsyncData(
  'purchase-returns-purchases-options',
  () => requestFetch<{ items: PurchaseOption[] }>('/api/purchases', {
    headers: requestHeaders,
    query: { page: 1, page_size: 300, sort_by: 'purchase_date', sort_order: 'desc' }
  }),
  { default: () => ({ items: [] }) }
)

const purchaseReturnItems = computed(() => data.value?.items ?? [])
const totalReturns = computed(() => data.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalReturns.value / pageSize.value)))

const activeFiltersCount = computed(() => {
  let count = 0
  if (statusFilter.value !== 'all') count++
  if (reasonFilter.value !== 'all') count++
  return count
})

function formatDateBR(value: string | null | undefined) {
  if (!value) return ''
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value
}

const purchaseOptions = computed(() =>
  (purchasesData.value.items ?? []).map(purchase => ({
    label: [
      purchase.invoice_number ? `NF ${purchase.invoice_number}` : null,
      purchase.suppliers?.name,
      purchase.purchase_date ? formatDateBR(purchase.purchase_date) : null
    ].filter(Boolean).join(' - '),
    value: purchase.id,
    supplier_id: purchase.supplier_id
  }))
)

function buildManagedQuery() {
  return {
    search: search.value || undefined,
    status: statusFilter.value !== 'all' ? statusFilter.value : undefined,
    reason: reasonFilter.value !== 'all' ? reasonFilter.value : undefined,
    page: page.value > 1 ? String(page.value) : undefined,
    pageSize: pageSize.value !== DEFAULT_PAGE_SIZE ? String(pageSize.value) : undefined,
    view: viewMode.value !== 'table' ? viewMode.value : undefined,
    sortBy: sorting.value[0]?.id || undefined,
    sortOrder: sorting.value[0]?.desc ? 'desc' : undefined
  }
}

async function syncQuery() {
  const nextQuery = Object.fromEntries(
    Object.entries(route.query).filter(
      ([key]) => !MANAGED_QUERY_KEYS.includes(key as (typeof MANAGED_QUERY_KEYS)[number])
    )
  ) as Record<string, string | string[] | undefined>

  Object.assign(nextQuery, buildManagedQuery())

  if (JSON.stringify(route.query) === JSON.stringify(nextQuery))
    return

  await router.replace({ query: nextQuery })
}

async function submitSearch(value: string) {
  search.value = value
  debouncedSearch.value = value
  page.value = 1
  await syncQuery()
}

watch(
  () => route.query,
  (query) => {
    const nextSearch = typeof query.search === 'string' ? query.search : ''
    const nextStatus = parseStatus(query.status)
    const nextReason = parseReason(query.reason)
    const nextPage = parsePage(query.page)
    const nextPageSize = parsePageSize(query.pageSize)
    const nextView = parseView(query.view)

    if (search.value !== nextSearch) {
      search.value = nextSearch
      debouncedSearch.value = nextSearch
    }

    if (statusFilter.value !== nextStatus)
      statusFilter.value = nextStatus

    if (reasonFilter.value !== nextReason)
      reasonFilter.value = nextReason

    if (page.value !== nextPage)
      page.value = nextPage

    if (pageSize.value !== nextPageSize)
      pageSize.value = nextPageSize

    if (viewMode.value !== nextView)
      viewMode.value = nextView

    const nextSortBy = typeof query.sortBy === 'string' ? query.sortBy : ''
    const nextSortDesc = query.sortOrder === 'desc'
    const currentSort = sorting.value[0]

    if (nextSortBy) {
      if (!currentSort || currentSort.id !== nextSortBy || currentSort.desc !== nextSortDesc)
        sorting.value = [{ id: nextSortBy, desc: nextSortDesc }]
    } else if (!currentSort || currentSort.id !== DEFAULT_SORT.id || currentSort.desc !== DEFAULT_SORT.desc) {
      sorting.value = [DEFAULT_SORT]
    }
  }
)

watchDebounced(
  search,
  async (value) => {
    debouncedSearch.value = value
    page.value = 1
    await syncQuery()
  },
  { debounce: 300, maxWait: 800 }
)

watch(statusFilter, async () => {
  page.value = 1
  await syncQuery()
})

watch(reasonFilter, async () => {
  page.value = 1
  await syncQuery()
})

watch(page, async () => {
  if (page.value > totalPages.value && totalPages.value > 0)
    page.value = totalPages.value

  await syncQuery()
})

watch(pageSize, async () => {
  page.value = 1
  await syncQuery()
})

watch(viewMode, syncQuery)

watch(sorting, async () => {
  page.value = 1
  await syncQuery()
})

function formatCurrency(value: number | string | undefined | null) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

function formatDate(value: string | null | undefined) {
  if (!value)
    return '-'

  return new Intl.DateTimeFormat('pt-BR').format(new Date(`${value}T00:00:00`))
}

const statusFilterOptions = [
  { label: 'Todos os status', value: 'all' },
  { label: 'Pendentes', value: 'pending' },
  { label: 'Concluídas', value: 'completed' }
]

const statusFormOptions = [
  { label: 'Pendente', value: 'pending' },
  { label: 'Concluída', value: 'completed' }
]

const reasonFilterOptions = [
  { label: 'Todos os motivos', value: 'all' },
  { label: 'Garantia', value: 'warranty' },
  { label: 'Peça errada', value: 'wrong_part' },
  { label: 'Defeito de fabricação', value: 'manufacturing_defect' },
  { label: 'Produto danificado', value: 'damaged_product' },
  { label: 'Incompatível', value: 'incompatible' },
  { label: 'Outros', value: 'other' }
]

const reasonFormOptions = reasonFilterOptions.filter(option => option.value !== 'all')

const statusColorMap: Record<string, 'warning' | 'success' | 'neutral'> = {
  pending: 'warning',
  completed: 'success'
}

const statusLabelMap: Record<string, string> = {
  pending: 'Pendente',
  completed: 'Concluída'
}

const statusIconMap: Record<string, string> = {
  pending: 'i-lucide-clock',
  completed: 'i-lucide-circle-check'
}

const reasonLabelMap: Record<string, string> = {
  warranty: 'Garantia',
  wrong_part: 'Peça errada',
  manufacturing_defect: 'Defeito de fabricação',
  damaged_product: 'Produto danificado',
  incompatible: 'Incompatível',
  other: 'Outros'
}

const showModal = ref(false)
const selectedReturn = ref<PurchaseReturnItem | null>(null)
const isSaving = ref(false)
const isDeleting = ref(false)
const showDeleteModal = ref(false)
const showBulkDeleteModal = ref(false)
const returnPendingDeletion = ref<PurchaseReturnItem | null>(null)
const isBulkDeleting = ref(false)

type ReturnFormItem = {
  purchase_item_index: number | null
  part_id: string | null
  description: string
  quantity: number
  unit_price: number | string
  total_price: number
  notes: string
}

function todayISO() {
  return new Date().toISOString().split('T')[0] || ''
}

const form = reactive({
  purchase_id: '',
  supplier_id: '',
  return_date: todayISO(),
  reason: 'other',
  status: 'pending',
  total_returned_amount: '' as string | number,
  notes: ''
})

const returnedItems = ref<ReturnFormItem[]>([])

function createEmptyReturnItem(): ReturnFormItem {
  return {
    purchase_item_index: null,
    part_id: null,
    description: '',
    quantity: 1,
    unit_price: '',
    total_price: 0,
    notes: ''
  }
}

function normalizeReturnedItem(item: unknown): ReturnFormItem | null {
  if (!item || typeof item !== 'object')
    return null

  const source = item as Record<string, unknown>
  const quantity = Number(
    source.quantity
    ?? source.returned_quantity
    ?? 1
  )
  const unitPrice = Number(
    source.unit_price
    ?? source.unit_cost_price
    ?? source.price
    ?? source.value
    ?? 0
  )
  const totalPrice = Number(
    source.total_price
    ?? source.total_item_price
    ?? quantity * unitPrice
  )

  return {
    purchase_item_index: typeof source.purchase_item_index === 'number' ? source.purchase_item_index : null,
    part_id: typeof source.part_id === 'string' ? source.part_id : null,
    description: typeof source.description === 'string'
      ? source.description
      : typeof source.name === 'string'
        ? source.name
        : '',
    quantity,
    unit_price: unitPrice || '',
    total_price: totalPrice,
    notes: typeof source.notes === 'string' ? source.notes : ''
  }
}

const selectedPurchase = computed(() =>
  (purchasesData.value.items ?? []).find(item => item.id === form.purchase_id) ?? null
)

const purchaseItemOptions = computed(() =>
  (selectedPurchase.value?.items ?? []).map((item, index) => ({
    label: [
      item.description || `Item ${index + 1}`,
      `${Number(item.quantity || 0)} un`,
      formatCurrency(item.unit_cost_price || 0)
    ].join(' • '),
    value: index
  }))
)

function availablePurchaseItemOptions(currentItem: ReturnFormItem) {
  const takenIndices = new Set(
    returnedItems.value
      .filter(i => i !== currentItem && i.purchase_item_index !== null)
      .map(i => i.purchase_item_index)
  )
  return purchaseItemOptions.value.filter(opt => !takenIndices.has(opt.value))
}

function recalcReturnedItem(item: ReturnFormItem) {
  item.total_price = Number(item.quantity || 0) * Number(item.unit_price || 0)
}

function returnedItemHasContent(item: ReturnFormItem) {
  return Boolean(
    item.description.trim()
    || Number(item.quantity) > 0
    || Number(item.unit_price || 0) > 0
  )
}

const returnedItemsTotal = computed(() =>
  returnedItems.value.reduce((sum, item) => sum + Number(item.total_price || 0), 0)
)

watch(returnedItemsTotal, (val) => {
  form.total_returned_amount = Number(val.toFixed(2))
})

function addReturnedItem() {
  returnedItems.value.push(createEmptyReturnItem())
}

function removeReturnedItem(index: number) {
  if (returnedItems.value.length === 1)
    return

  returnedItems.value.splice(index, 1)
}

function onPurchaseItemSelect(item: ReturnFormItem, purchaseItemIndex: number | null) {
  if (purchaseItemIndex == null)
    return

  const source = selectedPurchase.value?.items?.[purchaseItemIndex]
  if (!source)
    return

  item.purchase_item_index = purchaseItemIndex
  item.part_id = source.part_id ?? null
  item.description = source.description ?? ''
  item.quantity = Number(source.quantity || 1)
  item.unit_price = Number(source.unit_cost_price || 0) || ''
  recalcReturnedItem(item)
}

watch(() => form.purchase_id, (purchaseId) => {
  const purchase = purchaseOptions.value.find(option => option.value === purchaseId)
  if (purchase)
    form.supplier_id = purchase.supplier_id
})

function resetForm() {
  const today = todayISO()
  Object.assign(form, {
    purchase_id: '',
    supplier_id: '',
    return_date: today,
    reason: 'other',
    status: 'pending',
    total_returned_amount: '',
    notes: ''
  })
  returnedItems.value = [createEmptyReturnItem()]
}

function openCreate() {
  selectedReturn.value = null
  resetForm()
  showModal.value = true
}

function openEdit(item: PurchaseReturnItem) {
  selectedReturn.value = item
  const rd = item.return_date ?? ''
  Object.assign(form, {
    purchase_id: item.purchase_id ?? '',
    supplier_id: item.supplier_id ?? '',
    return_date: rd,
    reason: item.reason ?? 'other',
    status: item.status ?? 'pending',
    total_returned_amount: item.total_returned_amount ?? '',
    notes: item.notes ?? ''
  })
  returnedItems.value = Array.isArray(item.returned_items) && item.returned_items.length
    ? item.returned_items
        .map(normalizeReturnedItem)
        .filter((entry): entry is ReturnFormItem => entry !== null)
    : [createEmptyReturnItem()]
  showModal.value = true
}

async function save() {
  if (isSaving.value)
    return

  if (!form.purchase_id || !form.return_date) {
    toast.add({
      title: 'Preencha a compra e a data da devolução',
      color: 'warning'
    })
    return
  }

  const parsedItems = returnedItems.value
    .filter(returnedItemHasContent)
    .map((item) => {
      recalcReturnedItem(item)

      return {
        purchase_item_index: item.purchase_item_index,
        part_id: item.part_id,
        description: item.description.trim(),
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        total_price: Number(item.total_price || 0),
        notes: item.notes || null
      }
    })

  if (!parsedItems.length || parsedItems.some(item => !item.description || item.quantity <= 0)) {
    toast.add({
      title: 'Adicione pelo menos um item devolvido com descrição e quantidade válida',
      color: 'warning'
    })
    return
  }

  isSaving.value = true

  try {
    const body = {
      purchase_id: form.purchase_id,
      supplier_id: form.supplier_id,
      return_date: form.return_date,
      reason: form.reason,
      status: form.status,
      total_returned_amount: Number(returnedItemsTotal.value.toFixed(2)),
      returned_items: parsedItems,
      notes: form.notes || null
    }

    if (selectedReturn.value?.id) {
      await $fetch(`/api/purchase-returns/${selectedReturn.value.id}`, {
        method: 'PUT',
        body
      })
      toast.add({ title: 'Devolução atualizada', color: 'success' })
    } else {
      await $fetch('/api/purchase-returns', {
        method: 'POST',
        body
      })
      toast.add({ title: 'Devolução registrada', color: 'success' })
    }

    showModal.value = false
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao salvar devolução',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

function requestRemove(item: PurchaseReturnItem) {
  if (isDeleting.value)
    return

  returnPendingDeletion.value = item
  showDeleteModal.value = true
}

async function remove(item: PurchaseReturnItem) {
  if (isDeleting.value)
    return

  isDeleting.value = true

  try {
    await $fetch(`/api/purchase-returns/${item.id}`, { method: 'DELETE' })
    toast.add({ title: 'Devolução removida', color: 'success' })
    showDeleteModal.value = false
    returnPendingDeletion.value = null

    if (purchaseReturnItems.value.length === 1 && page.value > 1)
      page.value -= 1

    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao remover devolução',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isDeleting.value = false
  }
}

async function confirmRemove() {
  if (!returnPendingDeletion.value)
    return

  await remove(returnPendingDeletion.value)
}

const rowSelection = ref<RowSelectionState>({})
const selectedIds = computed(() =>
  Object.entries(rowSelection.value)
    .filter(([, value]) => value)
    .map(([id]) => id)
)
const selectedCount = computed(() => selectedIds.value.length)

watch(viewMode, () => {
  rowSelection.value = {}
})

async function confirmBulkDelete() {
  if (!selectedIds.value.length || isBulkDeleting.value)
    return

  isBulkDeleting.value = true

  try {
    await Promise.all(
      selectedIds.value.map(id => $fetch(`/api/purchase-returns/${id}`, { method: 'DELETE' }))
    )

    toast.add({
      title: `${selectedIds.value.length} devolução(ões) removida(s)`,
      color: 'success'
    })

    rowSelection.value = {}
    showBulkDeleteModal.value = false
    await refresh()
  } catch {
    toast.add({
      title: 'Erro ao excluir devoluções',
      color: 'error'
    })
  } finally {
    isBulkDeleting.value = false
  }
}

const lineColumns = [
  { accessorKey: 'return_date', header: 'Data', enableSorting: true },
  { id: 'supplier', header: 'Fornecedor', enableSorting: false },
  { accessorKey: 'reason', header: 'Motivo', enableSorting: true },
  { accessorKey: 'total_returned_amount', header: 'Valor', enableSorting: true },
  { accessorKey: 'status', header: 'Status', enableSorting: true },
  { id: 'actions', header: 'Ações', enableSorting: false }
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Devoluções" />
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar devoluções.
        </p>
      </div>

      <div v-else class="p-4">
        <AppDataTable
          v-model:display-mode="viewMode"
          v-model:search-term="search"
          v-model:page="page"
          v-model:page-size="pageSize"
          v-model:sorting="sorting"
          v-model:row-selection="rowSelection"
          :columns="lineColumns"
          :data="purchaseReturnItems"
          :loading="status === 'pending'"
          :loading-variant="viewMode === 'card' ? 'card' : 'row'"
          :selectable="viewMode === 'table'"
          :sticky-header="viewMode === 'table'"
          :get-row-id="(row) => String(row.id ?? '')"
          :page-size-options="PAGE_SIZE_OPTIONS"
          :total="totalReturns"
          search-placeholder="Buscar por fornecedor, nota fiscal ou observações..."
          :show-search="true"
          :show-view-mode-toggle="true"
          card-grid-class="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2"
          empty-icon="i-lucide-undo-2"
          empty-title="Nenhuma devolução encontrada"
          empty-description="Registre devoluções ou ajuste os filtros para continuar."
          @search-submit="submitSearch"
        >
          <template #toolbar-right>
            <UTooltip
              v-if="canDelete"
              :text="selectedCount > 0 ? `Excluir ${selectedCount} selecionado(s)` : 'Excluir seleção'"
            >
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="outline"
                size="sm"
                :disabled="selectedCount === 0"
                @click="showBulkDeleteModal = true"
              />
            </UTooltip>

            <UButton
              v-if="canCreate"
              label="Nova devolução"
              icon="i-lucide-plus"
              size="sm"
              @click="openCreate"
            />
          </template>

          <template #filters>
            <UPopover>
              <UButton
                icon="i-lucide-sliders-horizontal"
                :label="activeFiltersCount > 0 ? `Filtros (${activeFiltersCount})` : 'Filtros'"
                color="neutral"
                variant="outline"
                size="sm"
              />
              <template #content>
                <div class="w-64 space-y-3 p-3">
                  <UFormField label="Status">
                    <USelectMenu
                      v-model="statusFilter"
                      :items="statusFilterOptions"
                      value-key="value"
                      class="w-full"
                      :search-input="false"
                    />
                  </UFormField>
                  <UFormField label="Motivo">
                    <USelectMenu
                      v-model="reasonFilter"
                      :items="reasonFilterOptions"
                      value-key="value"
                      class="w-full"
                      :search-input="false"
                    />
                  </UFormField>
                </div>
              </template>
            </UPopover>
          </template>

          <template #return_date-cell="{ row }">
            <span class="text-sm text-muted">
              {{ formatDate((row.original as PurchaseReturnItem).return_date) }}
            </span>
          </template>

          <template #supplier-cell="{ row }">
            <div class="min-w-0">
              <p class="truncate font-medium text-highlighted">
                {{ (row.original as PurchaseReturnItem).suppliers?.name || 'Fornecedor não informado' }}
              </p>
            </div>
          </template>

          <template #reason-cell="{ row }">
            <span class="text-sm text-muted">
              {{ reasonLabelMap[(row.original as PurchaseReturnItem).reason] || (row.original as PurchaseReturnItem).reason }}
            </span>
          </template>

          <template #total_returned_amount-cell="{ row }">
            <span class="text-sm text-muted">
              {{ formatCurrency((row.original as PurchaseReturnItem).total_returned_amount) }}
            </span>
          </template>

          <template #status-cell="{ row }">
            <UBadge
              :label="statusLabelMap[(row.original as PurchaseReturnItem).status] || (row.original as PurchaseReturnItem).status"
              :color="statusColorMap[(row.original as PurchaseReturnItem).status] || 'neutral'"
              :leading-icon="statusIconMap[(row.original as PurchaseReturnItem).status]"
              variant="subtle"
              size="xs"
            />
          </template>

          <template #actions-cell="{ row }">
            <div class="flex items-center justify-end gap-2">
              <UTooltip v-if="canUpdate" text="Editar devolução">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="openEdit(row.original as PurchaseReturnItem)"
                />
              </UTooltip>

              <UTooltip v-if="canDelete" text="Excluir devolução">
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :loading="isDeleting"
                  @click="requestRemove(row.original as PurchaseReturnItem)"
                />
              </UTooltip>
            </div>
          </template>

          <template #card="{ item: returnItem }">
            <UCard class="border border-default/80 shadow-sm">
              <div class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 space-y-2">
                    <h3 class="truncate text-base font-semibold text-highlighted">
                      {{ (returnItem as PurchaseReturnItem).suppliers?.name || 'Fornecedor não informado' }}
                    </h3>
                    <div class="flex flex-wrap items-center gap-2">
                      <UBadge
                        :label="statusLabelMap[(returnItem as PurchaseReturnItem).status] || (returnItem as PurchaseReturnItem).status"
                        :color="statusColorMap[(returnItem as PurchaseReturnItem).status] || 'neutral'"
                        :leading-icon="statusIconMap[(returnItem as PurchaseReturnItem).status]"
                        variant="subtle"
                        size="xs"
                      />
                      <UBadge
                        :label="reasonLabelMap[(returnItem as PurchaseReturnItem).reason] || (returnItem as PurchaseReturnItem).reason"
                        color="neutral"
                        variant="subtle"
                        size="xs"
                      />
                    </div>
                  </div>

                  <div class="flex shrink-0 items-center gap-1">
                    <UTooltip v-if="canUpdate" text="Editar devolução">
                      <UButton
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        @click="openEdit(returnItem as PurchaseReturnItem)"
                      />
                    </UTooltip>

                    <UTooltip v-if="canDelete" text="Excluir devolução">
                      <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        size="xs"
                        :loading="isDeleting"
                        @click="requestRemove(returnItem as PurchaseReturnItem)"
                      />
                    </UTooltip>
                  </div>
                </div>

                <div class="grid grid-cols-1 gap-2 text-sm text-muted sm:grid-cols-2">
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-calendar" class="size-4 shrink-0" />
                    <span class="truncate">{{ formatDate((returnItem as PurchaseReturnItem).return_date) }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-circle-dollar-sign" class="size-4 shrink-0" />
                    <span class="truncate font-medium text-highlighted">{{ formatCurrency((returnItem as PurchaseReturnItem).total_returned_amount) }}</span>
                  </div>
                </div>
              </div>
            </UCard>
          </template>
        </AppDataTable>
      </div>
    </template>
  </UDashboardPanel>

  <UModal
    v-model:open="showModal"
    :title="selectedReturn ? 'Editar devolução' : 'Nova devolução'"
    :ui="{ body: 'overflow-y-auto max-h-[75vh]' }"
  >
    <template #body>
      <div class="space-y-4">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="Compra" required class="sm:col-span-2">
            <USelectMenu
              v-model="form.purchase_id"
              :items="purchaseOptions"
              value-key="value"
              class="w-full"
              searchable
            />
          </UFormField>

          <UFormField label="Data da devolução" required>
            <UiDatePicker v-model="form.return_date" class="w-full" />
          </UFormField>

          <UFormField label="Motivo">
            <USelectMenu
              v-model="form.reason"
              :items="reasonFormOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Status">
            <USelectMenu
              v-model="form.status"
              :items="statusFormOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Observações" class="sm:col-span-2">
            <UTextarea v-model="form.notes" class="w-full" :rows="3" />
          </UFormField>
        </div>

        <template v-if="form.purchase_id">
          <USeparator label="Itens devolvidos" />

          <div class="space-y-3">
            <div
              v-for="(item, index) in returnedItems"
              :key="`${item.part_id || 'returned-item'}-${index}`"
              class="space-y-3 rounded-lg border border-default p-3"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-muted">Item {{ index + 1 }}</span>
                <UButton
                  v-if="returnedItems.length > 1"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  @click="removeReturnedItem(index)"
                />
              </div>

              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <UFormField
                  v-if="purchaseItemOptions.length"
                  label="Item"
                  class="sm:col-span-2"
                >
                  <USelectMenu
                    :model-value="item.purchase_item_index ?? undefined"
                    :items="availablePurchaseItemOptions(item)"
                    value-key="value"
                    class="w-full"
                    searchable
                    clearable
                    placeholder="Selecionar item da compra (opcional)"
                    @update:model-value="(v: number | undefined) => { item.purchase_item_index = v ?? null; onPurchaseItemSelect(item, item.purchase_item_index) }"
                  />
                </UFormField>

                <UFormField label="Descrição" required class="sm:col-span-2">
                  <UInput v-model="item.description" class="w-full" />
                </UFormField>

                <UFormField label="Quantidade">
                  <UInput
                    v-model="item.quantity"
                    type="number"
                    min="1"
                    step="1"
                    class="w-full"
                    @update:model-value="recalcReturnedItem(item)"
                  />
                </UFormField>

                <UFormField label="Valor unitário">
                  <UiCurrencyInput
                    v-model="item.unit_price"
                    @update:model-value="recalcReturnedItem(item)"
                  />
                </UFormField>

                <UFormField label="Total do item">
                  <UInput :model-value="formatCurrency(item.total_price)" disabled class="w-full" />
                </UFormField>

                <UFormField label="Observações" class="sm:col-span-2">
                  <UTextarea v-model="item.notes" class="w-full" :rows="2" />
                </UFormField>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-elevated/40 px-4 py-3">
              <div class="space-y-1">
                <p class="text-sm font-medium text-highlighted">
                  Total dos itens: {{ formatCurrency(returnedItemsTotal) }}
                </p>
              </div>

              <div class="flex flex-wrap gap-2">
                <UButton
                  label="Adicionar item"
                  icon="i-lucide-plus"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  @click="addReturnedItem"
                />
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          @click="showModal = false"
        />
        <UButton
          label="Salvar"
          :loading="isSaving"
          :disabled="isSaving"
          @click="save"
        />
      </div>
    </template>
  </UModal>

  <AppConfirmModal
    v-model:open="showDeleteModal"
    title="Confirmar exclusão"
    confirm-label="Excluir devolução"
    confirm-color="error"
    :loading="isDeleting"
    @confirm="confirmRemove"
    @update:open="
      (value: boolean) => {
        showDeleteModal = value
        if (!value && !isDeleting) returnPendingDeletion = null
      }
    "
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir a devolução
        <strong class="text-highlighted">
          {{ returnPendingDeletion?.suppliers?.name || 'selecionada' }}
        </strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>

  <AppConfirmModal
    v-model:open="showBulkDeleteModal"
    title="Excluir devoluções selecionadas"
    confirm-label="Excluir todas"
    confirm-color="error"
    :loading="isBulkDeleting"
    @confirm="confirmBulkDelete"
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir
        <strong class="text-highlighted">{{ selectedCount }} devolução(ões)</strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>
</template>
