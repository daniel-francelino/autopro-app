<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import type { RowSelectionState, SortingState } from '@tanstack/table-core'
import { ActionCode } from '~/constants/action-codes'
import type { ServiceOrder as ServiceOrderFull } from '~/types/service-orders'
import type { BadgeColor, ViewMode } from '~/types/ui'

type Vehicle = {
  id: string
  client_id: string
  license_plate: string | null
  brand: string | null
  model: string | null
  year: number | null
  color: string | null
  engine: string | null
  fuel_type: string | null
  mileage: number | null
  notes: string | null
  clients?: { name: string } | null
}

type ServiceOrder = Pick<ServiceOrderFull, 'id' | 'number' | 'status' | 'entry_date' | 'reported_defect' | 'total_amount'>

type VehiclesResponse = {
  items: Vehicle[]
  total: number
  page: number
  page_size: number
}

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Veículos' })

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const MANAGED_QUERY_KEYS = [
  'search',
  'page',
  'pageSize',
  'view',
  'sortBy',
  'sortOrder'
] as const

const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server
  ? useRequestHeaders(['cookie'])
  : undefined
const route = useRoute()
const router = useRouter()

const canRead = computed(() => workshop.can(ActionCode.VEHICLES_READ))
const canCreate = computed(() => workshop.can(ActionCode.VEHICLES_CREATE))
const canUpdate = computed(() => workshop.can(ActionCode.VEHICLES_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.VEHICLES_DELETE))

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

const search = ref(
  typeof route.query.search === 'string' ? route.query.search : ''
)
const debouncedSearch = ref(search.value)
const page = ref(parsePage(route.query.page))
const pageSize = ref(parsePageSize(route.query.pageSize))
const viewMode = ref<ViewMode>(parseView(route.query.view))

const DEFAULT_SORT = { id: 'brand', desc: false }

const sorting = ref<SortingState>(
  typeof route.query.sortBy === 'string' && route.query.sortBy
    ? [{ id: route.query.sortBy, desc: route.query.sortOrder === 'desc' }]
    : [DEFAULT_SORT]
)

const requestQuery = computed(() => ({
  search: debouncedSearch.value || undefined,
  page: page.value,
  page_size: pageSize.value,
  sort_by: sorting.value[0]?.id || undefined,
  sort_order: sorting.value[0]
    ? sorting.value[0].desc
      ? 'desc'
      : 'asc'
    : undefined
}))

const { data, status, refresh } = await useAsyncData(
  () =>
    `vehicles-${debouncedSearch.value}-${page.value}-${pageSize.value}-${sorting.value[0]?.id}-${sorting.value[0]?.desc}`,
  async () => {
    if (!canRead.value) {
      return {
        items: [],
        total: 0,
        page: 1,
        page_size: pageSize.value
      } satisfies VehiclesResponse
    }

    return requestFetch<VehiclesResponse>('/api/vehicles', {
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

const vehicleItems = computed(() => data.value?.items ?? [])
const totalVehicles = computed(() => data.value?.total ?? 0)
const totalPages = computed(() =>
  Math.max(1, Math.ceil(totalVehicles.value / pageSize.value))
)

function buildManagedQuery() {
  return {
    search: search.value || undefined,
    page: page.value > 1 ? String(page.value) : undefined,
    pageSize:
      pageSize.value !== DEFAULT_PAGE_SIZE ? String(pageSize.value) : undefined,
    view: viewMode.value !== 'table' ? viewMode.value : undefined,
    sortBy: sorting.value[0]?.id || undefined,
    sortOrder: sorting.value[0]?.desc ? 'desc' : undefined
  }
}

async function syncQuery() {
  const nextQuery = Object.fromEntries(
    Object.entries(route.query).filter(
      ([key]) =>
        !MANAGED_QUERY_KEYS.includes(
          key as (typeof MANAGED_QUERY_KEYS)[number]
        )
    )
  ) as Record<string, string | string[] | undefined>

  Object.assign(nextQuery, buildManagedQuery())

  const currentSerialized = JSON.stringify(route.query)
  const nextSerialized = JSON.stringify(nextQuery)
  if (currentSerialized === nextSerialized) return

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
    const nextPage = parsePage(query.page)
    const nextPageSize = parsePageSize(query.pageSize)
    const nextView = parseView(query.view)

    if (search.value !== nextSearch) {
      search.value = nextSearch
      debouncedSearch.value = nextSearch
    }
    if (page.value !== nextPage) page.value = nextPage
    if (pageSize.value !== nextPageSize) pageSize.value = nextPageSize
    if (viewMode.value !== nextView) viewMode.value = nextView

    const nextSortBy = typeof query.sortBy === 'string' ? query.sortBy : ''
    const nextSortDesc = query.sortOrder === 'desc'
    const currentSort = sorting.value[0]
    if (nextSortBy) {
      if (
        !currentSort
        || currentSort.id !== nextSortBy
        || currentSort.desc !== nextSortDesc
      )
        sorting.value = [{ id: nextSortBy, desc: nextSortDesc }]
    } else if (
      !currentSort
      || currentSort.id !== DEFAULT_SORT.id
      || currentSort.desc !== DEFAULT_SORT.desc
    ) {
      sorting.value = [DEFAULT_SORT]
    }
  }
)

watchDebounced(
  search,
  async (val) => {
    debouncedSearch.value = val
    page.value = 1
    await syncQuery()
  },
  { debounce: 300, maxWait: 800 }
)

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

// ─── Row selection ────────────────────────────────────────────────────────────

const rowSelection = ref<RowSelectionState>({})
const selectedIds = computed(() =>
  Object.entries(rowSelection.value)
    .filter(([, selected]) => selected)
    .map(([id]) => id)
)
const selectedCount = computed(() => selectedIds.value.length)

// ─── Bulk delete ───────────────────────────────────────────────────────────────

const showBulkDeleteModal = ref(false)
const isBulkDeleting = ref(false)

async function confirmBulkDelete() {
  if (!selectedIds.value.length || isBulkDeleting.value) return
  isBulkDeleting.value = true
  try {
    await Promise.all(
      selectedIds.value.map(id =>
        $fetch(`/api/vehicles/${id}`, { method: 'DELETE' })
      )
    )
    toast.add({
      title: `${selectedIds.value.length} veículo(s) removido(s)`,
      color: 'success'
    })
    rowSelection.value = {}
    showBulkDeleteModal.value = false
    await refresh()
  } catch {
    toast.add({ title: 'Erro ao excluir veículos', color: 'error' })
  } finally {
    isBulkDeleting.value = false
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getVehicleTitle(vehicle: Vehicle): string {
  return [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Veículo'
}

const fuelTypeOptions = [
  { label: 'Gasolina', value: 'gasoline' },
  { label: 'Etanol', value: 'ethanol' },
  { label: 'Flex', value: 'flex' },
  { label: 'Diesel', value: 'diesel' },
  { label: 'GNV', value: 'cng' },
  { label: 'Elétrico', value: 'electric' },
  { label: 'Híbrido', value: 'hybrid' }
]

function fuelLabel(value: string | null | undefined): string {
  return fuelTypeOptions.find(o => o.value === value)?.label ?? value ?? '—'
}

const statusColorMap: Record<string, BadgeColor> = {
  estimate: 'neutral',
  open: 'info',
  in_progress: 'warning',
  waiting_for_part: 'warning',
  delivered: 'success',
  cancelled: 'error'
}

const statusLabelMap: Record<string, string> = {
  estimate: 'Orçamento',
  open: 'Aberta',
  in_progress: 'Em andamento',
  waiting_for_part: 'Aguardando peça',
  delivered: 'Entregue',
  cancelled: 'Cancelada'
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('pt-BR')
}

// ─── Modal (create / edit) ─────────────────────────────────────────────────────

const showFormModal = ref(false)
const editingVehicle = ref<Vehicle | null>(null)

function openCreate() {
  editingVehicle.value = null
  showFormModal.value = true
}

function openEdit(v: Vehicle) {
  editingVehicle.value = v
  showFormModal.value = true
}

// ─── Delete ────────────────────────────────────────────────────────────────────

const isDeleting = ref(false)
const showDeleteModal = ref(false)
const vehiclePendingDeletion = ref<Vehicle | null>(null)

function requestRemove(v: Vehicle) {
  if (isDeleting.value) return
  vehiclePendingDeletion.value = v
  showDeleteModal.value = true
}

async function confirmRemove() {
  if (!vehiclePendingDeletion.value) return
  const v = vehiclePendingDeletion.value

  if (isDeleting.value) return
  isDeleting.value = true
  try {
    await $fetch(`/api/vehicles/${v.id}`, { method: 'DELETE' })
    toast.add({ title: 'Veículo removido', color: 'success' })
    showDeleteModal.value = false
    vehiclePendingDeletion.value = null

    if (vehicleItems.value.length === 1 && page.value > 1) page.value -= 1

    await refresh()
  } catch (error: unknown) {
    const err = error as {
      data?: { statusMessage?: string }
      statusMessage?: string
    }
    toast.add({
      title: 'Erro',
      description:
        err?.data?.statusMessage
        || err?.statusMessage
        || 'Não foi possível remover.',
      color: 'error'
    })
  } finally {
    isDeleting.value = false
  }
}

// ─── Slideover de detalhes ─────────────────────────────────────────────────────

const showDetails = ref(false)
const selectedVehicle = ref<Vehicle | null>(null)
const vehicleOrders = ref<ServiceOrder[]>([])
const isLoadingOrders = ref(false)

async function openDetails(v: Vehicle) {
  selectedVehicle.value = v
  showDetails.value = true
  vehicleOrders.value = []
  isLoadingOrders.value = true
  try {
    const result = await $fetch<{
      data: { items: ServiceOrder[] }
    }>('/api/service-orders', {
      query: { vehicleId: v.id, limit: 50 }
    })
    vehicleOrders.value = result.data.items
  } catch {
    vehicleOrders.value = []
  } finally {
    isLoadingOrders.value = false
  }
}

// ─── Table columns ─────────────────────────────────────────────────────────────

const lineColumns = [
  { accessorKey: 'brand', header: 'Veículo', enableSorting: true },
  { accessorKey: 'license_plate', header: 'Placa', enableSorting: true },
  { accessorKey: 'engine', header: 'Motor', enableSorting: false },
  { id: 'client', header: 'Cliente', enableSorting: false },
  { id: 'actions', header: 'Ações', enableSorting: false }
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Veículos" />
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar veículos.
        </p>
      </div>

      <div v-else class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div class="flex min-h-0 flex-1 flex-col p-0">
          <AppDataTable
            v-model:display-mode="viewMode"
            v-model:search-term="search"
            v-model:page="page"
            v-model:page-size="pageSize"
            v-model:sorting="sorting"
            v-model:row-selection="rowSelection"
            :columns="lineColumns"
            :data="vehicleItems"
            :loading-variant="viewMode === 'card' ? 'card' : 'row'"
            :selectable="viewMode === 'table'"
            :sticky-header="viewMode === 'table'"
            :get-row-id="(row) => String(row.id ?? '')"
            :loading="status === 'pending'"
            :page-size-options="PAGE_SIZE_OPTIONS"
            :total="totalVehicles"
            search-placeholder="Buscar por placa, marca, modelo ou motor..."
            :show-search="true"
            :show-view-mode-toggle="true"
            card-grid-class="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2"
            empty-icon="i-lucide-car"
            empty-title="Nenhum veículo encontrado"
            empty-description="Cadastre um veículo ou ajuste os filtros para continuar."
            @search-submit="submitSearch"
          >
            <!-- Toolbar direita -->
            <template #toolbar-right>
              <UTooltip
                v-if="canDelete"
                :text="
                  selectedCount > 0
                    ? `Excluir ${selectedCount} selecionado(s)`
                    : 'Excluir seleção'
                "
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
                label="Novo veículo"
                icon="i-lucide-plus"
                size="sm"
                @click="openCreate"
              />
            </template>

            <!-- Coluna Veículo -->
            <template #brand-cell="{ row }">
              <div class="flex items-center gap-3">
                <div
                  class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/12 text-sm font-semibold text-primary"
                >
                  <UIcon name="i-lucide-car" class="size-5" />
                </div>
                <div class="min-w-0">
                  <p class="truncate font-semibold text-highlighted">
                    {{ getVehicleTitle(row.original as Vehicle) }}
                    <span
                      v-if="row.original.year"
                      class="font-normal text-muted"
                    >
                      ({{ row.original.year }})
                    </span>
                  </p>
                  <p class="truncate text-xs text-muted">
                    {{ row.original.color || "-" }}
                  </p>
                </div>
              </div>
            </template>

            <!-- Coluna Placa -->
            <template #license_plate-cell="{ row }">
              <span class="font-mono text-sm font-semibold text-highlighted">
                {{ row.original.license_plate || "-" }}
              </span>
            </template>

            <!-- Coluna Motor -->
            <template #engine-cell="{ row }">
              <span
                v-if="row.original.engine"
                class="text-sm font-medium text-primary"
              >
                {{ row.original.engine }}
              </span>
              <span v-else class="text-sm text-muted">—</span>
            </template>

            <!-- Coluna Cliente -->
            <template #client-cell="{ row }">
              <div class="flex items-center gap-1.5 text-sm text-muted">
                <UIcon name="i-lucide-user" class="size-3.5 shrink-0" />
                <span class="truncate">
                  {{ (row.original as Vehicle).clients?.name ?? "—" }}
                </span>
              </div>
            </template>

            <!-- Coluna Ações -->
            <template #actions-cell="{ row }">
              <div class="flex items-center justify-end gap-2">
                <UButton
                  icon="i-lucide-eye"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="openDetails(row.original as Vehicle)"
                />
                <UButton
                  v-if="canUpdate"
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="openEdit(row.original as Vehicle)"
                />
                <UButton
                  v-if="canDelete"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :loading="isDeleting"
                  @click="requestRemove(row.original as Vehicle)"
                />
              </div>
            </template>

            <!-- Card view -->
            <template #card="{ item: vehicle }">
              <UCard
                class="cursor-pointer border border-default/80 shadow-sm transition-colors hover:bg-elevated"
                @click="openDetails(vehicle as Vehicle)"
              >
                <div class="flex items-start gap-4">
                  <div
                    class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary"
                  >
                    <UIcon name="i-lucide-car" class="size-6" />
                  </div>

                  <div class="min-w-0 flex-1 space-y-3">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0 space-y-1">
                        <h3
                          class="truncate text-base font-semibold text-highlighted"
                        >
                          {{ getVehicleTitle(vehicle as Vehicle) }}
                          <span
                            v-if="(vehicle as Vehicle).year"
                            class="font-normal text-muted"
                          >
                            ({{ (vehicle as Vehicle).year }})
                          </span>
                        </h3>
                        <span
                          class="font-mono text-sm font-semibold text-default"
                        >
                          {{
                            (vehicle as Vehicle).license_plate || "-"
                          }}
                        </span>
                      </div>

                      <div class="flex shrink-0 items-center gap-1" @click.stop>
                        <UTooltip text="Ver detalhes">
                          <UButton
                            icon="i-lucide-eye"
                            color="neutral"
                            variant="ghost"
                            size="xs"
                            @click="openDetails(vehicle as Vehicle)"
                          />
                        </UTooltip>
                        <UTooltip v-if="canUpdate" text="Editar veículo">
                          <UButton
                            icon="i-lucide-pencil"
                            color="neutral"
                            variant="ghost"
                            size="xs"
                            @click="openEdit(vehicle as Vehicle)"
                          />
                        </UTooltip>
                        <UTooltip v-if="canDelete" text="Excluir veículo">
                          <UButton
                            icon="i-lucide-trash-2"
                            color="error"
                            variant="ghost"
                            size="xs"
                            :loading="isDeleting"
                            @click="requestRemove(vehicle as Vehicle)"
                          />
                        </UTooltip>
                      </div>
                    </div>

                    <div
                      class="grid grid-cols-1 gap-2 text-sm text-muted sm:grid-cols-2"
                    >
                      <div
                        v-if="(vehicle as Vehicle).engine"
                        class="flex items-center gap-2"
                      >
                        <UIcon
                          name="i-lucide-settings-2"
                          class="size-4 shrink-0"
                        />
                        <span class="truncate font-medium text-primary">
                          Motor: {{ (vehicle as Vehicle).engine }}
                        </span>
                      </div>
                      <div class="flex items-center gap-2">
                        <UIcon name="i-lucide-user" class="size-4 shrink-0" />
                        <span class="truncate">
                          {{
                            (vehicle as Vehicle).clients?.name
                              ?? "Cliente não informado"
                          }}
                        </span>
                      </div>
                      <div
                        v-if="(vehicle as Vehicle).fuel_type"
                        class="flex items-center gap-2"
                      >
                        <UIcon name="i-lucide-fuel" class="size-4 shrink-0" />
                        <span class="truncate">
                          {{ fuelLabel((vehicle as Vehicle).fuel_type) }}
                        </span>
                      </div>
                      <div
                        v-if="(vehicle as Vehicle).color"
                        class="flex items-center gap-2"
                      >
                        <UIcon
                          name="i-lucide-palette"
                          class="size-4 shrink-0"
                        />
                        <span class="truncate">
                          {{ (vehicle as Vehicle).color }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </UCard>
            </template>
          </AppDataTable>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <!-- FormModal -->
  <VehiclesFormModal
    v-model:open="showFormModal"
    :vehicle="editingVehicle"
    @saved="refresh"
  />

  <!-- Confirm bulk delete -->
  <AppConfirmModal
    v-model:open="showBulkDeleteModal"
    title="Confirmar exclusão em massa"
    confirm-label="Excluir veículos"
    confirm-color="error"
    :loading="isBulkDeleting"
    @confirm="confirmBulkDelete"
    @update:open="
      (v) => {
        showBulkDeleteModal = v;
      }
    "
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir
        <strong class="text-highlighted">{{ selectedCount }} veículo(s)</strong>? Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>

  <!-- Confirm single delete -->
  <AppConfirmModal
    v-model:open="showDeleteModal"
    title="Confirmar exclusão"
    confirm-label="Excluir veículo"
    confirm-color="error"
    :loading="isDeleting"
    @confirm="confirmRemove"
    @update:open="
      (value) => {
        showDeleteModal = value;
        if (!value && !isDeleting) vehiclePendingDeletion = null;
      }
    "
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir
        <strong class="text-highlighted">
          {{
            vehiclePendingDeletion
              ? getVehicleTitle(vehiclePendingDeletion)
                + (vehiclePendingDeletion.license_plate
                  ? ` (${vehiclePendingDeletion.license_plate})`
                  : "")
              : "este veículo"
          }} </strong>? Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>

  <!-- Slideover de detalhes -->
  <USlideover
    v-model:open="showDetails"
    side="right"
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #header>
      <div
        v-if="selectedVehicle"
        class="flex min-w-0 flex-1 items-start justify-between gap-2"
      >
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-highlighted">
            {{ getVehicleTitle(selectedVehicle) }}
          </h2>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <UBadge
              :label="selectedVehicle.license_plate || '-'"
              color="neutral"
              variant="subtle"
            />
            <UBadge
              v-if="selectedVehicle.engine"
              :label="selectedVehicle.engine"
              color="primary"
              variant="subtle"
            />
          </div>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="showDetails = false"
        />
      </div>
    </template>

    <template #body>
      <div v-if="selectedVehicle" class="space-y-6 p-4">
        <!-- Ficha do veículo -->
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p class="text-muted">
              Ano
            </p>
            <p class="font-medium text-highlighted">
              {{ selectedVehicle.year ?? "—" }}
            </p>
          </div>
          <div>
            <p class="text-muted">
              Cor
            </p>
            <p class="font-medium text-highlighted">
              {{ selectedVehicle.color ?? "—" }}
            </p>
          </div>
          <div>
            <p class="text-muted">
              Motor
            </p>
            <p class="font-medium text-primary">
              {{ selectedVehicle.engine ?? "—" }}
            </p>
          </div>
          <div>
            <p class="text-muted">
              Combustível
            </p>
            <p class="font-medium text-highlighted">
              {{ fuelLabel(selectedVehicle.fuel_type) }}
            </p>
          </div>
          <div>
            <p class="text-muted">
              Quilometragem
            </p>
            <p class="font-medium text-highlighted">
              {{
                selectedVehicle.mileage
                  ? `${selectedVehicle.mileage.toLocaleString("pt-BR")} km`
                  : "—"
              }}
            </p>
          </div>
          <div>
            <p class="text-muted">
              Proprietário
            </p>
            <p class="font-semibold text-orange-500">
              {{ selectedVehicle.clients?.name ?? "—" }}
            </p>
          </div>
        </div>

        <USeparator />

        <!-- Histórico de Manutenção -->
        <div>
          <h3
            class="mb-4 flex items-center gap-2 font-semibold text-highlighted"
          >
            <UIcon name="i-lucide-wrench" class="size-4" />
            Histórico de Manutenção
            <span v-if="!isLoadingOrders" class="text-muted">
              ({{ vehicleOrders.length }})
            </span>
          </h3>

          <div v-if="isLoadingOrders" class="space-y-3">
            <USkeleton v-for="i in 3" :key="i" class="h-20 w-full" />
          </div>

          <div
            v-else-if="vehicleOrders.length === 0"
            class="py-8 text-center text-sm text-muted"
          >
            Nenhum registro de manutenção para este veículo.
          </div>

          <div v-else class="relative pl-5">
            <div class="absolute bottom-0 left-1.5 top-0 w-px bg-border" />
            <div class="space-y-6">
              <div
                v-for="order in vehicleOrders"
                :key="order.id"
                class="relative"
              >
                <div
                  class="absolute -left-3.5 top-1 h-3 w-3 rounded-full border-2 border-background bg-primary"
                />
                <div class="space-y-2 rounded-lg bg-elevated p-3 text-sm">
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-highlighted">
                      OS #{{ order.number }}
                    </span>
                    <UBadge
                      :color="statusColorMap[order.status] ?? 'neutral'"
                      :label="statusLabelMap[order.status] ?? order.status"
                      variant="subtle"
                      size="xs"
                    />
                  </div>
                  <p class="text-xs text-muted">
                    {{ formatDate(order.entry_date) }}
                  </p>
                  <p v-if="order.reported_defect" class="text-muted">
                    {{ order.reported_defect }}
                  </p>
                  <p class="text-right font-semibold text-success">
                    R$
                    {{
                      order.total_amount?.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2
                      }) ?? "0,00"
                    }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </USlideover>
</template>
