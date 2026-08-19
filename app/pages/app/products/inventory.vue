<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import type { RowSelectionState, SortingState } from '@tanstack/table-core'
import { ActionCode } from '~/constants/action-codes'
import type { ProductCategory } from '~/types/products'
import { generateCode } from '~/utils'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Estoque' })

type ViewMode = 'table' | 'card'
type LowStockFilter = 'all' | 'low' | 'available'

type ProductOption = {
  id: string
  name: string
  code: number
  type: 'unit' | 'group'
  unit_sale_price: number | null
  unit_cost_price: number | null
  category_id?: string | null
  product_categories?: ProductCategory | null
}

type SupplierOption = {
  id: string
  name: string
}

type PartItem = {
  id: string
  product_id: string | null
  code: string
  description: string
  stock_quantity: number
  minimum_quantity: number | null
  sale_price: number | null
  cost_price: number | null
  brand: string | null
  category: string | null
  supplier_name: string | null
  location: string | null
  notes: string | null
  products?: ProductOption | null
}

type PartsResponse = {
  items: PartItem[]
  total: number
  page: number
  page_size: number
}

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const MANAGED_QUERY_KEYS = [
  'search',
  'category',
  'stock',
  'page',
  'pageSize',
  'view',
  'sortBy',
  'sortOrder'
] as const

const PART_TECHNICAL_CATEGORY_OPTIONS = [
  { label: 'Todas as categorias', value: 'all' },
  { label: 'Freios', value: 'brakes' },
  { label: 'Motor', value: 'engine' },
  { label: 'Suspensão', value: 'suspension' },
  { label: 'Transmissão', value: 'transmission' },
  { label: 'Elétrica', value: 'electrical' },
  { label: 'Funilaria', value: 'body' },
  { label: 'Filtros', value: 'filters' },
  { label: 'Óleos', value: 'oils' },
  { label: 'Pneus', value: 'tires' },
  { label: 'Outros', value: 'other' }
]

const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const route = useRoute()
const router = useRouter()

const canRead = computed(() => workshop.can(ActionCode.INVENTORY_READ))
const canCreate = computed(() => workshop.can(ActionCode.INVENTORY_CREATE))
const canUpdate = computed(() => workshop.can(ActionCode.INVENTORY_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.INVENTORY_DELETE))

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

function parseLowStockFilter(value: unknown): LowStockFilter {
  return value === 'low' || value === 'available' ? value : 'all'
}

const search = ref(typeof route.query.search === 'string' ? route.query.search : '')
const debouncedSearch = ref(search.value)
const categoryFilter = ref(typeof route.query.category === 'string' ? route.query.category : 'all')
const stockFilter = ref<LowStockFilter>(parseLowStockFilter(route.query.stock))
const page = ref(parsePage(route.query.page))
const pageSize = ref(parsePageSize(route.query.pageSize))
const viewMode = ref<ViewMode>(parseView(route.query.view))

const DEFAULT_SORT = { id: 'description', desc: false }
const sorting = ref<SortingState>(
  typeof route.query.sortBy === 'string' && route.query.sortBy
    ? [{ id: route.query.sortBy, desc: route.query.sortOrder === 'desc' }]
    : [DEFAULT_SORT]
)

const requestQuery = computed(() => ({
  search: debouncedSearch.value || undefined,
  category: categoryFilter.value !== 'all' ? categoryFilter.value : undefined,
  low_stock: stockFilter.value === 'low' ? 'true' : undefined,
  page: page.value,
  page_size: pageSize.value,
  sort_by: sorting.value[0]?.id || undefined,
  sort_order: sorting.value[0]?.desc ? 'desc' : 'asc'
}))

const { data, status, refresh } = await useAsyncData(
  () => `parts-${debouncedSearch.value}-${categoryFilter.value}-${stockFilter.value}-${page.value}-${pageSize.value}-${sorting.value[0]?.id}-${sorting.value[0]?.desc}`,
  async () => {
    if (!canRead.value) {
      return {
        items: [],
        total: 0,
        page: 1,
        page_size: pageSize.value
      } satisfies PartsResponse
    }

    const response = await requestFetch<PartsResponse>('/api/parts', {
      headers: requestHeaders,
      query: requestQuery.value
    })

    if (stockFilter.value === 'available') {
      const filteredItems = response.items.filter((item) => {
        const minimum = item.minimum_quantity ?? 0
        return item.stock_quantity > minimum
      })

      return {
        ...response,
        items: filteredItems,
        total: filteredItems.length
      }
    }

    return response
  },
  {
    watch: [requestQuery, stockFilter],
    default: () => ({
      items: [],
      total: 0,
      page: 1,
      page_size: pageSize.value
    })
  }
)

const { data: productsData } = await useAsyncData(
  'parts-products-options',
  () => requestFetch<{ items: ProductOption[] }>('/api/products', {
    headers: requestHeaders,
    query: { page: 1, page_size: 500, sort_by: 'name', sort_order: 'asc' }
  }),
  { default: () => ({ items: [] }) }
)

const { data: categoriesData } = await useAsyncData(
  'parts-product-categories-options',
  () => requestFetch<{ items: ProductCategory[] }>('/api/product-categories', {
    headers: requestHeaders
  }),
  { default: () => ({ items: [] }) }
)

const { data: suppliersData } = await useAsyncData(
  'parts-suppliers-options',
  () => requestFetch<{ items: SupplierOption[] }>('/api/suppliers', {
    headers: requestHeaders,
    query: { page: 1, page_size: 500, sort_by: 'name', sort_order: 'asc' }
  }),
  { default: () => ({ items: [] }) }
)

const partItems = computed(() => data.value?.items ?? [])
const totalParts = computed(() => data.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalParts.value / pageSize.value)))

const statsData = computed(() => {
  const items = partItems.value
  const outOfStock = items.filter(i => i.stock_quantity <= 0).length
  const lowStock = items.filter(i => i.stock_quantity > 0 && i.stock_quantity <= (i.minimum_quantity ?? 0)).length
  const available = items.filter(i => i.stock_quantity > (i.minimum_quantity ?? 0)).length
  return { total: totalParts.value, outOfStock, lowStock, available }
})
const categoriesList = computed(() => categoriesData.value?.items ?? [])
const categoryOptions = computed(() => [
  { label: 'Todas as categorias', value: 'all' },
  ...categoriesList.value.map(category => ({
    label: category.name,
    value: category.id
  }))
])

const activeFiltersCount = computed(() => {
  let count = 0
  if (categoryFilter.value !== 'all') count++
  if (stockFilter.value !== 'all') count++
  return count
})

const productOptions = computed(() => [
  { label: 'Sem vínculo com produto', value: null },
  ...(productsData.value.items ?? []).map(product => ({
    label: `${product.name} (${product.code})`,
    value: product.id
  }))
])

const supplierOptions = computed(() => [
  { label: 'Sem fornecedor definido', value: null },
  ...(suppliersData.value.items ?? []).map(supplier => ({
    label: supplier.name,
    value: supplier.name
  }))
])

function buildManagedQuery() {
  return {
    search: search.value || undefined,
    category: categoryFilter.value !== 'all' ? categoryFilter.value : undefined,
    stock: stockFilter.value !== 'all' ? stockFilter.value : undefined,
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
    const nextCategory = typeof query.category === 'string' ? query.category : 'all'
    const nextStock = parseLowStockFilter(query.stock)
    const nextPage = parsePage(query.page)
    const nextPageSize = parsePageSize(query.pageSize)
    const nextView = parseView(query.view)

    if (search.value !== nextSearch) {
      search.value = nextSearch
      debouncedSearch.value = nextSearch
    }

    if (categoryFilter.value !== nextCategory)
      categoryFilter.value = nextCategory

    if (stockFilter.value !== nextStock)
      stockFilter.value = nextStock

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

watch(categoryFilter, async () => {
  page.value = 1
  await syncQuery()
})

watch(stockFilter, async () => {
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

function formatCurrency(value: number | null) {
  if (value == null)
    return '-'

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value)
}

function getStockStatus(item: PartItem) {
  const minimum = item.minimum_quantity ?? 0

  if (item.stock_quantity <= 0)
    return { label: 'Sem estoque', color: 'error' as const, icon: 'i-lucide-circle-x' }

  if (item.stock_quantity <= minimum)
    return { label: 'Estoque baixo', color: 'warning' as const, icon: 'i-lucide-triangle-alert' }

  return { label: 'Disponível', color: 'success' as const, icon: 'i-lucide-circle-check' }
}

const showModal = ref(false)
const selectedPart = ref<PartItem | null>(null)
const isSaving = ref(false)
const isDeleting = ref(false)
const showDeleteModal = ref(false)
const showBulkDeleteModal = ref(false)
const partPendingDeletion = ref<PartItem | null>(null)
const isBulkDeleting = ref(false)

const form = reactive({
  product_id: null as string | null,
  code: '',
  description: '',
  stock_quantity: 0,
  minimum_quantity: 0,
  sale_price: '' as number | string,
  cost_price: '' as number | string,
  brand: '',
  category: 'other',
  supplier_name: null as string | null,
  location: '',
  notes: ''
})

const selectedProductOption = computed(() =>
  (productsData.value.items ?? []).find(product => product.id === form.product_id) ?? null
)

const selectedProductCategoryName = computed(() =>
  selectedProductOption.value?.product_categories?.name || 'Sem categoria do catálogo'
)

const selectedProductTypeLabel = computed(() =>
  selectedProductOption.value?.type === 'group' ? 'Grupo' : 'Unitário'
)

function handleProductSelect(productId: string | null) {
  const product = (productsData.value.items ?? []).find(item => item.id === productId)
  if (!product)
    return

  if (!form.description.trim())
    form.description = product.name ?? ''

  if (form.sale_price === '' && product.unit_sale_price != null)
    form.sale_price = product.unit_sale_price

  if (form.cost_price === '' && product.unit_cost_price != null)
    form.cost_price = product.unit_cost_price
}

const selectedProductTypeBadgeLabel = computed(() => {
  if (!selectedProductOption.value)
    return 'Tipo indisponível'

  return selectedProductOption.value.type === 'group' ? 'Grupo' : 'Unitário'
})

const formCategoryOptions = computed(() =>
  [...categoriesList.value]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map(c => ({ label: c.name, value: c.name }))
)

function resetForm() {
  Object.assign(form, {
    product_id: null,
    code: generateCode('E'),
    description: '',
    stock_quantity: 0,
    minimum_quantity: 0,
    sale_price: '',
    cost_price: '',
    brand: '',
    category: '',
    supplier_name: null,
    location: '',
    notes: ''
  })
}

function openCreate() {
  selectedPart.value = null
  resetForm()
  showModal.value = true
}

function openEdit(part: PartItem) {
  selectedPart.value = part
  Object.assign(form, {
    product_id: part.product_id ?? null,
    code: part.code ?? '',
    description: part.description ?? '',
    stock_quantity: part.stock_quantity ?? 0,
    minimum_quantity: part.minimum_quantity ?? 0,
    sale_price: part.sale_price ?? '',
    cost_price: part.cost_price ?? '',
    brand: part.brand ?? '',
    category: part.category ?? '',
    supplier_name: part.supplier_name ?? null,
    location: part.location ?? '',
    notes: part.notes ?? ''
  })
  showModal.value = true
}

async function save() {
  if (isSaving.value)
    return

  if (!form.description.trim() || !form.code.trim()) {
    toast.add({
      title: 'Preencha descrição e código da peça',
      color: 'warning'
    })
    return
  }

  isSaving.value = true

  try {
    const body = {
      product_id: form.product_id || null,
      code: form.code.trim(),
      description: form.description.trim(),
      stock_quantity: Number(form.stock_quantity || 0),
      minimum_quantity: Number(form.minimum_quantity || 0),
      sale_price: form.sale_price === '' ? null : Number(form.sale_price),
      cost_price: form.cost_price === '' ? null : Number(form.cost_price),
      brand: form.brand || null,
      category: form.category || null,
      supplier_name: form.supplier_name || null,
      location: form.location || null,
      notes: form.notes || null
    }

    if (selectedPart.value?.id) {
      await $fetch(`/api/parts/${selectedPart.value.id}`, {
        method: 'PUT',
        body
      })
      toast.add({ title: 'Peça atualizada', color: 'success' })
    } else {
      await $fetch('/api/parts', {
        method: 'POST',
        body
      })
      toast.add({ title: 'Peça cadastrada', color: 'success' })
    }

    showModal.value = false
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao salvar peça',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

function requestRemove(part: PartItem) {
  if (isDeleting.value)
    return

  partPendingDeletion.value = part
  showDeleteModal.value = true
}

async function remove(part: PartItem) {
  if (isDeleting.value)
    return

  isDeleting.value = true

  try {
    await $fetch(`/api/parts/${part.id}`, { method: 'DELETE' })
    toast.add({ title: 'Peça removida', color: 'success' })
    showDeleteModal.value = false
    partPendingDeletion.value = null

    if (partItems.value.length === 1 && page.value > 1)
      page.value -= 1

    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao remover peça',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isDeleting.value = false
  }
}

async function confirmRemove() {
  if (!partPendingDeletion.value)
    return

  await remove(partPendingDeletion.value)
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
      selectedIds.value.map(id => $fetch(`/api/parts/${id}`, { method: 'DELETE' }))
    )

    toast.add({
      title: `${selectedIds.value.length} peça(s) removida(s)`,
      color: 'success'
    })

    rowSelection.value = {}
    showBulkDeleteModal.value = false
    await refresh()
  } catch {
    toast.add({
      title: 'Erro ao excluir peças',
      color: 'error'
    })
  } finally {
    isBulkDeleting.value = false
  }
}

async function exportCsv() {
  try {
    const all = await $fetch<PartsResponse>('/api/parts', {
      query: {
        search: debouncedSearch.value || undefined,
        category: categoryFilter.value !== 'all' ? categoryFilter.value : undefined,
        low_stock: stockFilter.value === 'low' ? 'true' : undefined,
        page: 1,
        page_size: 2000,
        sort_by: sorting.value[0]?.id || undefined,
        sort_order: sorting.value[0]?.desc ? 'desc' : 'asc'
      }
    })

    if (!all.items.length) {
      toast.add({ title: 'Nenhuma peça para exportar', color: 'warning' })
      return
    }

    const headers = [
      'descricao',
      'codigo',
      'produto_vinculado',
      'categoria',
      'marca',
      'estoque',
      'estoque_minimo',
      'preco_venda',
      'preco_custo',
      'fornecedor',
      'localizacao'
    ]

    const rows = all.items.map(item => [
      item.description,
      item.code,
      item.products?.name ?? '',
      item.products?.product_categories?.name ?? item.category ?? '',
      item.brand ?? '',
      item.stock_quantity,
      item.minimum_quantity ?? 0,
      item.sale_price ?? '',
      item.cost_price ?? '',
      item.supplier_name ?? '',
      item.location ?? ''
    ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))

    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `estoque_${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch {
    toast.add({ title: 'Erro ao exportar estoque', color: 'error' })
  }
}

const stockFilterOptions = [
  { label: 'Todo o estoque', value: 'all' },
  { label: 'Somente estoque baixo', value: 'low' },
  { label: 'Somente disponíveis', value: 'available' }
]

const lineColumns = [
  { accessorKey: 'description', header: 'Peça', enableSorting: true },
  { accessorKey: 'code', header: 'Código', enableSorting: true },
  { accessorKey: 'location', header: 'Localização', enableSorting: false },
  { accessorKey: 'stock_quantity', header: 'Estoque', enableSorting: true },
  { accessorKey: 'minimum_quantity', header: 'Mínimo', enableSorting: true },
  { accessorKey: 'sale_price', header: 'Venda', enableSorting: true },
  { id: 'status', header: 'Situação', enableSorting: false },
  { id: 'actions', header: 'Ações', enableSorting: false }
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Estoque" />
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar estoque.
        </p>
      </div>

      <div v-else class="space-y-4 p-4">
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <UCard
            v-for="stat in [
              { label: 'Total de peças', value: statsData.total, icon: 'i-lucide-box', color: 'text-primary', description: 'no estoque' },
              { label: 'Sem estoque', value: statsData.outOfStock, icon: 'i-lucide-circle-x', color: 'text-error', description: 'itens zerados' },
              { label: 'Estoque baixo', value: statsData.lowStock, icon: 'i-lucide-triangle-alert', color: 'text-warning', description: 'abaixo do mínimo' },
              { label: 'Disponíveis', value: statsData.available, icon: 'i-lucide-circle-check', color: 'text-success', description: 'acima do mínimo' }
            ]"
            :key="stat.label"
            :ui="{ body: 'p-3 sm:p-4' }"
          >
            <div class="flex items-start gap-3">
              <UIcon :name="stat.icon" :class="stat.color" class="mt-0.5 size-5 shrink-0" />
              <div>
                <p class="text-lg font-bold leading-tight">
                  {{ stat.value }}
                </p>
                <p class="text-xs font-medium text-highlighted">
                  {{ stat.label }}
                </p>
                <p class="text-xs text-muted">
                  {{ stat.description }}
                </p>
              </div>
            </div>
          </UCard>
        </div>

        <AppDataTable
          v-model:display-mode="viewMode"
          v-model:search-term="search"
          v-model:page="page"
          v-model:page-size="pageSize"
          v-model:sorting="sorting"
          v-model:row-selection="rowSelection"
          :columns="lineColumns"
          :data="partItems"
          :loading="status === 'pending'"
          :loading-variant="viewMode === 'card' ? 'card' : 'row'"
          :selectable="viewMode === 'table'"
          :sticky-header="viewMode === 'table'"
          :get-row-id="(row) => String(row.id ?? '')"
          :page-size-options="PAGE_SIZE_OPTIONS"
          :total="totalParts"
          search-placeholder="Buscar por descrição, código ou marca..."
          :show-search="true"
          :show-view-mode-toggle="true"
          card-grid-class="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2"
          empty-icon="i-lucide-box"
          empty-title="Nenhuma peça encontrada"
          empty-description="Cadastre itens de estoque ou ajuste os filtros para continuar."
          @search-submit="submitSearch"
        >
          <template #toolbar-right>
            <UTooltip text="Exportar estoque">
              <UButton
                icon="i-lucide-download"
                color="neutral"
                variant="outline"
                size="sm"
                @click="exportCsv"
              />
            </UTooltip>

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
              label="Categorias"
              icon="i-lucide-tag"
              color="neutral"
              variant="outline"
              size="sm"
              to="/app/products/categories"
            />

            <UButton
              v-if="canCreate"
              label="Nova peça"
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
                  <UFormField label="Categoria">
                    <USelectMenu
                      v-model="categoryFilter"
                      :items="categoryOptions"
                      value-key="value"
                      class="w-full"
                      searchable
                    />
                  </UFormField>
                  <UFormField label="Estoque">
                    <USelectMenu
                      v-model="stockFilter"
                      :items="stockFilterOptions"
                      value-key="value"
                      class="w-full"
                      :search-input="false"
                    />
                  </UFormField>
                </div>
              </template>
            </UPopover>
          </template>

          <template #description-cell="{ row }">
            <div class="min-w-0 space-y-1">
              <p class="truncate font-semibold text-highlighted">
                {{ row.original.description }}
              </p>
              <p class="truncate text-xs text-muted">
                {{ row.original.products?.product_categories?.name || row.original.products?.name || row.original.brand || 'Sem vínculo de catálogo' }}
              </p>
            </div>
          </template>

          <template #location-cell="{ row }">
            <span class="text-sm text-muted">
              {{ row.original.location || '-' }}
            </span>
          </template>

          <template #sale_price-cell="{ row }">
            <span class="text-sm text-muted">
              {{ formatCurrency(row.original.sale_price) }}
            </span>
          </template>

          <template #status-cell="{ row }">
            <UBadge
              :label="getStockStatus(row.original as PartItem).label"
              :color="getStockStatus(row.original as PartItem).color"
              :leading-icon="getStockStatus(row.original as PartItem).icon"
              variant="subtle"
              size="xs"
            />
          </template>

          <template #actions-cell="{ row }">
            <div class="flex items-center justify-end gap-2">
              <UTooltip v-if="canUpdate" text="Editar peça">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="openEdit(row.original as PartItem)"
                />
              </UTooltip>

              <UTooltip v-if="canDelete" text="Excluir peça">
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :loading="isDeleting"
                  @click="requestRemove(row.original as PartItem)"
                />
              </UTooltip>
            </div>
          </template>

          <template #card="{ item: part }">
            <UCard class="border border-default/80 shadow-sm">
              <div class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 space-y-2">
                    <h3 class="truncate text-base font-semibold text-highlighted">
                      {{ part.description }}
                    </h3>
                    <div class="flex flex-wrap items-center gap-2">
                      <UBadge
                        :label="getStockStatus(part as PartItem).label"
                        :color="getStockStatus(part as PartItem).color"
                        :leading-icon="getStockStatus(part as PartItem).icon"
                        variant="subtle"
                        size="xs"
                      />
                      <UBadge
                        :label="part.products?.product_categories?.name || 'Sem categoria do catálogo'"
                        color="neutral"
                        variant="subtle"
                        size="xs"
                      />
                    </div>
                  </div>

                  <div class="flex shrink-0 items-center gap-1">
                    <UTooltip v-if="canUpdate" text="Editar peça">
                      <UButton
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        @click="openEdit(part as PartItem)"
                      />
                    </UTooltip>

                    <UTooltip v-if="canDelete" text="Excluir peça">
                      <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        size="xs"
                        :loading="isDeleting"
                        @click="requestRemove(part as PartItem)"
                      />
                    </UTooltip>
                  </div>
                </div>

                <div class="grid grid-cols-1 gap-2 text-sm text-muted sm:grid-cols-2">
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-scan-barcode" class="size-4 shrink-0" />
                    <span class="truncate">{{ part.code }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-package" class="size-4 shrink-0" />
                    <span class="truncate">{{ part.stock_quantity }} un</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-briefcase-business" class="size-4 shrink-0" />
                    <span class="truncate">{{ part.supplier_name || 'Sem fornecedor' }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-map-pinned" class="size-4 shrink-0" />
                    <span class="truncate">{{ part.location || 'Localização não informada' }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-badge-dollar-sign" class="size-4 shrink-0" />
                    <span class="truncate">{{ formatCurrency(part.sale_price) }}</span>
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
    :title="selectedPart ? 'Editar peça' : 'Nova peça'"
    :ui="{ body: 'overflow-y-auto max-h-[75vh]' }"
  >
    <template #body>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UFormField label="Descrição" required class="sm:col-span-2">
          <UInput
            v-model="form.description"
            class="w-full"
            placeholder="Ex: Pastilha dianteira cerâmica"
          />
        </UFormField>

        <UFormField label="Código" required>
          <UInput v-model="form.code" class="w-full" />
        </UFormField>

        <UFormField label="Produto vinculado">
          <USelectMenu
            v-model="form.product_id"
            :items="productOptions"
            value-key="value"
            class="w-full"
            searchable
            @update:model-value="handleProductSelect(form.product_id)"
          />
        </UFormField>

        <div class="sm:col-span-2 flex flex-wrap items-center gap-2 rounded-lg border border-default bg-elevated/40 px-3 py-2">
          <UBadge
            :label="selectedProductOption?.code || 'Sem produto vinculado'"
            color="neutral"
            variant="subtle"
            size="sm"
          />
          <UBadge
            :label="selectedProductTypeBadgeLabel"
            :color="selectedProductOption ? 'primary' : 'neutral'"
            variant="subtle"
            size="sm"
          />
          <span class="text-xs text-muted">
            Ao vincular um produto, a descrição e os preços podem ser sugeridos automaticamente.
          </span>
        </div>

        <UFormField label="Categoria" class="sm:col-span-2">
          <USelectMenu
            v-model="form.category"
            :items="formCategoryOptions"
            value-key="value"
            placeholder="Selecionar categoria..."
            class="w-full"
            searchable
          />
        </UFormField>

        <UFormField label="Marca">
          <UInput v-model="form.brand" class="w-full" placeholder="Ex: Bosch, Cofap, NGK" />
        </UFormField>

        <UFormField label="Fornecedor">
          <USelectMenu
            v-model="form.supplier_name"
            :items="supplierOptions"
            value-key="value"
            class="w-full"
            searchable
          />
        </UFormField>

        <UFormField label="Localização">
          <UInput
            v-model="form.location"
            class="w-full"
            placeholder="Ex: Prateleira A2, Gaveta C1, Estoque Fundo"
          />
        </UFormField>

        <UFormField label="Estoque atual">
          <UInput
            v-model="form.stock_quantity"
            type="number"
            min="0"
            step="1"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Estoque mínimo">
          <UInput
            v-model="form.minimum_quantity"
            type="number"
            min="0"
            step="1"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Preço de custo">
          <UiCurrencyInput v-model="form.cost_price" />
        </UFormField>

        <UFormField label="Preço de venda">
          <UiCurrencyInput v-model="form.sale_price" />
        </UFormField>

        <UFormField label="Observações" class="sm:col-span-2">
          <UTextarea v-model="form.notes" class="w-full" :rows="3" />
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
    confirm-label="Excluir peça"
    confirm-color="error"
    :loading="isDeleting"
    @confirm="confirmRemove"
    @update:open="
      (value: boolean) => {
        showDeleteModal = value
        if (!value && !isDeleting) partPendingDeletion = null
      }
    "
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir
        <strong class="text-highlighted">
          {{ partPendingDeletion?.description || 'esta peça' }}
        </strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>

  <AppConfirmModal
    v-model:open="showBulkDeleteModal"
    title="Excluir peças selecionadas"
    confirm-label="Excluir todas"
    confirm-color="error"
    :loading="isBulkDeleting"
    @confirm="confirmBulkDelete"
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir
        <strong class="text-highlighted">{{ selectedCount }} peça(s)</strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>
</template>
