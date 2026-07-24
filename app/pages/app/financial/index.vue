<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import type { RowSelectionState } from '@tanstack/table-core'
import { ActionCode } from '~/constants/action-codes'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Financeiro' })

type BadgeColor = 'success' | 'error' | 'warning' | 'primary' | 'secondary' | 'info' | 'neutral'

interface Entry {
  id: string
  description: string
  amount: string | number
  due_date: string
  type: string
  status: string
  category_id?: string | null
  category_ref?: { id: string, name: string, icon: string, color: string } | null
  bank_account_id?: string | null
  notes?: string | null
  recurrence?: string | null
  parent_recurrence_id?: string | null
  is_installment?: boolean | null
  installment_count?: number | null
  current_installment?: number | null
  parent_transaction_id?: string | null
  [key: string]: unknown
}

type BankAccountItem = {
  id: string
  account_name: string
  bank_name?: string | null
}

type FinancialResponse = {
  items: Entry[]
  total: number
  page: number
  page_size: number
}

type SummarySection = {
  income: number
  expense: number
  balance: number
}

type SummaryResponse = {
  total: SummarySection
  paid: SummarySection
  pending: SummarySection
}

const PAGE_SIZE = 20
const MANAGED_QUERY_KEYS = ['search', 'status', 'type', 'category_id', 'dateFrom', 'dateTo', 'page'] as const

const defaultSummary: SummaryResponse = {
  total: { income: 0, expense: 0, balance: 0 },
  paid: { income: 0, expense: 0, balance: 0 },
  pending: { income: 0, expense: 0, balance: 0 }
}

const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const route = useRoute()
const router = useRouter()

const canRead = computed(() => workshop.can(ActionCode.FINANCIAL_READ))
const canCreate = computed(() => workshop.can(ActionCode.FINANCIAL_CREATE))
const canUpdate = computed(() => workshop.can(ActionCode.FINANCIAL_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.FINANCIAL_DELETE))

function getDefaultDateRange() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const lastDay = String(new Date(year, now.getMonth() + 1, 0).getDate()).padStart(2, '0')
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${lastDay}` }
}

function parsePage(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1
}

function parseArrayQuery(value: unknown) {
  if (Array.isArray(value))
    return value.flatMap(item => String(item || '').split(',')).map(item => item.trim()).filter(Boolean)
  if (typeof value === 'string')
    return value.split(',').map(item => item.trim()).filter(Boolean)
  return []
}

function normalizeStatusValue(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'pago') return 'paid'
  if (normalized === 'pendente') return 'pending'
  if (normalized === 'paid' || normalized === 'pending') return normalized
  return normalized
}

function normalizeStatusForApi(value: string) {
  return value
}

function normalizeRecurrenceValue(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized || ['null', 'none', 'non_recurring', 'nao_recorrente', 'sem recorrencia', 'sem recorrência'].includes(normalized)) return null
  if (normalized === 'monthly' || normalized === 'mensal') return 'monthly'
  if (normalized === 'annual' || normalized === 'anual') return 'yearly'
  return normalized
}

function isRecurringEntry(entry: Entry) {
  return Boolean(entry.recurrence) && entry.recurrence !== 'non_recurring'
}

function isPaidStatus(value: unknown) {
  return normalizeStatusValue(value) === 'paid'
}

const defaultDateRange = getDefaultDateRange()

const search = ref(typeof route.query.search === 'string' ? route.query.search : '')
const debouncedSearch = ref(search.value)
const statusFilters = ref<string[]>(parseArrayQuery(route.query.status))
const typeFilters = ref<string[]>(parseArrayQuery(route.query.type))
const dateFrom = ref(typeof route.query.dateFrom === 'string' ? route.query.dateFrom : defaultDateRange.from)
const dateTo = ref(typeof route.query.dateTo === 'string' ? route.query.dateTo : defaultDateRange.to)
const categoryFilter = ref(typeof route.query.category_id === 'string' ? route.query.category_id : '')
const page = ref(parsePage(route.query.page))

const requestQuery = computed(() => ({
  search: debouncedSearch.value || undefined,
  status: statusFilters.value.length === 1 ? normalizeStatusForApi(statusFilters.value[0]!) : undefined,
  type: typeFilters.value.length === 1 ? typeFilters.value[0] : undefined,
  category_id: categoryFilter.value || undefined,
  date_from: dateFrom.value || undefined,
  date_to: dateTo.value || undefined,
  page: page.value,
  page_size: PAGE_SIZE
}))

// Summary query — excludes status so the breakdown is always full
const summaryQuery = computed(() => ({
  search: debouncedSearch.value || undefined,
  type: typeFilters.value.length === 1 ? typeFilters.value[0] : undefined,
  category_id: categoryFilter.value || undefined,
  date_from: dateFrom.value || undefined,
  date_to: dateTo.value || undefined
}))

const { data, status, refresh } = await useAsyncData(
  () => `financial-${debouncedSearch.value}-${statusFilters.value.join(',')}-${typeFilters.value.join(',')}-${dateFrom.value}-${dateTo.value}-${page.value}`,
  async () => {
    if (!canRead.value) return { items: [], total: 0, page: 1, page_size: PAGE_SIZE } satisfies FinancialResponse
    return requestFetch<FinancialResponse>('/api/financial', { headers: requestHeaders, query: requestQuery.value })
  },
  {
    watch: [requestQuery],
    default: () => ({ items: [], total: 0, page: 1, page_size: PAGE_SIZE })
  }
)

const { data: summaryData, refresh: refreshSummary } = await useAsyncData(
  () => `financial-summary-${debouncedSearch.value}-${typeFilters.value.join(',')}-${dateFrom.value}-${dateTo.value}`,
  async () => {
    if (!canRead.value) return defaultSummary
    return requestFetch<SummaryResponse>('/api/financial/summary', { headers: requestHeaders, query: summaryQuery.value })
  },
  { watch: [summaryQuery], default: () => defaultSummary }
)

const { data: bankAccountsData } = await useAsyncData(
  'financial-bank-accounts-options',
  () => requestFetch<{ items?: BankAccountItem[] }>('/api/bank-accounts', {
    headers: requestHeaders,
    query: { page_size: 100, is_active: 'true' }
  }),
  { default: () => ({ items: [] }) }
)

const bankAccountOptions = computed<BankAccountItem[]>(() => {
  const raw = bankAccountsData.value
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : ((raw as { items?: BankAccountItem[] }).items ?? [])
  return list.filter(item => item.id && item.account_name)
})

const bankAccountById = computed(() =>
  new Map(bankAccountOptions.value.map(a => [a.id, `${a.account_name}${a.bank_name ? ` — ${a.bank_name}` : ''}`]))
)

const accumulatedItems = ref<Entry[]>([])
const totalFromServer = ref(0)

function mergeIncomingData(newData: typeof data.value) {
  const newItems = newData?.items ?? []
  totalFromServer.value = newData?.total ?? 0

  if (page.value === 1) {
    accumulatedItems.value = newItems
    return
  }

  const existingIds = new Set(accumulatedItems.value.map(item => item.id))
  accumulatedItems.value = [
    ...accumulatedItems.value,
    ...newItems.filter(item => !existingIds.has(item.id))
  ]
}

watch(data, mergeIncomingData)

const summary = computed(() => summaryData.value ?? defaultSummary)

const hasMore = computed(() => accumulatedItems.value.length < totalFromServer.value)
const loadingMore = computed(() => status.value === 'pending' && page.value > 1)

// ── Bootstrap: load preceding pages when entering at page > 1 ────────────────
const isHydrated = ref(false)
const isBootstrapping = ref(false)

onMounted(async () => {
  // Populate items from SSR payload (or default) before showing content
  mergeIncomingData(data.value)
  isHydrated.value = true

  const initialPage = page.value
  if (initialPage <= 1 || !canRead.value) return

  isBootstrapping.value = true
  try {
    const baseQuery = {
      search: debouncedSearch.value || undefined,
      status: statusFilters.value.length === 1 ? normalizeStatusForApi(statusFilters.value[0]!) : undefined,
      type: typeFilters.value.length === 1 ? typeFilters.value[0] : undefined,
      category_id: categoryFilter.value || undefined,
      date_from: dateFrom.value || undefined,
      date_to: dateTo.value || undefined,
      page_size: PAGE_SIZE
    }
    const prefetchedItems: Entry[] = []
    for (let p = 1; p < initialPage; p++) {
      const res = await $fetch<FinancialResponse>('/api/financial', { query: { ...baseQuery, page: p } })
      prefetchedItems.push(...res.items)
    }
    if (prefetchedItems.length > 0) {
      const existingIds = new Set(accumulatedItems.value.map(item => item.id))
      accumulatedItems.value = [
        ...prefetchedItems.filter(item => !existingIds.has(item.id)),
        ...accumulatedItems.value
      ]
    }
  } finally {
    isBootstrapping.value = false
  }
})

const _hasActiveFilters = computed(() =>
  Boolean(
    search.value
    || statusFilters.value.length
    || typeFilters.value.length
    || categoryFilter.value
    || dateFrom.value !== defaultDateRange.from
    || dateTo.value !== defaultDateRange.to
  )
)

// Fetched once from the org's full category list (not just the loaded page)
// so the filter always shows every category ever used — fixes the bug where
// this used to be derived from accumulatedItems (only the rows already
// paginated into the browser). See docs/financial-categories-crud.md.
type CategoryListItem = { id: string, name: string, type: 'income' | 'expense', icon: string, color: string, is_default: boolean }
const { data: categoriesData } = await useAsyncData(
  'financial-categories-filter-options',
  () => requestFetch<{ defaults: CategoryListItem[], custom: CategoryListItem[] }>('/api/financial/categories', { headers: requestHeaders }),
  { default: () => ({ defaults: [], custom: [] }) }
)

const uniqueCategories = computed(() => {
  const all = [...(categoriesData.value?.defaults ?? []), ...(categoriesData.value?.custom ?? [])]
  return all
    .map(c => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
})

// ── Summary cards ─────────────────────────────────────────────────────────────

const summaryCards = computed(() => [
  {
    key: 'income',
    label: 'Receitas',
    icon: 'i-lucide-trending-up',
    iconClass: 'text-success',
    bgClass: 'bg-success/10',
    valueClass: 'text-success',
    total: summary.value.total.income,
    paid: summary.value.paid.income,
    pending: summary.value.pending.income
  },
  {
    key: 'expense',
    label: 'Despesas',
    icon: 'i-lucide-trending-down',
    iconClass: 'text-error',
    bgClass: 'bg-error/10',
    valueClass: 'text-error',
    total: summary.value.total.expense,
    paid: summary.value.paid.expense,
    pending: summary.value.pending.expense
  },
  {
    key: 'balance',
    label: 'Saldo',
    icon: 'i-lucide-wallet',
    iconClass: summary.value.total.balance >= 0 ? 'text-success' : 'text-error',
    bgClass: summary.value.total.balance >= 0 ? 'bg-success/10' : 'bg-error/10',
    valueClass: summary.value.total.balance >= 0 ? 'text-success' : 'text-error',
    total: summary.value.total.balance,
    paid: summary.value.paid.balance,
    pending: summary.value.pending.balance
  }
])

// ── Query sync ────────────────────────────────────────────────────────────────

function buildManagedQuery() {
  return {
    search: search.value || undefined,
    status: statusFilters.value.length ? statusFilters.value.join(',') : undefined,
    type: typeFilters.value.length ? typeFilters.value.join(',') : undefined,
    category_id: categoryFilter.value || undefined,
    dateFrom: dateFrom.value !== defaultDateRange.from ? dateFrom.value : undefined,
    dateTo: dateTo.value !== defaultDateRange.to ? dateTo.value : undefined,
    page: page.value > 1 ? String(page.value) : undefined
  }
}

async function syncQuery() {
  const nextQuery = Object.fromEntries(
    Object.entries(route.query).filter(([key]) => !MANAGED_QUERY_KEYS.includes(key as typeof MANAGED_QUERY_KEYS[number]))
  ) as Record<string, string | string[] | undefined>

  Object.assign(nextQuery, buildManagedQuery())
  if (JSON.stringify(route.query) === JSON.stringify(nextQuery)) return
  await router.replace({ query: nextQuery })
}

async function submitSearch(value: string) {
  search.value = value
  debouncedSearch.value = value
  accumulatedItems.value = []
  rowSelection.value = {}
  page.value = 1
  await syncQuery()
}

watch(
  () => route.query,
  (query) => {
    const nextSearch = typeof query.search === 'string' ? query.search : ''
    const nextStatus = parseArrayQuery(query.status)
    const nextType = parseArrayQuery(query.type)
    const nextDateFrom = typeof query.dateFrom === 'string' ? query.dateFrom : defaultDateRange.from
    const nextDateTo = typeof query.dateTo === 'string' ? query.dateTo : defaultDateRange.to
    const nextCategory = typeof query.category_id === 'string' ? query.category_id : ''
    const nextPage = parsePage(query.page)

    if (search.value !== nextSearch) {
      search.value = nextSearch
      debouncedSearch.value = nextSearch
    }
    if (JSON.stringify(statusFilters.value) !== JSON.stringify(nextStatus)) statusFilters.value = nextStatus
    if (JSON.stringify(typeFilters.value) !== JSON.stringify(nextType)) typeFilters.value = nextType
    if (dateFrom.value !== nextDateFrom) dateFrom.value = nextDateFrom
    if (dateTo.value !== nextDateTo) dateTo.value = nextDateTo
    if (categoryFilter.value !== nextCategory) categoryFilter.value = nextCategory
    if (page.value !== nextPage) page.value = nextPage
  }
)

watchDebounced(
  search,
  async (value) => {
    debouncedSearch.value = value
    accumulatedItems.value = []
    rowSelection.value = {}
    page.value = 1
    await syncQuery()
  },
  { debounce: 300, maxWait: 800 }
)

watch(
  [statusFilters, typeFilters, dateFrom, dateTo, categoryFilter],
  async () => {
    accumulatedItems.value = []
    rowSelection.value = {}
    page.value = 1
    await syncQuery()
  },
  { deep: true }
)

watch(page, syncQuery)

function loadMore() {
  if (hasMore.value && status.value !== 'pending') page.value += 1
}

function _resetFilters() {
  search.value = ''
  debouncedSearch.value = ''
  statusFilters.value = []
  typeFilters.value = []
  categoryFilter.value = ''
  dateFrom.value = defaultDateRange.from
  dateTo.value = defaultDateRange.to
  accumulatedItems.value = []
  rowSelection.value = {}
  page.value = 1
}

async function resetAndRefresh() {
  accumulatedItems.value = []
  rowSelection.value = {}
  if (page.value !== 1) {
    page.value = 1
    return
  }
  await Promise.all([refresh(), refreshSummary()])
}

// ── Row selection ─────────────────────────────────────────────────────────────

const rowSelection = ref<RowSelectionState>({})
const selectedIds = computed(() =>
  Object.entries(rowSelection.value).filter(([, v]) => v).map(([id]) => id)
)
const selectedCount = computed(() => selectedIds.value.length)
const selectedEntries = computed(() =>
  accumulatedItems.value.filter(entry => selectedIds.value.includes(String(entry.id)))
)
const pendingSelectedCount = computed(() =>
  selectedEntries.value.filter(e => !isPaidStatus(e.status)).length
)
const selectionSummary = computed(() => {
  let income = 0
  let expense = 0
  for (const entry of selectedEntries.value) {
    const amount = Number.parseFloat(String(entry.amount || 0)) || 0
    if (entry.type === 'income') income += amount
    else if (entry.type === 'expense') expense += amount
  }
  return { income, expense, balance: income - expense }
})

// ── Pay single ────────────────────────────────────────────────────────────────

const isPaying = ref(false)
const payingEntryId = ref<string | null>(null)

async function pay(entry: Entry) {
  if (isPaying.value || isPaidStatus(entry.status)) return
  isPaying.value = true
  payingEntryId.value = String(entry.id)
  try {
    await $fetch(`/api/financial/${String(entry.id)}/pay`, { method: 'POST' })
    toast.add({ title: 'Lançamento marcado como pago', color: 'success' })
    await resetAndRefresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Falha ao pagar', color: 'error' })
  } finally {
    isPaying.value = false
    payingEntryId.value = null
  }
}

// ── Bulk pay ──────────────────────────────────────────────────────────────────

const showBulkPayModal = ref(false)
const isBulkPaying = ref(false)

async function confirmBulkPay() {
  if (!pendingSelectedCount.value || isBulkPaying.value) return
  isBulkPaying.value = true
  try {
    const pendingIds = selectedEntries.value.filter(e => !isPaidStatus(e.status)).map(e => String(e.id))
    await $fetch('/api/financial/pay-entries-bulk', { method: 'POST', body: { entryIds: pendingIds } })
    toast.add({ title: `${pendingIds.length} lançamento(s) marcado(s) como pago`, color: 'success' })
    rowSelection.value = {}
    showBulkPayModal.value = false
    await resetAndRefresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Falha ao pagar em massa', color: 'error' })
  } finally {
    isBulkPaying.value = false
  }
}

// ── Detail slideover ─────────────────────────────────────────────────────────

const showDetailSlideover = ref(false)
const detailEntryId = ref<string | null>(null)

function openDetail(entry: Entry) {
  detailEntryId.value = String(entry.id)
  showDetailSlideover.value = true
}

function onDetailEdit(entry: Entry) {
  showDetailSlideover.value = false
  openEdit(entry)
}

// ── Create / Edit ─────────────────────────────────────────────────────────────

const showFormModal = ref(false)
const selectedEntry = ref<Entry | null>(null)

function openCreate() {
  selectedEntry.value = null
  showFormModal.value = true
}
function openEdit(entry: Entry) {
  selectedEntry.value = entry
  showFormModal.value = true
}

async function onEntrySaved() {
  showFormModal.value = false
  selectedEntry.value = null
  await resetAndRefresh()
}

// ── Delete single ─────────────────────────────────────────────────────────────

const isDeleting = ref(false)
const showDeleteModal = ref(false)
const entryPendingDeletion = ref<Entry | null>(null)
const deletionReason = ref('')
const deletionReasonValid = computed(() => deletionReason.value.trim().length > 0)

function requestRemove(entry: Entry) {
  if (isDeleting.value) return
  entryPendingDeletion.value = entry
  deletionReason.value = ''
  showDeleteModal.value = true
}

async function confirmRemove() {
  if (!entryPendingDeletion.value || isDeleting.value || !deletionReasonValid.value) return
  isDeleting.value = true
  try {
    await $fetch(`/api/financial/${String(entryPendingDeletion.value.id)}`, {
      method: 'DELETE',
      body: { reason: deletionReason.value.trim() }
    })
    toast.add({ title: 'Lançamento removido', color: 'success' })
    showDeleteModal.value = false
    entryPendingDeletion.value = null
    deletionReason.value = ''
    await resetAndRefresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Falha ao remover', color: 'error' })
  } finally {
    isDeleting.value = false
  }
}

// ── Bulk delete ───────────────────────────────────────────────────────────────

const showBulkDeleteModal = ref(false)
const isBulkDeleting = ref(false)
const bulkDeletionReason = ref('')
const bulkDeletionReasonValid = computed(() => bulkDeletionReason.value.trim().length > 0)

function requestBulkRemove() {
  bulkDeletionReason.value = ''
  showBulkDeleteModal.value = true
}

async function confirmBulkDelete() {
  if (!selectedIds.value.length || isBulkDeleting.value || !bulkDeletionReasonValid.value) return
  isBulkDeleting.value = true
  try {
    const reason = bulkDeletionReason.value.trim()
    await Promise.all(selectedIds.value.map(id => $fetch(`/api/financial/${id}`, { method: 'DELETE', body: { reason } })))
    toast.add({ title: `${selectedIds.value.length} lançamento(s) removido(s)`, color: 'success' })
    rowSelection.value = {}
    showBulkDeleteModal.value = false
    bulkDeletionReason.value = ''
    await resetAndRefresh()
  } catch {
    toast.add({ title: 'Erro ao excluir lançamentos', color: 'error' })
  } finally {
    isBulkDeleting.value = false
  }
}

// ── Duplicate ─────────────────────────────────────────────────────────────────

const isDuplicating = ref(false)
const duplicatingEntryId = ref<string | null>(null)

async function duplicate(entry: Entry) {
  if (isDuplicating.value) return
  isDuplicating.value = true
  duplicatingEntryId.value = String(entry.id)
  try {
    const originalDate = String(entry.due_date || '')
    let newDueDate = originalDate
    if (originalDate) {
      const [year, month, day] = originalDate.split('-').map(Number)
      const d = new Date(year!, month! - 1, day!)
      const recurrence = normalizeRecurrenceValue(entry.recurrence)
      if (recurrence === 'monthly') {
        d.setMonth(d.getMonth() + 1)
      } else if (recurrence === 'yearly') {
        d.setFullYear(d.getFullYear() + 1)
      }
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const dy = String(d.getDate()).padStart(2, '0')
      newDueDate = `${y}-${m}-${dy}`
    }
    await $fetch('/api/financial', {
      method: 'POST',
      body: {
        description: entry.description,
        amount: entry.amount,
        due_date: newDueDate,
        type: entry.type,
        status: 'pending',
        category_id: entry.category_id,
        bank_account_id: entry.bank_account_id ?? null,
        notes: entry.notes ?? null,
        recurrence: entry.recurrence ?? null
      }
    })
    toast.add({ title: 'Lançamento duplicado com sucesso', color: 'success' })
    await resetAndRefresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro ao duplicar', description: err?.data?.statusMessage || err?.statusMessage || 'Falha ao duplicar lançamento', color: 'error' })
  } finally {
    isDuplicating.value = false
    duplicatingEntryId.value = null
  }
}

// ── Extend recurrence (add more occurrences to an existing series) ────────────
// No cron in this infra — series are generated upfront at creation and need
// this explicit action to keep going once exhausted. See
// docs/financial-recurrence-flow.md section 6.7.

const extendCountOptions = Array.from({ length: 60 }, (_, i) => ({
  label: `${i + 1}x`,
  value: i + 1
}))

const showExtendModal = ref(false)
const extendingEntry = ref<Entry | null>(null)
const extendCount = ref(12)
const isExtending = ref(false)

function requestExtend(entry: Entry) {
  extendingEntry.value = entry
  extendCount.value = 12
  showExtendModal.value = true
}

function onDetailExtend(entry: Entry) {
  showDetailSlideover.value = false
  requestExtend(entry)
}

// Reuses the existing bulk-delete flow (motivo obrigatório) — just
// pre-selects the series' still-pending future occurrences instead of
// requiring the user to find and check each row manually.
function onDetailDeleteFuture(ids: string[]) {
  showDetailSlideover.value = false
  const selection: RowSelectionState = {}
  for (const id of ids) selection[id] = true
  rowSelection.value = selection
  requestBulkRemove()
}

async function confirmExtend() {
  if (!extendingEntry.value || isExtending.value) return
  isExtending.value = true
  try {
    await $fetch(`/api/financial/${String(extendingEntry.value.id)}/extend-recurrence`, {
      method: 'POST',
      body: { additional_count: extendCount.value }
    })
    toast.add({ title: `${extendCount.value} ocorrência(s) adicionada(s)`, color: 'success' })
    showExtendModal.value = false
    extendingEntry.value = null
    await resetAndRefresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Falha ao adicionar ocorrências', color: 'error' })
  } finally {
    isExtending.value = false
  }
}

// ── Fullscreen modal ─────────────────────────────────────────────────────────

const showFullscreen = ref(false)

// ── Export ────────────────────────────────────────────────────────────────────

type ExportFormat = 'csv' | 'pdf'
const exporting = ref<ExportFormat | null>(null)

async function exportReport(format: ExportFormat) {
  exporting.value = format
  try {
    const res = await $fetch<{ success: boolean, data: { fileName: string, contentType: string, base64: string } }>(
      '/api/financial/export',
      {
        method: 'POST',
        body: {
          format,
          search: debouncedSearch.value || undefined,
          status: statusFilters.value.length === 1 ? normalizeStatusForApi(statusFilters.value[0]!) : undefined,
          type: typeFilters.value.length === 1 ? typeFilters.value[0] : undefined,
          dateFrom: dateFrom.value || undefined,
          dateTo: dateTo.value || undefined
        }
      }
    )

    if (res.data?.base64) {
      const binary = atob(res.data.base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: res.data.contentType })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = res.data.fileName
      link.click()
      URL.revokeObjectURL(url)
    }
  } catch {
    toast.add({ title: 'Erro ao exportar lançamentos', color: 'error' })
  } finally {
    exporting.value = null
  }
}

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

// ── Formatters ────────────────────────────────────────────────────────────────

function formatCurrency(value: number | string) {
  const parsed = Number.parseFloat(String(value || 0))
  return Number.isFinite(parsed) ? parsed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00'
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const [year, month, day] = String(value).split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function formatStatusLabel(value: unknown) {
  const normalized = normalizeStatusValue(value)
  if (normalized === 'paid') return 'Pago'
  if (normalized === 'pending') return 'Pendente'
  return String(value || '—')
}

function formatRecurrence(value: unknown) {
  const normalized = normalizeRecurrenceValue(value)
  if (!normalized) return 'Sem recorrência'
  if (normalized === 'monthly') return 'Mensal'
  if (normalized === 'yearly') return 'Anual'
  return String(value || 'Sem recorrência')
}

function hasRecurrence(value: unknown) {
  return Boolean(normalizeRecurrenceValue(value))
}

function getBankAccountLabel(entry: Entry) {
  const accountId = String(entry.bank_account_id || '')
  if (!accountId) return null
  const account = bankAccountOptions.value.find(a => a.id === accountId)
  return account?.account_name ?? null
}

const typeBadgeLabel: Record<string, string> = { income: 'Receita', expense: 'Despesa' }
const statusBadgeColor: Record<string, BadgeColor> = { paid: 'success', pending: 'warning' }
const statusBadgeIcon: Record<string, string> = { paid: 'i-lucide-circle-check', pending: 'i-lucide-clock' }

const columns = [
  { accessorKey: 'description', header: 'Lançamento', enableSorting: false, meta: { class: { th: 'w-[56%]', td: 'w-[56%]' } } },
  { id: 'status_col', header: 'Status', enableSorting: false, meta: { class: { th: 'w-32', td: 'w-32' } } },
  { id: 'amount_col', header: 'Valor', enableSorting: false, meta: { class: { th: 'w-36 text-right', td: 'w-36 text-right whitespace-nowrap' } } },
  { id: 'actions', header: '', enableSorting: false, meta: { class: { th: 'w-40', td: 'w-40' } } }
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Financeiro" />
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar lançamentos financeiros.
        </p>
      </div>
      <div v-else class="space-y-4 p-4">
        <!-- Summary cards -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div
            v-for="card in summaryCards"
            :key="card.key"
            class="rounded-xl border border-default/80 bg-default p-4 shadow-sm"
          >
            <div class="flex items-start justify-between">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-muted">
                  {{ card.label }}
                </p>
                <p class="mt-1 text-2xl font-bold" :class="card.valueClass">
                  {{ formatCurrency(card.total) }}
                </p>
              </div>
              <div class="ml-3 shrink-0 rounded-lg p-2" :class="card.bgClass">
                <UIcon :name="card.icon" class="size-5" :class="card.iconClass" />
              </div>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-default/60 pt-3">
              <div class="flex items-center gap-1 text-xs">
                <UIcon name="i-lucide-circle-check" class="size-3.5 shrink-0 text-success" />
                <span class="text-muted">Pago:</span>
                <span class="font-semibold text-highlighted">{{ formatCurrency(card.paid) }}</span>
              </div>
              <div class="flex items-center gap-1 text-xs">
                <UIcon name="i-lucide-clock" class="size-3.5 shrink-0 text-warning" />
                <span class="text-muted">Pendente:</span>
                <span class="font-semibold text-highlighted">{{ formatCurrency(card.pending) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Table -->
        <AppDataTableInfinite
          v-model:search-term="search"
          v-model:row-selection="rowSelection"
          :columns="columns"
          :data="accumulatedItems as Record<string, unknown>[]"
          :loading="!isHydrated || (status === 'pending' && page === 1) || isBootstrapping"
          :loading-more="loadingMore"
          :has-more="hasMore"
          :total="totalFromServer"
          :selectable="true"
          :get-row-id="(row) => String(row.id ?? '')"
          table-class="table-fixed min-w-[860px] w-full"
          show-search
          search-placeholder="Buscar por descrição..."
          empty-icon="i-lucide-wallet-cards"
          empty-title="Nenhum lançamento encontrado"
          empty-description="Cadastre lançamentos ou ajuste os filtros para continuar."
          @search-submit="submitSearch"
          @load-more="loadMore"
        >
          <template #toolbar-right>
            <FinancialEntriesSelectionSummaryPopover
              v-if="selectedCount > 0"
              :count="selectedCount"
              :income="selectionSummary.income"
              :expense="selectionSummary.expense"
              :balance="selectionSummary.balance"
            />

            <UTooltip
              v-if="canUpdate"
              :text="pendingSelectedCount > 0 ? `Pagar ${pendingSelectedCount} selecionado(s)` : 'Selecione lançamentos pendentes'"
            >
              <UButton
                icon="i-lucide-check-circle"
                color="success"
                variant="outline"
                size="sm"
                :disabled="pendingSelectedCount === 0"
                @click="showBulkPayModal = true"
              />
            </UTooltip>

            <UTooltip
              v-if="canDelete"
              :text="selectedCount > 0 ? `Excluir ${selectedCount} selecionado(s)` : 'Selecione lançamentos para excluir'"
            >
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="outline"
                size="sm"
                :disabled="selectedCount === 0"
                @click="requestBulkRemove"
              />
            </UTooltip>

            <UTooltip text="Exportar lançamentos">
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

            <UTooltip text="Expandir tabela">
              <UButton
                icon="i-lucide-maximize-2"
                color="neutral"
                variant="outline"
                size="sm"
                square
                @click="showFullscreen = true"
              />
            </UTooltip>

            <UButton
              v-if="canCreate"
              label="Novo lançamento"
              icon="i-lucide-plus"
              size="sm"
              @click="openCreate"
            />
          </template>

          <template #filters>
            <FinancialEntriesFilters
              v-model:date-from="dateFrom"
              v-model:date-to="dateTo"
              v-model:type-filters="typeFilters"
              v-model:status-filters="statusFilters"
              v-model:category-filter="categoryFilter"
              :categories="uniqueCategories"
            />
          </template>

          <template #description-cell="{ row }">
            <div class="flex items-center gap-3">
              <UTooltip
                :text="typeBadgeLabel[String(row.original.type)] ?? String(row.original.type || '—')"
              >
                <div
                  class="flex size-8 shrink-0 cursor-default items-center justify-center rounded-full"
                  :class="row.original.type === 'income' ? 'bg-success/10' : 'bg-error/10'"
                >
                  <UIcon
                    :name="row.original.type === 'income' ? 'i-lucide-trending-up' : 'i-lucide-trending-down'"
                    class="size-4"
                    :class="row.original.type === 'income' ? 'text-success' : 'text-error'"
                  />
                </div>
              </UTooltip>
              <div class="min-w-0 space-y-0.5">
                <div class="flex items-center gap-1.5">
                  <p class="truncate font-semibold text-highlighted">
                    {{ row.original.description }}
                  </p>
                  <UBadge
                    v-if="(row.original as Entry).is_installment && (row.original as Entry).current_installment && (row.original as Entry).installment_count"
                    variant="outline"
                    color="info"
                    size="xs"
                    :label="`${(row.original as Entry).current_installment}/${(row.original as Entry).installment_count}x`"
                  />
                </div>
                <p class="truncate text-xs text-muted">
                  {{ formatDate(String((row.original as Entry).due_date || '')) }}
                  <span class="mx-1 opacity-40">·</span>
                  {{ getBankAccountLabel(row.original as Entry) ?? '—' }}
                </p>
              </div>
            </div>
          </template>

          <template #status_col-cell="{ row }">
            <UBadge
              :color="statusBadgeColor[normalizeStatusValue((row.original as Entry).status)] ?? 'neutral'"
              variant="subtle"
              :icon="statusBadgeIcon[normalizeStatusValue((row.original as Entry).status)]"
              :label="formatStatusLabel((row.original as Entry).status)"
              size="sm"
            />
          </template>

          <template #amount_col-cell="{ row }">
            <span
              class="block w-full text-right text-sm font-semibold tabular-nums"
              :class="row.original.type === 'income' ? 'text-success' : 'text-error'"
            >
              {{ formatCurrency(row.original.amount as string | number) }}
            </span>
          </template>

          <template #actions-cell="{ row }">
            <div class="flex items-center justify-end gap-2">
              <UTooltip text="Ver detalhes">
                <UButton
                  icon="i-lucide-eye"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="openDetail(row.original as Entry)"
                />
              </UTooltip>

              <UTooltip
                v-if="canUpdate && !isPaidStatus((row.original as Entry).status)"
                text="Marcar como pago"
              >
                <UButton
                  icon="i-lucide-check-circle"
                  color="success"
                  variant="ghost"
                  size="xs"
                  :loading="isPaying && payingEntryId === String((row.original as Entry).id)"
                  @click="pay(row.original as Entry)"
                />
              </UTooltip>

              <UTooltip v-if="canCreate && isRecurringEntry(row.original as Entry)" text="Adicionar mais ocorrências">
                <UButton
                  icon="i-lucide-calendar-plus"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="requestExtend(row.original as Entry)"
                />
              </UTooltip>

              <UTooltip v-else-if="canCreate" text="Duplicar lançamento">
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :loading="isDuplicating && duplicatingEntryId === String((row.original as Entry).id)"
                  @click="duplicate(row.original as Entry)"
                />
              </UTooltip>

              <UTooltip v-if="canUpdate" text="Editar lançamento">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="openEdit(row.original as Entry)"
                />
              </UTooltip>

              <UTooltip v-if="canDelete" text="Excluir lançamento">
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :loading="isDeleting && entryPendingDeletion?.id === (row.original as Entry).id"
                  @click="requestRemove(row.original as Entry)"
                />
              </UTooltip>
            </div>
          </template>

          <template #end-of-list>
            Todos os {{ totalFromServer }} registro(s) foram carregados
          </template>
        </AppDataTableInfinite>
      </div>
    </template>
  </UDashboardPanel>

  <FinancialEntriesFormModal
    v-model:open="showFormModal"
    :entry="selectedEntry"
    :bank-account-options="bankAccountOptions"
    @saved="onEntrySaved"
  />

  <!-- Fullscreen modal -->
  <FinancialEntriesFullscreenModal
    v-model:open="showFullscreen"
    v-model:search="search"
    v-model:row-selection="rowSelection"
    v-model:date-from="dateFrom"
    v-model:date-to="dateTo"
    v-model:type-filters="typeFilters"
    v-model:status-filters="statusFilters"
    v-model:category-filter="categoryFilter"
    :data="accumulatedItems"
    :loading="!isHydrated || (status === 'pending' && page === 1) || isBootstrapping"
    :loading-more="loadingMore"
    :has-more="hasMore"
    :total="totalFromServer"
    :unique-categories="uniqueCategories"
    :export-items="exportItems"
    :exporting="exporting"
    :can-create="canCreate"
    :can-update="canUpdate"
    :can-delete="canDelete"
    :pending-selected-count="pendingSelectedCount"
    :selected-count="selectedCount"
    :selection-income="selectionSummary.income"
    :selection-expense="selectionSummary.expense"
    :selection-balance="selectionSummary.balance"
    :bank-account-options="bankAccountOptions"
    :is-paying="isPaying"
    :paying-entry-id="payingEntryId"
    :is-duplicating="isDuplicating"
    :duplicating-entry-id="duplicatingEntryId"
    :is-deleting="isDeleting"
    :entry-pending-deletion-id="entryPendingDeletion ? String(entryPendingDeletion.id) : null"
    @search-submit="submitSearch"
    @load-more="loadMore"
    @bulk-pay="showBulkPayModal = true"
    @bulk-delete="requestBulkRemove"
    @open-create="openCreate"
    @open-detail="openDetail"
    @pay="pay"
    @duplicate="duplicate"
    @extend-recurrence="requestExtend"
    @open-edit="openEdit"
    @remove="requestRemove"
  />

  <FinancialEntriesDetailSlideover
    v-model:open="showDetailSlideover"
    :entry-id="detailEntryId"
    :bank-account-by-id="bankAccountById"
    @edit="onDetailEdit"
    @extend-recurrence="onDetailExtend"
    @delete-future="onDetailDeleteFuture"
  />

  <!-- Adicionar mais ocorrências a uma série recorrente -->
  <AppConfirmModal
    v-model:open="showExtendModal"
    title="Adicionar mais ocorrências"
    confirm-label="Adicionar"
    confirm-color="primary"
    :loading="isExtending"
    @confirm="confirmExtend"
    @update:open="
      (v) => {
        showExtendModal = v
        if (!v && !isExtending) extendingEntry = null
      }
    "
  >
    <template #description>
      <div class="space-y-3">
        <p class="text-sm text-muted">
          Gera mais ocorrências desta série a partir da última já existente, seguindo o mesmo valor/categoria/conta bancária.
        </p>
        <UFormField label="Quantidade">
          <USelectMenu
            v-model="extendCount"
            :items="extendCountOptions"
            value-key="value"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>
  </AppConfirmModal>

  <AppConfirmModal
    v-model:open="showDeleteModal"
    title="Excluir lançamento"
    confirm-label="Excluir lançamento"
    confirm-color="error"
    :loading="isDeleting"
    :confirm-disabled="!deletionReasonValid"
    @confirm="confirmRemove"
    @update:open="
      (value: boolean) => {
        showDeleteModal = value
        if (!value && !isDeleting) {
          entryPendingDeletion = null
          deletionReason = ''
        }
      }
    "
  >
    <template #description>
      <div class="space-y-3">
        <p class="text-sm text-muted">
          Tem certeza que deseja excluir
          <strong class="text-highlighted">{{ entryPendingDeletion?.description || 'este lançamento' }}</strong>?
          Esta ação não pode ser desfeita.
        </p>
        <UFormField label="Motivo da exclusão" required>
          <UTextarea
            v-model="deletionReason"
            class="w-full"
            :rows="2"
          />
        </UFormField>
      </div>
    </template>
  </AppConfirmModal>

  <AppConfirmModal
    v-model:open="showBulkDeleteModal"
    title="Excluir lançamentos selecionados"
    confirm-label="Excluir todos"
    confirm-color="error"
    :loading="isBulkDeleting"
    :confirm-disabled="!bulkDeletionReasonValid"
    @confirm="confirmBulkDelete"
    @update:open="
      (value: boolean) => {
        showBulkDeleteModal = value
        if (!value && !isBulkDeleting) bulkDeletionReason = ''
      }
    "
  >
    <template #description>
      <div class="space-y-3">
        <p class="text-sm text-muted">
          Tem certeza que deseja excluir
          <strong class="text-highlighted">{{ selectedCount }} lançamento(s)</strong>?
          Esta ação não pode ser desfeita.
        </p>
        <UFormField label="Motivo da exclusão" required>
          <UTextarea
            v-model="bulkDeletionReason"
            class="w-full"
            :rows="2"
            placeholder="Explique por que estes lançamentos estão sendo excluídos"
          />
        </UFormField>
      </div>
    </template>
  </AppConfirmModal>

  <AppConfirmModal
    v-model:open="showBulkPayModal"
    title="Pagar lançamentos selecionados"
    confirm-label="Confirmar pagamento"
    confirm-color="success"
    :loading="isBulkPaying"
    @confirm="confirmBulkPay"
  >
    <template #description>
      <p class="text-sm text-muted">
        Marcar
        <strong class="text-highlighted">{{ pendingSelectedCount }} lançamento(s)</strong>
        como pagos? Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>
</template>
