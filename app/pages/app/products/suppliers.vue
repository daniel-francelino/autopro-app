<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import type { RowSelectionState, SortingState } from '@tanstack/table-core'
import { ActionCode } from '~/constants/action-codes'
import type { ViewMode } from '~/types/ui'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Fornecedores' })

type SupplierPersonType = 'all' | 'pf' | 'pj'
type SupplierStatusFilter = 'all' | 'active' | 'inactive'

type SupplierItem = {
  id: string
  name: string
  person_type: 'pf' | 'pj'
  trade_name: string | null
  tax_id: string | null
  phone: string
  whatsapp: string | null
  email: string | null
  website: string | null
  zip_code: string | null
  street: string | null
  address_number: string | null
  address_complement: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  category: string | null
  is_active: boolean
  notes: string | null
  contact_name: string | null
  contact_role: string | null
  contact_phone: string | null
  contact_email: string | null
  payment_term_days: number | null
  credit_limit: number | null
}

type SuppliersResponse = {
  items: SupplierItem[]
  total: number
  page: number
  page_size: number
}

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const MANAGED_QUERY_KEYS = [
  'search',
  'personType',
  'status',
  'page',
  'pageSize',
  'view',
  'sortBy',
  'sortOrder'
] as const

const SUPPLIER_CATEGORY_OPTIONS = [
  { label: 'Sem categoria', value: null },
  { label: 'Autopeças', value: 'auto_parts' },
  { label: 'Ferramentas', value: 'tools' },
  { label: 'Equipamentos', value: 'equipment' },
  { label: 'Serviços', value: 'services' },
  { label: 'Consumíveis', value: 'consumables' },
  { label: 'Outros', value: 'other' }
]

const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const route = useRoute()
const router = useRouter()

const canRead = computed(() => workshop.can(ActionCode.SUPPLIERS_READ))
const canCreate = computed(() => workshop.can(ActionCode.SUPPLIERS_CREATE))
const canUpdate = computed(() => workshop.can(ActionCode.SUPPLIERS_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.SUPPLIERS_DELETE))

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

function parsePersonType(value: unknown): SupplierPersonType {
  return value === 'pf' || value === 'pj' ? value : 'all'
}

function parseStatus(value: unknown): SupplierStatusFilter {
  return value === 'active' || value === 'inactive' ? value : 'all'
}

const search = ref(typeof route.query.search === 'string' ? route.query.search : '')
const debouncedSearch = ref(search.value)
const personTypeFilter = ref<SupplierPersonType>(parsePersonType(route.query.personType))
const statusFilter = ref<SupplierStatusFilter>(parseStatus(route.query.status))
const page = ref(parsePage(route.query.page))
const pageSize = ref(parsePageSize(route.query.pageSize))
const viewMode = ref<ViewMode>(parseView(route.query.view))

const DEFAULT_SORT = { id: 'name', desc: false }
const sorting = ref<SortingState>(
  typeof route.query.sortBy === 'string' && route.query.sortBy
    ? [{ id: route.query.sortBy, desc: route.query.sortOrder === 'desc' }]
    : [DEFAULT_SORT]
)

const requestQuery = computed(() => ({
  search: debouncedSearch.value || undefined,
  person_type: personTypeFilter.value !== 'all' ? personTypeFilter.value : undefined,
  is_active:
    statusFilter.value === 'active'
      ? 'true'
      : statusFilter.value === 'inactive'
        ? 'false'
        : undefined,
  page: page.value,
  page_size: pageSize.value,
  sort_by: sorting.value[0]?.id || undefined,
  sort_order: sorting.value[0]?.desc ? 'desc' : 'asc'
}))

const { data, status, refresh } = await useAsyncData(
  () => `suppliers-${debouncedSearch.value}-${personTypeFilter.value}-${statusFilter.value}-${page.value}-${pageSize.value}-${sorting.value[0]?.id}-${sorting.value[0]?.desc}`,
  async () => {
    if (!canRead.value) {
      return {
        items: [],
        total: 0,
        page: 1,
        page_size: pageSize.value
      } satisfies SuppliersResponse
    }

    return requestFetch<SuppliersResponse>('/api/suppliers', {
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

const supplierItems = computed(() => data.value?.items ?? [])
const totalSuppliers = computed(() => data.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalSuppliers.value / pageSize.value)))

const activeFiltersCount = computed(() => {
  let count = 0
  if (personTypeFilter.value !== 'all') count++
  if (statusFilter.value !== 'all') count++
  return count
})

function buildManagedQuery() {
  return {
    search: search.value || undefined,
    personType: personTypeFilter.value !== 'all' ? personTypeFilter.value : undefined,
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
    const nextPersonType = parsePersonType(query.personType)
    const nextStatus = parseStatus(query.status)
    const nextPage = parsePage(query.page)
    const nextPageSize = parsePageSize(query.pageSize)
    const nextView = parseView(query.view)

    if (search.value !== nextSearch) {
      search.value = nextSearch
      debouncedSearch.value = nextSearch
    }

    if (personTypeFilter.value !== nextPersonType)
      personTypeFilter.value = nextPersonType

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

watch(personTypeFilter, async () => {
  page.value = 1
  await syncQuery()
})

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

function formatTaxId(value: string | null, personType: 'pf' | 'pj') {
  if (!value)
    return '-'

  const digits = value.replace(/\D/g, '')

  if (personType === 'pf' && digits.length === 11)
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')

  if (personType === 'pj' && digits.length === 14)
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')

  return value
}

function formatPhone(value: string | null) {
  if (!value)
    return '-'

  const digits = value.replace(/\D/g, '')

  if (digits.length === 10)
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')

  if (digits.length === 11)
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')

  return value
}

function getLocationSummary(supplier: SupplierItem) {
  return [supplier.city, supplier.state].filter(Boolean).join(' / ') || 'Localização não informada'
}

const showModal = ref(false)
const showImportModal = ref(false)
const selectedSupplier = ref<SupplierItem | null>(null)
const isSaving = ref(false)
const isDeleting = ref(false)
const showDeleteModal = ref(false)
const showBulkDeleteModal = ref(false)
const supplierPendingDeletion = ref<SupplierItem | null>(null)
const isBulkDeleting = ref(false)
const isLoadingCep = ref(false)

const form = reactive({
  name: '',
  trade_name: '',
  person_type: 'pj' as 'pf' | 'pj',
  tax_id: '',
  phone: '',
  whatsapp: '',
  email: '',
  website: '',
  zip_code: '',
  street: '',
  address_number: '',
  address_complement: '',
  neighborhood: '',
  city: '',
  state: '',
  category: '',
  is_active: true,
  notes: '',
  contact_name: '',
  contact_role: '',
  contact_phone: '',
  contact_email: '',
  payment_term_days: 30 as number | string,
  credit_limit: '' as number | string
})

function resetForm() {
  Object.assign(form, {
    name: '',
    trade_name: '',
    person_type: 'pj',
    tax_id: '',
    phone: '',
    whatsapp: '',
    email: '',
    website: '',
    zip_code: '',
    street: '',
    address_number: '',
    address_complement: '',
    neighborhood: '',
    city: '',
    state: '',
    category: null,
    is_active: true,
    notes: '',
    contact_name: '',
    contact_role: '',
    contact_phone: '',
    contact_email: '',
    payment_term_days: 30,
    credit_limit: ''
  })
}

function openCreate() {
  selectedSupplier.value = null
  resetForm()
  showModal.value = true
}

function openEdit(supplier: SupplierItem) {
  selectedSupplier.value = supplier
  Object.assign(form, {
    name: supplier.name ?? '',
    trade_name: supplier.trade_name ?? '',
    person_type: supplier.person_type ?? 'pj',
    tax_id: supplier.tax_id ?? '',
    phone: supplier.phone ?? '',
    whatsapp: supplier.whatsapp ?? '',
    email: supplier.email ?? '',
    website: supplier.website ?? '',
    zip_code: supplier.zip_code ?? '',
    street: supplier.street ?? '',
    address_number: supplier.address_number ?? '',
    address_complement: supplier.address_complement ?? '',
    neighborhood: supplier.neighborhood ?? '',
    city: supplier.city ?? '',
    state: supplier.state ?? '',
    category: supplier.category ?? null,
    is_active: supplier.is_active ?? true,
    notes: supplier.notes ?? '',
    contact_name: supplier.contact_name ?? '',
    contact_role: supplier.contact_role ?? '',
    contact_phone: supplier.contact_phone ?? '',
    contact_email: supplier.contact_email ?? '',
    payment_term_days: supplier.payment_term_days ?? 30,
    credit_limit: supplier.credit_limit ?? ''
  })
  showModal.value = true
}

async function save() {
  if (isSaving.value)
    return

  if (!form.name.trim() || !form.phone.trim()) {
    toast.add({
      title: 'Preencha nome e telefone do fornecedor',
      color: 'warning'
    })
    return
  }

  isSaving.value = true

  try {
    const body = {
      name: form.name.trim(),
      trade_name: form.trade_name || null,
      person_type: form.person_type,
      tax_id: form.tax_id || null,
      phone: form.phone.trim(),
      whatsapp: form.whatsapp || null,
      email: form.email || null,
      website: form.website || null,
      zip_code: form.zip_code || null,
      street: form.street || null,
      address_number: form.address_number || null,
      address_complement: form.address_complement || null,
      neighborhood: form.neighborhood || null,
      city: form.city || null,
      state: form.state || null,
      category: form.category || null,
      is_active: form.is_active,
      notes: form.notes || null,
      contact_name: form.contact_name || null,
      contact_role: form.contact_role || null,
      contact_phone: form.contact_phone || null,
      contact_email: form.contact_email || null,
      payment_term_days: form.payment_term_days === '' ? null : Number(form.payment_term_days),
      credit_limit: form.credit_limit === '' ? null : Number(form.credit_limit)
    }

    if (selectedSupplier.value?.id) {
      await $fetch(`/api/suppliers/${selectedSupplier.value.id}`, {
        method: 'PUT',
        body
      })
      toast.add({ title: 'Fornecedor atualizado', color: 'success' })
    } else {
      await $fetch('/api/suppliers', {
        method: 'POST',
        body
      })
      toast.add({ title: 'Fornecedor criado', color: 'success' })
    }

    showModal.value = false
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao salvar fornecedor',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

async function lookupCep() {
  const cep = form.zip_code.replace(/\D/g, '')
  if (cep.length !== 8 || isLoadingCep.value)
    return

  isLoadingCep.value = true

  try {
    const response = await $fetch<{ erro?: boolean, logradouro?: string, bairro?: string, localidade?: string, uf?: string }>(
      `https://viacep.com.br/ws/${cep}/json/`
    )

    if (response.erro) {
      toast.add({ title: 'CEP não encontrado', color: 'warning' })
      return
    }

    form.street = response.logradouro || form.street
    form.neighborhood = response.bairro || form.neighborhood
    form.city = response.localidade || form.city
    form.state = response.uf || form.state
  } catch {
    toast.add({ title: 'Erro ao consultar CEP', color: 'error' })
  } finally {
    isLoadingCep.value = false
  }
}

function requestRemove(supplier: SupplierItem) {
  if (isDeleting.value)
    return

  supplierPendingDeletion.value = supplier
  showDeleteModal.value = true
}

async function remove(supplier: SupplierItem) {
  if (isDeleting.value)
    return

  isDeleting.value = true

  try {
    await $fetch(`/api/suppliers/${supplier.id}`, { method: 'DELETE' })
    toast.add({ title: 'Fornecedor removido', color: 'success' })
    showDeleteModal.value = false
    supplierPendingDeletion.value = null

    if (supplierItems.value.length === 1 && page.value > 1)
      page.value -= 1

    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao remover fornecedor',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isDeleting.value = false
  }
}

async function confirmRemove() {
  if (!supplierPendingDeletion.value)
    return

  await remove(supplierPendingDeletion.value)
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
      selectedIds.value.map(id => $fetch(`/api/suppliers/${id}`, { method: 'DELETE' }))
    )

    toast.add({
      title: `${selectedIds.value.length} fornecedor(es) removido(s)`,
      color: 'success'
    })

    rowSelection.value = {}
    showBulkDeleteModal.value = false
    await refresh()
  } catch {
    toast.add({
      title: 'Erro ao excluir fornecedores',
      color: 'error'
    })
  } finally {
    isBulkDeleting.value = false
  }
}

async function exportCsv() {
  try {
    const all = await $fetch<SuppliersResponse>('/api/suppliers', {
      query: {
        search: debouncedSearch.value || undefined,
        person_type: personTypeFilter.value !== 'all' ? personTypeFilter.value : undefined,
        is_active:
          statusFilter.value === 'active'
            ? 'true'
            : statusFilter.value === 'inactive'
              ? 'false'
              : undefined,
        page: 1,
        page_size: 2000,
        sort_by: sorting.value[0]?.id || undefined,
        sort_order: sorting.value[0]?.desc ? 'desc' : 'asc'
      }
    })

    if (!all.items.length) {
      toast.add({ title: 'Nenhum fornecedor para exportar', color: 'warning' })
      return
    }

    const headers = [
      'nome',
      'tipo_pessoa',
      'nome_fantasia',
      'cpf_cnpj',
      'telefone',
      'whatsapp',
      'email',
      'cidade',
      'estado',
      'categoria',
      'ativo'
    ]

    const rows = all.items.map(item => [
      item.name,
      item.person_type,
      item.trade_name ?? '',
      item.tax_id ?? '',
      item.phone ?? '',
      item.whatsapp ?? '',
      item.email ?? '',
      item.city ?? '',
      item.state ?? '',
      item.category ?? '',
      item.is_active ? 'sim' : 'nao'
    ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))

    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `fornecedores_${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch {
    toast.add({ title: 'Erro ao exportar fornecedores', color: 'error' })
  }
}

const personTypeFilterOptions = [
  { label: 'Todos os tipos', value: 'all' },
  { label: 'Pessoa Física', value: 'pf' },
  { label: 'Pessoa Jurídica', value: 'pj' }
]

const statusFilterOptions = [
  { label: 'Todos os status', value: 'all' },
  { label: 'Ativos', value: 'active' },
  { label: 'Inativos', value: 'inactive' }
]

const personTypeFormOptions = [
  { label: 'Pessoa Física', value: 'pf' },
  { label: 'Pessoa Jurídica', value: 'pj' }
]

const lineColumns = [
  { accessorKey: 'name', header: 'Fornecedor', enableSorting: true },
  { accessorKey: 'person_type', header: 'Tipo', enableSorting: true },
  { accessorKey: 'tax_id', header: 'CPF/CNPJ', enableSorting: true },
  { accessorKey: 'phone', header: 'Telefone', enableSorting: true },
  { accessorKey: 'email', header: 'E-mail', enableSorting: true },
  { accessorKey: 'is_active', header: 'Status', enableSorting: true },
  { id: 'actions', header: 'Ações', enableSorting: false }
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Fornecedores" />
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar fornecedores.
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
          :data="supplierItems"
          :loading="status === 'pending'"
          :loading-variant="viewMode === 'card' ? 'card' : 'row'"
          :selectable="viewMode === 'table'"
          :sticky-header="viewMode === 'table'"
          :get-row-id="(row) => String(row.id ?? '')"
          :page-size-options="PAGE_SIZE_OPTIONS"
          :total="totalSuppliers"
          search-placeholder="Buscar por nome, CPF/CNPJ ou telefone..."
          :show-search="true"
          :show-view-mode-toggle="true"
          card-grid-class="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2"
          empty-icon="i-lucide-truck"
          empty-title="Nenhum fornecedor encontrado"
          empty-description="Cadastre fornecedores ou ajuste os filtros para continuar."
          @search-submit="submitSearch"
        >
          <template #toolbar-right>
            <UTooltip text="Exportar fornecedores">
              <UButton
                icon="i-lucide-download"
                color="neutral"
                variant="outline"
                size="sm"
                @click="exportCsv"
              />
            </UTooltip>

            <UTooltip text="Importar fornecedores">
              <UButton
                v-if="canCreate"
                label="Importar"
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
              v-if="canCreate"
              label="Novo fornecedor"
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
                  <UFormField label="Tipo de pessoa">
                    <USelectMenu
                      v-model="personTypeFilter"
                      :items="personTypeFilterOptions"
                      value-key="value"
                      class="w-full"
                      :search-input="false"
                    />
                  </UFormField>
                  <UFormField label="Status">
                    <USelectMenu
                      v-model="statusFilter"
                      :items="statusFilterOptions"
                      value-key="value"
                      class="w-full"
                      :search-input="false"
                    />
                  </UFormField>
                </div>
              </template>
            </UPopover>
          </template>

          <template #name-cell="{ row }">
            <div class="min-w-0 space-y-1">
              <p class="truncate font-semibold text-highlighted">
                {{ row.original.name }}
              </p>
              <p class="truncate text-xs text-muted">
                {{ row.original.trade_name || getLocationSummary(row.original as SupplierItem) }}
              </p>
            </div>
          </template>

          <template #person_type-cell="{ row }">
            <UBadge
              :label="row.original.person_type === 'pf' ? 'PF' : 'PJ'"
              color="neutral"
              variant="subtle"
              size="xs"
            />
          </template>

          <template #tax_id-cell="{ row }">
            <span class="text-sm text-muted">
              {{ formatTaxId((row.original as SupplierItem).tax_id, (row.original as SupplierItem).person_type) }}
            </span>
          </template>

          <template #phone-cell="{ row }">
            <span class="text-sm text-muted">
              {{ formatPhone((row.original as SupplierItem).phone) }}
            </span>
          </template>

          <template #is_active-cell="{ row }">
            <UBadge
              :label="row.original.is_active ? 'Ativo' : 'Inativo'"
              :color="row.original.is_active ? 'success' : 'neutral'"
              :leading-icon="row.original.is_active ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
              variant="subtle"
              size="xs"
            />
          </template>

          <template #actions-cell="{ row }">
            <div class="flex items-center justify-end gap-2">
              <UTooltip v-if="canUpdate" text="Editar fornecedor">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="openEdit(row.original as SupplierItem)"
                />
              </UTooltip>

              <UTooltip v-if="canDelete" text="Excluir fornecedor">
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :loading="isDeleting"
                  @click="requestRemove(row.original as SupplierItem)"
                />
              </UTooltip>
            </div>
          </template>

          <template #card="{ item: supplier }">
            <UCard class="border border-default/80 shadow-sm">
              <div class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 space-y-2">
                    <h3 class="truncate text-base font-semibold text-highlighted">
                      {{ supplier.name }}
                    </h3>
                    <div class="flex flex-wrap items-center gap-2">
                      <UBadge
                        :label="supplier.person_type === 'pf' ? 'Pessoa Física' : 'Pessoa Jurídica'"
                        color="neutral"
                        variant="subtle"
                        size="xs"
                      />
                      <UBadge
                        :label="supplier.is_active ? 'Ativo' : 'Inativo'"
                        :color="supplier.is_active ? 'success' : 'neutral'"
                        :leading-icon="supplier.is_active ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                        variant="subtle"
                        size="xs"
                      />
                    </div>
                  </div>

                  <div class="flex shrink-0 items-center gap-1">
                    <UTooltip v-if="canUpdate" text="Editar fornecedor">
                      <UButton
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        @click="openEdit(supplier as SupplierItem)"
                      />
                    </UTooltip>

                    <UTooltip v-if="canDelete" text="Excluir fornecedor">
                      <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        size="xs"
                        :loading="isDeleting"
                        @click="requestRemove(supplier as SupplierItem)"
                      />
                    </UTooltip>
                  </div>
                </div>

                <div class="grid grid-cols-1 gap-2 text-sm text-muted sm:grid-cols-2">
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-id-card" class="size-4 shrink-0" />
                    <span class="truncate">{{ formatTaxId((supplier as SupplierItem).tax_id, (supplier as SupplierItem).person_type) }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-phone" class="size-4 shrink-0" />
                    <span class="truncate">{{ formatPhone((supplier as SupplierItem).phone) }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-mail" class="size-4 shrink-0" />
                    <span class="truncate">{{ supplier.email || '-' }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-map-pinned" class="size-4 shrink-0" />
                    <span class="truncate">{{ getLocationSummary(supplier as SupplierItem) }}</span>
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
    :title="selectedSupplier ? 'Editar fornecedor' : 'Novo fornecedor'"
    :ui="{ body: 'overflow-y-auto max-h-[80vh]' }"
  >
    <template #body>
      <div class="space-y-4">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="Razão social / Nome" required class="sm:col-span-2">
            <UInput v-model="form.name" class="w-full" />
          </UFormField>

          <UFormField label="Nome fantasia">
            <UInput v-model="form.trade_name" class="w-full" />
          </UFormField>

          <UFormField label="Tipo de pessoa">
            <USelectMenu
              v-model="form.person_type"
              :items="personTypeFormOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <UFormField label="CPF / CNPJ">
            <UInput v-model="form.tax_id" class="w-full" />
          </UFormField>

          <UFormField label="Telefone" required>
            <UInput v-model="form.phone" class="w-full" />
          </UFormField>

          <UFormField label="WhatsApp">
            <UInput v-model="form.whatsapp" class="w-full" />
          </UFormField>

          <UFormField label="E-mail">
            <UInput v-model="form.email" type="email" class="w-full" />
          </UFormField>

          <UFormField label="Website">
            <UInput v-model="form.website" class="w-full" placeholder="https://" />
          </UFormField>

          <UFormField label="Categoria">
            <USelectMenu
              v-model="form.category"
              :items="SUPPLIER_CATEGORY_OPTIONS"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <div class="flex items-center gap-3 pt-6">
            <UCheckbox v-model="form.is_active" label="Fornecedor ativo" />
          </div>
        </div>

        <USeparator label="Endereço" />

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="CEP" class="sm:col-span-2">
            <div class="flex gap-2">
              <UInput v-model="form.zip_code" class="flex-1" placeholder="00000-000" />
              <UButton
                label="Buscar"
                color="neutral"
                variant="outline"
                :loading="isLoadingCep"
                :disabled="isLoadingCep"
                @click="lookupCep"
              />
            </div>
          </UFormField>

          <UFormField label="Logradouro" class="sm:col-span-2">
            <UInput v-model="form.street" class="w-full" />
          </UFormField>

          <UFormField label="Número">
            <UInput v-model="form.address_number" class="w-full" />
          </UFormField>

          <UFormField label="Complemento">
            <UInput v-model="form.address_complement" class="w-full" />
          </UFormField>

          <UFormField label="Bairro">
            <UInput v-model="form.neighborhood" class="w-full" />
          </UFormField>

          <UFormField label="Cidade">
            <UInput v-model="form.city" class="w-full" />
          </UFormField>

          <UFormField label="UF">
            <UInput v-model="form.state" maxlength="2" class="w-full uppercase" />
          </UFormField>
        </div>

        <USeparator label="Pessoa de Contato" />

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="Nome do Contato">
            <UInput v-model="form.contact_name" class="w-full" />
          </UFormField>

          <UFormField label="Cargo">
            <UInput v-model="form.contact_role" class="w-full" />
          </UFormField>

          <UFormField label="Telefone do Contato">
            <UInput v-model="form.contact_phone" class="w-full" />
          </UFormField>

          <UFormField label="Email do Contato">
            <UInput v-model="form.contact_email" type="email" class="w-full" />
          </UFormField>
        </div>

        <USeparator label="Condições Comerciais" />

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="Prazo Pagamento (dias)">
            <UInput
              v-model.number="form.payment_term_days"
              type="number"
              min="0"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Limite de Crédito (R$)">
            <UiCurrencyInput v-model="form.credit_limit" />
          </UFormField>

          <UFormField label="Observações" class="sm:col-span-2">
            <UTextarea v-model="form.notes" class="w-full" :rows="3" />
          </UFormField>
        </div>
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
    confirm-label="Excluir fornecedor"
    confirm-color="error"
    :loading="isDeleting"
    @confirm="confirmRemove"
    @update:open="
      (value: boolean) => {
        showDeleteModal = value
        if (!value && !isDeleting) supplierPendingDeletion = null
      }
    "
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir
        <strong class="text-highlighted">
          {{ supplierPendingDeletion?.name || 'este fornecedor' }}
        </strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>

  <AppConfirmModal
    v-model:open="showBulkDeleteModal"
    title="Excluir fornecedores selecionados"
    confirm-label="Excluir todos"
    confirm-color="error"
    :loading="isBulkDeleting"
    @confirm="confirmBulkDelete"
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir
        <strong class="text-highlighted">{{ selectedCount }} fornecedor(es)</strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>

  <SupplierImportModal
    v-model:open="showImportModal"
    @imported="refresh"
  />
</template>
