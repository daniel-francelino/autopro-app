<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import type { RowSelectionState, SortingState } from '@tanstack/table-core'
import { ActionCode } from '~/constants/action-codes'
import type { ProductItem, ProductsResponse } from '~/types/products'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Produtos' })

type ViewMode = 'table' | 'card'
type ProductTypeFilter = 'all' | 'unit' | 'group'
type InventoryFilter = 'all' | 'tracked' | 'not_tracked'

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const MANAGED_QUERY_KEYS = [
  'search',
  'type',
  'inventory',
  'category',
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

const canRead = computed(() => workshop.can(ActionCode.PRODUCTS_READ))
const canCreate = computed(() => workshop.can(ActionCode.PRODUCTS_CREATE))
const canUpdate = computed(() => workshop.can(ActionCode.PRODUCTS_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.PRODUCTS_DELETE))

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

function parseProductType(value: unknown): ProductTypeFilter {
  return value === 'unit' || value === 'group' ? value : 'all'
}

function parseInventoryFilter(value: unknown): InventoryFilter {
  return value === 'tracked' || value === 'not_tracked' ? value : 'all'
}

const search = ref(typeof route.query.search === 'string' ? route.query.search : '')
const debouncedSearch = ref(search.value)
const typeFilter = ref<ProductTypeFilter>(parseProductType(route.query.type))
const inventoryFilter = ref<InventoryFilter>(parseInventoryFilter(route.query.inventory))
const categoryFilter = ref(typeof route.query.category === 'string' ? route.query.category : 'all')
const page = ref(parsePage(route.query.page))
const pageSize = ref(parsePageSize(route.query.pageSize))
const viewMode = ref<ViewMode>(parseView(route.query.view))

const DEFAULT_SORT = { id: 'code', desc: true }
const sorting = ref<SortingState>(
  typeof route.query.sortBy === 'string' && route.query.sortBy
    ? [{ id: route.query.sortBy, desc: route.query.sortOrder === 'desc' }]
    : [DEFAULT_SORT]
)

const requestQuery = computed(() => ({
  search: debouncedSearch.value || undefined,
  type: typeFilter.value !== 'all' ? typeFilter.value : undefined,
  track_inventory:
    inventoryFilter.value === 'tracked'
      ? 'true'
      : inventoryFilter.value === 'not_tracked'
        ? 'false'
        : undefined,
  category_id: categoryFilter.value !== 'all' ? categoryFilter.value : undefined,
  page: page.value,
  page_size: pageSize.value,
  sort_by: sorting.value[0]?.id || undefined,
  sort_order: sorting.value[0]?.desc ? 'desc' : 'asc'
}))

const { data, status, refresh } = await useAsyncData(
  () =>
    `products-${debouncedSearch.value}-${typeFilter.value}-${inventoryFilter.value}-${categoryFilter.value}-${page.value}-${pageSize.value}-${sorting.value[0]?.id}-${sorting.value[0]?.desc}`,
  async () => {
    if (!canRead.value) {
      return {
        items: [],
        total: 0,
        page: 1,
        page_size: pageSize.value
      } satisfies ProductsResponse
    }

    return requestFetch<ProductsResponse>('/api/products', {
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

const { data: categoriesData } = await useAsyncData(
  'products-categories-options',
  () =>
    requestFetch<{ items: import('~/types/products').ProductCategory[] }>('/api/product-categories', {
      headers: requestHeaders
    }),
  { default: () => ({ items: [] }) }
)

const productItems = computed(() => data.value?.items ?? [])
const totalProducts = computed(() => data.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalProducts.value / pageSize.value)))
const categoriesList = computed(() => categoriesData.value?.items ?? [])

function buildManagedQuery() {
  return {
    search: search.value || undefined,
    type: typeFilter.value !== 'all' ? typeFilter.value : undefined,
    inventory: inventoryFilter.value !== 'all' ? inventoryFilter.value : undefined,
    category: categoryFilter.value !== 'all' ? categoryFilter.value : undefined,
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
    const nextType = parseProductType(query.type)
    const nextInventory = parseInventoryFilter(query.inventory)
    const nextCategory = typeof query.category === 'string' ? query.category : 'all'
    const nextPage = parsePage(query.page)
    const nextPageSize = parsePageSize(query.pageSize)
    const nextView = parseView(query.view)

    if (search.value !== nextSearch) {
      search.value = nextSearch
      debouncedSearch.value = nextSearch
    }

    if (typeFilter.value !== nextType) typeFilter.value = nextType
    if (inventoryFilter.value !== nextInventory) inventoryFilter.value = nextInventory
    if (categoryFilter.value !== nextCategory) categoryFilter.value = nextCategory
    if (page.value !== nextPage) page.value = nextPage
    if (pageSize.value !== nextPageSize) pageSize.value = nextPageSize
    if (viewMode.value !== nextView) viewMode.value = nextView

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

watch(typeFilter, async () => {
  page.value = 1
  await syncQuery()
})

watch(inventoryFilter, async () => {
  page.value = 1
  await syncQuery()
})

watch(categoryFilter, async () => {
  page.value = 1
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

watch(page, async () => {
  if (page.value > totalPages.value && totalPages.value > 0)
    page.value = totalPages.value
  await syncQuery()
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number | null) {
  if (value == null) return '-'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function getProductTypeLabel(type: ProductItem['type']) {
  return type === 'group' ? 'Grupo' : 'Unitário'
}

function getStockSummary(product: ProductItem) {
  if (product.type === 'group') return '-'
  if (!product.track_inventory) return '-'
  return `${product.initial_stock_quantity ?? 0} un`
}

function getTotalCost(product: ProductItem): number | null {
  if (product.type === 'group') {
    return (product.group_items ?? []).reduce(
      (acc, item) => acc + (item.cost_price ?? 0) * (item.quantity ?? 0),
      0
    )
  }
  return product.unit_cost_price
}

function getTotalSale(product: ProductItem): number | null {
  if (product.type === 'group') {
    return (product.group_items ?? []).reduce(
      (acc, item) => acc + (item.sale_price ?? 0) * (item.quantity ?? 0),
      0
    )
  }
  return product.unit_sale_price
}

// ── Product modal ─────────────────────────────────────────────────────────────

const showProductModal = ref(false)
const editingProduct = ref<ProductItem | null>(null)
const cloneFromProduct = ref<ProductItem | null>(null)

function openCreate() {
  editingProduct.value = null
  cloneFromProduct.value = null
  showProductModal.value = true
}

function openEdit(product: ProductItem) {
  editingProduct.value = product
  cloneFromProduct.value = null
  showProductModal.value = true
}

function openClone(product: ProductItem) {
  editingProduct.value = null
  cloneFromProduct.value = product
  showProductModal.value = true
}

async function onProductSaved() {
  await refresh()
}

// ── Delete ────────────────────────────────────────────────────────────────────

const isDeleting = ref(false)
const showDeleteModal = ref(false)
const productPendingDeletion = ref<ProductItem | null>(null)

function requestRemove(product: ProductItem) {
  if (isDeleting.value) return
  productPendingDeletion.value = product
  showDeleteModal.value = true
}

async function confirmRemove() {
  if (!productPendingDeletion.value || isDeleting.value) return
  isDeleting.value = true

  try {
    await $fetch(`/api/products/${productPendingDeletion.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Produto removido', color: 'success' })
    showDeleteModal.value = false
    productPendingDeletion.value = null

    if (productItems.value.length === 1 && page.value > 1) page.value -= 1
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao remover produto',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isDeleting.value = false
  }
}

// ── Bulk delete ───────────────────────────────────────────────────────────────

const rowSelection = ref<RowSelectionState>({})
const selectedIds = computed(() =>
  Object.entries(rowSelection.value)
    .filter(([, value]) => value)
    .map(([id]) => id)
)
const selectedCount = computed(() => selectedIds.value.length)
const showBulkDeleteModal = ref(false)
const isBulkDeleting = ref(false)

watch(viewMode, () => {
  rowSelection.value = {}
})

async function confirmBulkDelete() {
  if (!selectedIds.value.length || isBulkDeleting.value) return
  isBulkDeleting.value = true

  try {
    await Promise.all(selectedIds.value.map(id => $fetch(`/api/products/${id}`, { method: 'DELETE' })))
    toast.add({ title: `${selectedIds.value.length} produto(s) removido(s)`, color: 'success' })
    rowSelection.value = {}
    showBulkDeleteModal.value = false
    await refresh()
  } catch {
    toast.add({ title: 'Erro ao excluir produtos', color: 'error' })
  } finally {
    isBulkDeleting.value = false
  }
}

// ── Import modal ──────────────────────────────────────────────────────────────

const showImportModal = ref(false)

// ── Export CSV ────────────────────────────────────────────────────────────────

async function exportCsv() {
  try {
    const all = await $fetch<ProductsResponse>('/api/products', {
      query: {
        search: debouncedSearch.value || undefined,
        type: typeFilter.value !== 'all' ? typeFilter.value : undefined,
        track_inventory:
          inventoryFilter.value === 'tracked'
            ? 'true'
            : inventoryFilter.value === 'not_tracked'
              ? 'false'
              : undefined,
        category_id: categoryFilter.value !== 'all' ? categoryFilter.value : undefined,
        page: 1,
        page_size: 2000,
        sort_by: sorting.value[0]?.id || undefined,
        sort_order: sorting.value[0]?.desc ? 'desc' : 'asc'
      }
    })

    if (!all.items.length) {
      toast.add({ title: 'Nenhum produto para exportar', color: 'warning' })
      return
    }

    const headers = ['nome', 'codigo', 'tipo', 'categoria', 'controla_estoque', 'estoque_inicial', 'preco_venda', 'preco_custo', 'observacoes']
    const rows = all.items.map(item =>
      [
        item.name,
        item.code,
        item.type,
        item.product_categories?.name ?? '',
        item.track_inventory ? 'sim' : 'nao',
        item.initial_stock_quantity ?? 0,
        item.unit_sale_price ?? '',
        item.unit_cost_price ?? '',
        item.notes ?? ''
      ]
        .map(value => `"${String(value).replace(/"/g, '""')}"`)
        .join(',')
    )

    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `produtos_${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch {
    toast.add({ title: 'Erro ao exportar produtos', color: 'error' })
  }
}

// ── Table columns ─────────────────────────────────────────────────────────────

const lineColumns = [
  { accessorKey: 'name', header: 'Produto', enableSorting: true },
  { accessorKey: 'code', header: 'Código', enableSorting: true },
  { accessorKey: 'type', header: 'Tipo', enableSorting: false },
  { accessorKey: 'track_inventory', header: 'Estoque', enableSorting: false },
  { id: 'cost', header: 'Custo Total', enableSorting: false },
  { id: 'sale', header: 'Venda Total', enableSorting: false },
  { id: 'actions', header: 'Ações', enableSorting: false }
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Produtos" />
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar produtos.
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
          :data="productItems"
          :loading="status === 'pending'"
          :loading-variant="viewMode === 'card' ? 'card' : 'row'"
          :selectable="viewMode === 'table'"
          :sticky-header="viewMode === 'table'"
          :get-row-id="(row) => String(row.id ?? '')"
          :page-size-options="PAGE_SIZE_OPTIONS"
          :total="totalProducts"
          search-placeholder="Buscar por nome ou código..."
          :show-search="true"
          :show-view-mode-toggle="true"
          card-grid-class="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2"
          empty-icon="i-lucide-package-search"
          empty-title="Nenhum produto encontrado"
          empty-description="Cadastre um produto ou ajuste os filtros para continuar."
          @search-submit="submitSearch"
        >
          <template #toolbar-right>
            <UTooltip text="Exportar produtos">
              <UButton
                icon="i-lucide-download"
                color="neutral"
                variant="outline"
                size="sm"
                @click="exportCsv"
              />
            </UTooltip>

            <UTooltip text="Importar produtos">
              <UButton
                v-if="canCreate"
                icon="i-lucide-upload"
                color="neutral"
                variant="outline"
                size="sm"
                @click="showImportModal = true"
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
              icon="i-lucide-tags"
              color="neutral"
              variant="outline"
              size="sm"
              to="/app/products/categories"
            />

            <UButton
              v-if="canCreate"
              label="Novo produto"
              icon="i-lucide-plus"
              size="sm"
              @click="openCreate"
            />
          </template>

          <template #filters>
            <ProductsFilters
              v-model:type-filter="typeFilter"
              v-model:inventory-filter="inventoryFilter"
              v-model:category-filter="categoryFilter"
              :categories="categoriesList"
            />
          </template>

          <template #name-cell="{ row }">
            <div class="min-w-0 space-y-1">
              <p class="truncate font-semibold text-highlighted">
                {{ row.original.name }}
              </p>
              <p class="truncate text-xs text-muted">
                {{ (row.original as ProductItem).product_categories?.name || 'Sem categoria' }}
              </p>
            </div>
          </template>

          <template #type-cell="{ row }">
            <div class="flex items-center gap-1.5">
              <UBadge
                :label="getProductTypeLabel((row.original as ProductItem).type)"
                color="neutral"
                variant="subtle"
                size="xs"
              />
              <UBadge
                v-if="(row.original as ProductItem).type === 'group' && ((row.original as ProductItem).group_items?.length ?? 0) > 1"
                :label="`${(row.original as ProductItem).group_items!.length} itens`"
                color="info"
                variant="subtle"
                size="xs"
              />
            </div>
          </template>

          <template #track_inventory-cell="{ row }">
            <span class="text-sm text-muted">
              {{ getStockSummary(row.original as ProductItem) }}
            </span>
          </template>

          <template #cost-cell="{ row }">
            <span class="text-sm text-muted">
              {{ formatCurrency(getTotalCost(row.original as ProductItem)) }}
            </span>
          </template>

          <template #sale-cell="{ row }">
            <span class="text-sm font-medium text-highlighted">
              {{ formatCurrency(getTotalSale(row.original as ProductItem)) }}
            </span>
          </template>

          <template #actions-cell="{ row }">
            <div class="flex items-center justify-end gap-2">
              <UTooltip v-if="canCreate" text="Clonar produto">
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="openClone(row.original as ProductItem)"
                />
              </UTooltip>

              <UTooltip v-if="canUpdate" text="Editar produto">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="openEdit(row.original as ProductItem)"
                />
              </UTooltip>

              <UTooltip v-if="canDelete" text="Excluir produto">
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :loading="isDeleting"
                  @click="requestRemove(row.original as ProductItem)"
                />
              </UTooltip>
            </div>
          </template>

          <template #card="{ item: product }">
            <ProductsCard
              :product="product as ProductItem"
              :can-create="canCreate"
              :can-update="canUpdate"
              :can-delete="canDelete"
              :is-deleting="isDeleting"
              @clone="openClone"
              @edit="openEdit"
              @delete="requestRemove"
            />
          </template>
        </AppDataTable>
      </div>
    </template>
  </UDashboardPanel>

  <ProductsFormModal
    v-model:open="showProductModal"
    :product="editingProduct"
    :clone-from="cloneFromProduct"
    :categories="categoriesList"
    @saved="onProductSaved"
  />

  <AppConfirmModal
    v-model:open="showDeleteModal"
    title="Confirmar exclusão"
    confirm-label="Excluir produto"
    confirm-color="error"
    :loading="isDeleting"
    @confirm="confirmRemove"
    @update:open="
      (value: boolean) => {
        showDeleteModal = value
        if (!value && !isDeleting) productPendingDeletion = null
      }
    "
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir
        <strong class="text-highlighted">{{ productPendingDeletion?.name || 'este produto' }}</strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>

  <AppConfirmModal
    v-model:open="showBulkDeleteModal"
    title="Excluir produtos selecionados"
    confirm-label="Excluir todos"
    confirm-color="error"
    :loading="isBulkDeleting"
    @confirm="confirmBulkDelete"
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir
        <strong class="text-highlighted">{{ selectedCount }} produto(s)</strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>

  <ProductsImportModal
    v-model:open="showImportModal"
    @imported="refresh"
  />
</template>
