<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import type { RowSelectionState, SortingState } from '@tanstack/table-core'
import { ActionCode } from '~/constants/action-codes'
import type { ViewMode } from '~/types/ui'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Autorizações de Compra' })

type RequestStatusFilter = 'all' | 'waiting' | 'authorized' | 'rejected' | 'purchased'

type PurchaseRequestItemRow = {
  description: string
  quantity: number
  estimated_unit_price: number
  estimated_total_price: number
  notes?: string | null
}

type SupplierOption = { id: string, name: string }

type PurchaseRequestItem = {
  id: string
  request_number: string
  request_date: string
  supplier_id: string
  requester: string | null
  status: 'waiting' | 'authorized' | 'rejected' | 'purchased'
  items: PurchaseRequestItemRow[] | null
  total_request_amount: number
  justification: string | null
  notes: string | null
  suppliers?: { id: string, name: string } | null
}

type PurchaseRequestsResponse = {
  items: PurchaseRequestItem[]
  total: number
  page: number
  page_size: number
}

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const MANAGED_QUERY_KEYS = [
  'search',
  'status',
  'page',
  'pageSize',
  'view',
  'sortBy',
  'sortOrder'
] as const

const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const route = useRoute()
const router = useRouter()

const canRead = computed(() => workshop.can(ActionCode.AUTHORIZATIONS_READ))
const canCreate = computed(() => workshop.can(ActionCode.AUTHORIZATIONS_CREATE))
const canUpdate = computed(() => workshop.can(ActionCode.AUTHORIZATIONS_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.AUTHORIZATIONS_DELETE))
const canApprove = computed(() => workshop.can(ActionCode.AUTHORIZATIONS_APPROVE))

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

function parseStatus(value: unknown): RequestStatusFilter {
  return value === 'waiting' || value === 'authorized' || value === 'rejected' || value === 'purchased'
    ? value
    : 'all'
}

const search = ref(typeof route.query.search === 'string' ? route.query.search : '')
const debouncedSearch = ref(search.value)
const statusFilter = ref<RequestStatusFilter>(parseStatus(route.query.status))
const page = ref(parsePage(route.query.page))
const pageSize = ref(parsePageSize(route.query.pageSize))
const viewMode = ref<ViewMode>(parseView(route.query.view))

const DEFAULT_SORT = { id: 'request_date', desc: true }
const sorting = ref<SortingState>(
  typeof route.query.sortBy === 'string' && route.query.sortBy
    ? [{ id: route.query.sortBy, desc: route.query.sortOrder === 'desc' }]
    : [DEFAULT_SORT]
)

const requestQuery = computed(() => ({
  search: debouncedSearch.value || undefined,
  status: statusFilter.value !== 'all' ? statusFilter.value : undefined,
  page: page.value,
  page_size: pageSize.value,
  sort_by: sorting.value[0]?.id || undefined,
  sort_order: sorting.value[0]?.desc ? 'desc' : 'asc'
}))

const { data, status, refresh } = await useAsyncData(
  () => `purchase-requests-${debouncedSearch.value}-${statusFilter.value}-${page.value}-${pageSize.value}-${sorting.value[0]?.id}-${sorting.value[0]?.desc}`,
  async () => {
    if (!canRead.value) {
      return {
        items: [],
        total: 0,
        page: 1,
        page_size: pageSize.value
      } satisfies PurchaseRequestsResponse
    }

    return requestFetch<PurchaseRequestsResponse>('/api/purchase-requests', {
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

const { data: suppliersData } = await useAsyncData(
  'purchase-requests-suppliers-options',
  () => requestFetch<{ items: SupplierOption[] }>('/api/suppliers', {
    headers: requestHeaders,
    query: { page: 1, page_size: 500, sort_by: 'name', sort_order: 'asc' }
  }),
  { default: () => ({ items: [] }) }
)

const purchaseRequestItems = computed(() => data.value?.items ?? [])
const totalRequests = computed(() => data.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRequests.value / pageSize.value)))

const supplierOptions = computed(() =>
  (suppliersData.value.items ?? []).map(supplier => ({
    label: supplier.name,
    value: supplier.id
  }))
)

function buildManagedQuery() {
  return {
    search: search.value || undefined,
    status: statusFilter.value !== 'all' ? statusFilter.value : undefined,
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
    const nextPage = parsePage(query.page)
    const nextPageSize = parsePageSize(query.pageSize)
    const nextView = parseView(query.view)

    if (search.value !== nextSearch) {
      search.value = nextSearch
      debouncedSearch.value = nextSearch
    }

    if (statusFilter.value !== nextStatus)
      statusFilter.value = nextStatus

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

  return new Intl.DateTimeFormat('pt-BR').format(new Date(value))
}

const statusFilterOptions = [
  { label: 'Todos os status', value: 'all' },
  { label: 'Aguardando', value: 'waiting' },
  { label: 'Autorizado', value: 'authorized' },
  { label: 'Recusado', value: 'rejected' },
  { label: 'Comprado', value: 'purchased' }
]

const statusColorMap: Record<string, 'warning' | 'success' | 'error' | 'info' | 'neutral'> = {
  waiting: 'warning',
  authorized: 'success',
  rejected: 'error',
  purchased: 'info'
}

const statusLabelMap: Record<string, string> = {
  waiting: 'Aguardando',
  authorized: 'Autorizado',
  rejected: 'Recusado',
  purchased: 'Comprado'
}
const statusIconMap: Record<string, string> = {
  waiting: 'i-lucide-clock',
  authorized: 'i-lucide-circle-check',
  rejected: 'i-lucide-circle-x',
  purchased: 'i-lucide-shopping-cart'
}
const showRejectModal = ref(false)
const isRejecting = ref(false)
const selectedForAction = ref<PurchaseRequestItem | null>(null)
const rejectionReason = ref('')

async function authorize(request: PurchaseRequestItem) {
  try {
    await $fetch(`/api/purchase-requests/${request.id}/authorize`, { method: 'POST' })
    toast.add({ title: 'Solicitação autorizada', color: 'success' })
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao autorizar solicitação',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  }
}

function openReject(request: PurchaseRequestItem) {
  selectedForAction.value = request
  rejectionReason.value = ''
  showRejectModal.value = true
}

async function confirmReject() {
  if (isRejecting.value || !selectedForAction.value)
    return

  isRejecting.value = true

  try {
    await $fetch(`/api/purchase-requests/${selectedForAction.value.id}/reject`, {
      method: 'POST',
      body: { rejection_reason: rejectionReason.value || null }
    })
    toast.add({ title: 'Solicitação recusada', color: 'success' })
    showRejectModal.value = false
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao recusar solicitação',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isRejecting.value = false
  }
}

const showModal = ref(false)
const selectedRequest = ref<PurchaseRequestItem | null>(null)
const isSaving = ref(false)
const isDeleting = ref(false)
const showDeleteModal = ref(false)
const showBulkDeleteModal = ref(false)
const requestPendingDeletion = ref<PurchaseRequestItem | null>(null)
const isBulkDeleting = ref(false)

type RequestFormItem = {
  part_id?: string | null
  description: string
  code?: string | null
  quantity: number
  estimated_unit_price: number
  estimated_total_price: number
  notes?: string | null
}

type PartOption = {
  id: string
  code: string
  description: string
  sale_price: number
  cost_price: number | null
  brand: string | null
  stock_quantity: number
}

const partsData = ref<PartOption[]>([])
const isLoadingParts = ref(false)

async function loadParts() {
  if (partsData.value.length > 0) return
  isLoadingParts.value = true
  try {
    const res = await $fetch<{ items: PartOption[] }>('/api/parts', { query: { page_size: 200 } })
    partsData.value = res.items ?? []
  } finally {
    isLoadingParts.value = false
  }
}

const partOptions = computed(() =>
  partsData.value.map(p => ({
    label: p.code ? `${p.code} – ${p.description}` : p.description,
    value: p.id
  }))
)

function onPartSelect(item: RequestFormItem, partId: string | null) {
  if (!partId) return
  const part = partsData.value.find(p => p.id === partId)
  if (!part) return
  item.description = part.description
  item.code = part.code ?? ''
  item.estimated_unit_price = part.sale_price ?? 0
  recalcItem(item)
}

const form = reactive({
  supplier_id: '',
  justification: '',
  notes: ''
})
const items = ref<RequestFormItem[]>([
  { part_id: null, description: '', code: '', quantity: 1, estimated_unit_price: 0, estimated_total_price: 0, notes: '' }
])

function resetForm() {
  Object.assign(form, {
    supplier_id: '',
    justification: '',
    notes: ''
  })
  items.value = [
    { part_id: null, description: '', code: '', quantity: 1, estimated_unit_price: 0, estimated_total_price: 0, notes: '' }
  ]
}

function recalcItem(item: RequestFormItem) {
  item.estimated_total_price = Number(item.quantity || 0) * Number(item.estimated_unit_price || 0)
}

const totalAmount = computed(() =>
  items.value.reduce((sum, item) => sum + Number(item.estimated_total_price || 0), 0)
)

function addItem() {
  items.value.push({
    part_id: null,
    description: '',
    code: '',
    quantity: 1,
    estimated_unit_price: 0,
    estimated_total_price: 0,
    notes: ''
  })
}

function removeItem(index: number) {
  if (items.value.length === 1)
    return

  items.value.splice(index, 1)
}

function openCreate() {
  selectedRequest.value = null
  resetForm()
  loadParts()
  showModal.value = true
}

function openEdit(request: PurchaseRequestItem) {
  selectedRequest.value = request
  Object.assign(form, {
    supplier_id: request.supplier_id ?? '',
    justification: request.justification ?? '',
    notes: request.notes ?? ''
  })
  items.value = Array.isArray(request.items) && request.items.length
    ? request.items.map(item => ({ ...item }))
    : [{
        part_id: null,
        description: '',
        code: '',
        quantity: 1,
        estimated_unit_price: 0,
        estimated_total_price: 0,
        notes: ''
      }]
  loadParts()
  showModal.value = true
}

async function save() {
  if (isSaving.value)
    return

  if (!form.supplier_id || items.value.some(item => !item.description.trim())) {
    toast.add({
      title: 'Preencha fornecedor e descrição de todos os itens',
      color: 'warning'
    })
    return
  }

  isSaving.value = true

  try {
    const body = {
      supplier_id: form.supplier_id,
      items: items.value,
      total_request_amount: totalAmount.value,
      justification: form.justification || null,
      notes: form.notes || null
    }

    if (selectedRequest.value?.id) {
      await $fetch(`/api/purchase-requests/${selectedRequest.value.id}`, {
        method: 'PUT',
        body
      })
      toast.add({ title: 'Solicitação atualizada', color: 'success' })
    } else {
      await $fetch('/api/purchase-requests', {
        method: 'POST',
        body
      })
      toast.add({ title: 'Solicitação criada', color: 'success' })
    }

    showModal.value = false
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao salvar solicitação',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

function requestRemove(request: PurchaseRequestItem) {
  if (isDeleting.value)
    return

  requestPendingDeletion.value = request
  showDeleteModal.value = true
}

async function remove(request: PurchaseRequestItem) {
  if (isDeleting.value)
    return

  isDeleting.value = true

  try {
    await $fetch(`/api/purchase-requests/${request.id}`, { method: 'DELETE' })
    toast.add({ title: 'Solicitação removida', color: 'success' })
    showDeleteModal.value = false
    requestPendingDeletion.value = null

    if (purchaseRequestItems.value.length === 1 && page.value > 1)
      page.value -= 1

    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao remover solicitação',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isDeleting.value = false
  }
}

async function confirmRemove() {
  if (!requestPendingDeletion.value)
    return

  await remove(requestPendingDeletion.value)
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
      selectedIds.value.map(id => $fetch(`/api/purchase-requests/${id}`, { method: 'DELETE' }))
    )

    toast.add({
      title: `${selectedIds.value.length} solicitação(ões) removida(s)`,
      color: 'success'
    })

    rowSelection.value = {}
    showBulkDeleteModal.value = false
    await refresh()
  } catch {
    toast.add({
      title: 'Erro ao excluir solicitações',
      color: 'error'
    })
  } finally {
    isBulkDeleting.value = false
  }
}

const lineColumns = [
  { accessorKey: 'request_number', header: 'Número', enableSorting: true },
  { accessorKey: 'request_date', header: 'Data', enableSorting: true },
  { id: 'supplier', header: 'Fornecedor', enableSorting: false },
  { accessorKey: 'requester', header: 'Solicitante', enableSorting: true },
  { accessorKey: 'total_request_amount', header: 'Total estimado', enableSorting: true },
  { accessorKey: 'status', header: 'Status', enableSorting: true },
  { id: 'actions', header: 'Ações', enableSorting: false }
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Autorizações de Compra" />
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar solicitações de compra.
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
          :data="purchaseRequestItems"
          :loading="status === 'pending'"
          :loading-variant="viewMode === 'card' ? 'card' : 'row'"
          :selectable="viewMode === 'table'"
          :sticky-header="viewMode === 'table'"
          :get-row-id="(row) => String(row.id ?? '')"
          :page-size-options="PAGE_SIZE_OPTIONS"
          :total="totalRequests"
          search-placeholder="Buscar por número ou solicitante..."
          :show-search="true"
          :show-view-mode-toggle="true"
          card-grid-class="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2"
          empty-icon="i-lucide-clipboard-list"
          empty-title="Nenhuma solicitação encontrada"
          empty-description="Cadastre solicitações ou ajuste os filtros para continuar."
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
              label="Nova solicitação"
              icon="i-lucide-plus"
              size="sm"
              @click="openCreate"
            />
          </template>

          <template #filters>
            <USelectMenu
              v-model="statusFilter"
              :items="statusFilterOptions"
              value-key="value"
              class="w-full sm:w-48"
              :search-input="false"
            />
          </template>

          <template #request_date-cell="{ row }">
            <span class="text-sm text-muted">
              {{ formatDate((row.original as PurchaseRequestItem).request_date) }}
            </span>
          </template>

          <template #supplier-cell="{ row }">
            <div class="min-w-0">
              <p class="truncate font-medium text-highlighted">
                {{ (row.original as PurchaseRequestItem).suppliers?.name || 'Fornecedor não informado' }}
              </p>
            </div>
          </template>

          <template #total_request_amount-cell="{ row }">
            <span class="text-sm text-muted">
              {{ formatCurrency((row.original as PurchaseRequestItem).total_request_amount) }}
            </span>
          </template>

          <template #status-cell="{ row }">
            <UBadge
              :label="statusLabelMap[(row.original as PurchaseRequestItem).status] || (row.original as PurchaseRequestItem).status"
              :color="statusColorMap[(row.original as PurchaseRequestItem).status] || 'neutral'"
              :leading-icon="statusIconMap[(row.original as PurchaseRequestItem).status]"
              variant="subtle"
              size="xs"
            />
          </template>

          <template #actions-cell="{ row }">
            <div class="flex items-center justify-end gap-2">
              <template v-if="canApprove && row.original.status === 'waiting'">
                <UTooltip text="Autorizar solicitação">
                  <UButton
                    icon="i-lucide-check"
                    color="success"
                    variant="ghost"
                    size="xs"
                    @click="authorize(row.original as PurchaseRequestItem)"
                  />
                </UTooltip>
                <UTooltip text="Recusar solicitação">
                  <UButton
                    icon="i-lucide-x"
                    color="error"
                    variant="ghost"
                    size="xs"
                    @click="openReject(row.original as PurchaseRequestItem)"
                  />
                </UTooltip>
              </template>

              <UTooltip v-if="canUpdate && row.original.status === 'waiting'" text="Editar solicitação">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="openEdit(row.original as PurchaseRequestItem)"
                />
              </UTooltip>

              <UTooltip v-if="canDelete" text="Excluir solicitação">
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :loading="isDeleting"
                  @click="requestRemove(row.original as PurchaseRequestItem)"
                />
              </UTooltip>
            </div>
          </template>

          <template #card="{ item: request }">
            <UCard class="border border-default/80 shadow-sm">
              <div class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 space-y-2">
                    <h3 class="truncate text-base font-semibold text-highlighted">
                      {{ (request as PurchaseRequestItem).suppliers?.name || 'Fornecedor não informado' }}
                    </h3>
                    <div class="flex flex-wrap items-center gap-2">
                      <UBadge
                        :label="statusLabelMap[(request as PurchaseRequestItem).status] || (request as PurchaseRequestItem).status"
                        :color="statusColorMap[(request as PurchaseRequestItem).status] || 'neutral'"
                        :leading-icon="statusIconMap[(request as PurchaseRequestItem).status]"
                        variant="subtle"
                        size="xs"
                      />
                    </div>
                  </div>

                  <div class="flex shrink-0 items-center gap-1">
                    <template v-if="canApprove && (request as PurchaseRequestItem).status === 'waiting'">
                      <UTooltip text="Autorizar solicitação">
                        <UButton
                          icon="i-lucide-check"
                          color="success"
                          variant="ghost"
                          size="xs"
                          @click="authorize(request as PurchaseRequestItem)"
                        />
                      </UTooltip>
                      <UTooltip text="Recusar solicitação">
                        <UButton
                          icon="i-lucide-x"
                          color="error"
                          variant="ghost"
                          size="xs"
                          @click="openReject(request as PurchaseRequestItem)"
                        />
                      </UTooltip>
                    </template>

                    <UTooltip
                      v-if="canUpdate && (request as PurchaseRequestItem).status === 'waiting'"
                      text="Editar solicitação"
                    >
                      <UButton
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        @click="openEdit(request as PurchaseRequestItem)"
                      />
                    </UTooltip>

                    <UTooltip v-if="canDelete" text="Excluir solicitação">
                      <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        size="xs"
                        :loading="isDeleting"
                        @click="requestRemove(request as PurchaseRequestItem)"
                      />
                    </UTooltip>
                  </div>
                </div>

                <div class="grid grid-cols-1 gap-2 text-sm text-muted sm:grid-cols-2">
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-hash" class="size-4 shrink-0" />
                    <span class="truncate">{{ (request as PurchaseRequestItem).request_number }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-calendar" class="size-4 shrink-0" />
                    <span class="truncate">{{ formatDate((request as PurchaseRequestItem).request_date) }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-user" class="size-4 shrink-0" />
                    <span class="truncate">{{ (request as PurchaseRequestItem).requester || 'Não informado' }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-circle-dollar-sign" class="size-4 shrink-0" />
                    <span class="truncate font-medium text-highlighted">{{ formatCurrency((request as PurchaseRequestItem).total_request_amount) }}</span>
                  </div>
                </div>
              </div>
            </UCard>
          </template>
        </AppDataTable>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="showRejectModal" title="Recusar solicitação">
    <template #body>
      <div class="space-y-3">
        <p class="text-sm text-muted">
          Solicitação
          <strong>{{ selectedForAction?.request_number }}</strong>
          de
          <strong>{{ selectedForAction?.suppliers?.name || 'fornecedor' }}</strong>
        </p>

        <UFormField label="Motivo da recusa">
          <UTextarea
            v-model="rejectionReason"
            class="w-full"
            :rows="3"
            placeholder="Opcional..."
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          @click="showRejectModal = false"
        />
        <UButton
          label="Recusar"
          color="error"
          :loading="isRejecting"
          :disabled="isRejecting"
          @click="confirmReject"
        />
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="showModal"
    :title="selectedRequest ? 'Editar solicitação' : 'Nova solicitação de compra'"
    :ui="{ body: 'overflow-y-auto max-h-[80vh]' }"
  >
    <template #body>
      <div class="space-y-4">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="Fornecedor" required class="sm:col-span-2">
            <USelectMenu
              v-model="form.supplier_id"
              :items="supplierOptions"
              value-key="value"
              class="w-full"
              searchable
            />
          </UFormField>

          <UFormField label="Justificativa" class="sm:col-span-2">
            <UTextarea v-model="form.justification" class="w-full" :rows="2" />
          </UFormField>
        </div>

        <USeparator label="Itens" />

        <div
          v-for="(item, index) in items"
          :key="index"
          class="rounded-lg border border-default p-3 space-y-3"
        >
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-muted">Item {{ index + 1 }}</span>
            <UButton
              v-if="items.length > 1"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              @click="removeItem(index)"
            />
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UFormField label="Peça" class="sm:col-span-2">
              <USelectMenu
                :model-value="item.part_id ?? undefined"
                :items="partOptions"
                value-key="value"
                :loading="isLoadingParts"
                placeholder="Selecionar peça (opcional)"
                class="w-full"
                searchable
                clearable
                @update:model-value="(v) => { item.part_id = v as string | null | undefined; onPartSelect(item, item.part_id ?? null) }"
              />
            </UFormField>

            <UFormField label="Código">
              <UInput
                :model-value="item.code ?? undefined"
                class="w-full"
                placeholder="Ex: FILT-001"
                @update:model-value="item.code = $event"
              />
            </UFormField>

            <UFormField label="Descrição" required>
              <UInput v-model="item.description" class="w-full" />
            </UFormField>

            <UFormField label="Quantidade">
              <UInput
                v-model="item.quantity"
                type="number"
                min="1"
                class="w-full"
                @update:model-value="recalcItem(item)"
              />
            </UFormField>

            <UFormField label="Preço unitário estimado">
              <UiCurrencyInput
                v-model="item.estimated_unit_price"
                @update:model-value="recalcItem(item)"
              />
            </UFormField>

            <UFormField label="Total estimado" class="sm:col-span-2">
              <UInput :model-value="formatCurrency(item.estimated_total_price)" disabled class="w-full" />
            </UFormField>

            <UFormField label="Observações" class="sm:col-span-2">
              <UTextarea
                :model-value="item.notes ?? undefined"
                class="w-full"
                :rows="2"
                @update:model-value="item.notes = $event"
              />
            </UFormField>
          </div>
        </div>

        <UButton
          label="Adicionar item"
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          size="sm"
          @click="addItem"
        />

        <div class="text-right text-sm font-semibold">
          Total: {{ formatCurrency(totalAmount) }}
        </div>

        <UFormField label="Observações">
          <UTextarea v-model="form.notes" class="w-full" :rows="2" />
        </UFormField>
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
    confirm-label="Excluir solicitação"
    confirm-color="error"
    :loading="isDeleting"
    @confirm="confirmRemove"
    @update:open="
      (value: boolean) => {
        showDeleteModal = value
        if (!value && !isDeleting) requestPendingDeletion = null
      }
    "
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir a solicitação
        <strong class="text-highlighted">
          {{ requestPendingDeletion?.request_number || 'selecionada' }}
        </strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>

  <AppConfirmModal
    v-model:open="showBulkDeleteModal"
    title="Excluir solicitações selecionadas"
    confirm-label="Excluir todas"
    confirm-color="error"
    :loading="isBulkDeleting"
    @confirm="confirmBulkDelete"
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir
        <strong class="text-highlighted">{{ selectedCount }} solicitação(ões)</strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>
</template>
