<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import { ActionCode } from '~/constants/action-codes'
import type { NfseRow, SyncStatusResponse } from '~/types/nfse'
import type { BadgeColor } from '~/types/ui'

definePageMeta({
  layout: 'app',
  requiredPermission: ActionCode.SERVICE_INVOICE_READ
})
useSeoMeta({ title: 'NFS-e — Notas de Serviço' })

const workshop = useWorkshopPermissions()
const canDelete = computed(() => workshop.can(ActionCode.SERVICE_INVOICE_DELETE))

// ─── Sync status ──────────────────────────────────────────────────────────────

const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const requestFetch = useRequestFetch()

const router = useRouter()

const { data: syncStatusData } = await useAsyncData(
  'fiscal-company-sync-status',
  () => requestFetch<SyncStatusResponse>('/api/fiscal/company/sync-status', { headers: requestHeaders }),
  { default: () => null as SyncStatusResponse | null }
)

const isSynced = computed(() => syncStatusData.value?.is_synced === true)

function goToCompanySettings() {
  router.push('/app/settings/company')
}

// ─── NFS-e list ───────────────────────────────────────────────────────────────

type NfseListResponse = {
  success: boolean
  data: NfseRow[]
  meta: { total: number, page: number, limit: number, pages: number }
}

const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const MANAGED_QUERY_KEYS = ['search', 'page', 'pageSize', 'status'] as const

const route = useRoute()

function parsePage(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
}
function parsePageSize(v: unknown) {
  const n = Number(v)
  return PAGE_SIZE_OPTIONS.includes(n) ? n : DEFAULT_PAGE_SIZE
}

const search = ref(typeof route.query.search === 'string' ? route.query.search : '')
const debouncedSearch = ref(search.value)
const page = ref(parsePage(route.query.page))
const pageSize = ref(parsePageSize(route.query.pageSize))
const statusFilter = ref(typeof route.query.status === 'string' ? route.query.status : '')

const requestQuery = computed(() => ({
  search: debouncedSearch.value || undefined,
  page: page.value,
  limit: pageSize.value,
  status: statusFilter.value || undefined
}))

const { data, status: fetchStatus, refresh } = await useAsyncData(
  () => `nfse-list-${debouncedSearch.value}-${page.value}-${pageSize.value}-${statusFilter.value}`,
  () => requestFetch<NfseListResponse>('/api/fiscal/nfse', { headers: requestHeaders, query: requestQuery.value }),
  {
    watch: [requestQuery],
    default: () => ({ success: true, data: [], meta: { total: 0, page: 1, limit: DEFAULT_PAGE_SIZE, pages: 0 } })
  }
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

function buildManagedQuery() {
  return {
    search: search.value || undefined,
    page: page.value > 1 ? String(page.value) : undefined,
    pageSize: pageSize.value !== DEFAULT_PAGE_SIZE ? String(pageSize.value) : undefined,
    status: statusFilter.value || undefined
  }
}

async function syncQuery() {
  const next = Object.fromEntries(
    Object.entries(route.query).filter(([k]) => !MANAGED_QUERY_KEYS.includes(k as (typeof MANAGED_QUERY_KEYS)[number]))
  ) as Record<string, string | undefined>
  Object.assign(next, buildManagedQuery())
  if (JSON.stringify(route.query) === JSON.stringify(next)) return
  await router.replace({ query: next })
}

watch(() => route.query, (q) => {
  const ns = typeof q.search === 'string' ? q.search : ''
  if (search.value !== ns) {
    search.value = ns
    debouncedSearch.value = ns
  }
  const np = parsePage(q.page)
  if (page.value !== np) page.value = np
  const nps = parsePageSize(q.pageSize)
  if (pageSize.value !== nps) pageSize.value = nps
  const nst = typeof q.status === 'string' ? q.status : ''
  if (statusFilter.value !== nst) statusFilter.value = nst
})

watchDebounced(search, async (val) => {
  debouncedSearch.value = val
  page.value = 1
  await syncQuery()
}, { debounce: 300, maxWait: 800 })

watch(page, async () => {
  if (page.value > totalPages.value && totalPages.value > 0) page.value = totalPages.value
  await syncQuery()
})
watch(pageSize, async () => {
  page.value = 1
  await syncQuery()
})
watch(statusFilter, async () => {
  page.value = 1
  await syncQuery()
})

async function submitSearch(value: string) {
  search.value = value
  debouncedSearch.value = value
  page.value = 1
  await syncQuery()
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  authorized: 'Autorizada',
  processing_authorization: 'Processando',
  authorization_error: 'Erro',
  cancelled: 'Cancelada'
}

const STATUS_COLOR: Record<string, BadgeColor> = {
  authorized: 'success',
  processing_authorization: 'warning',
  authorization_error: 'error',
  cancelled: 'neutral'
}

const STATUS_OPTIONS = [
  { label: 'Todos', value: '' },
  { label: 'Autorizada', value: 'authorized' },
  { label: 'Processando', value: 'processing_authorization' },
  { label: 'Erro', value: 'authorization_error' },
  { label: 'Cancelada', value: 'cancelled' }
]

function statusLabel(s: string) {
  return STATUS_LABEL[s] ?? s
}
function statusColor(s: string): BadgeColor {
  return STATUS_COLOR[s] ?? 'neutral'
}

function formatDate(val: string | null) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('pt-BR')
}

// ─── Table columns ────────────────────────────────────────────────────────────

const columns = [
  { accessorKey: 'provider_reference', header: 'Referência', enableSorting: false },
  { accessorKey: 'nfse_number', header: 'Número NFS-e', enableSorting: false },
  { accessorKey: 'service_order_number', header: 'OS', enableSorting: false },
  { accessorKey: 'issued_at', header: 'Emissão', enableSorting: false },
  { accessorKey: 'status', header: 'Status', enableSorting: false },
  { id: 'actions', header: '', enableSorting: false }
]

// ─── Detail slideover ─────────────────────────────────────────────────────────

const showDetail = ref(false)
const selectedRow = ref<NfseRow | null>(null)

function openDetail(row: NfseRow) {
  selectedRow.value = row
  showDetail.value = true
}

// ─── Cancel modal ─────────────────────────────────────────────────────────────

const showCancelModal = ref(false)
const nfsePendingCancel = ref<NfseRow | null>(null)

function requestCancel(row: NfseRow) {
  nfsePendingCancel.value = row
  showCancelModal.value = true
}

async function onCancelled() {
  showDetail.value = false
  selectedRow.value = null
  await refresh()
}

// ─── Email modal ──────────────────────────────────────────────────────────────

const showEmailModal = ref(false)
const nfseForEmail = ref<NfseRow | null>(null)

function requestEmail(row: NfseRow) {
  nfseForEmail.value = row
  showEmailModal.value = true
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Notas Fiscais de Serviço (NFS-e)" />
    </template>

    <template #body>
      <FinancialFiscalSyncBanner
        v-if="!isSynced"
        :error-message="syncStatusData?.sync?.sync_error_message"
        @configure="goToCompanySettings"
      />

      <AppDataTable
        v-model:search-term="search"
        v-model:page="page"
        v-model:page-size="pageSize"
        :columns="columns"
        :data="rows"
        :loading="fetchStatus === 'pending'"
        loading-variant="row"
        :total="total"
        :page-size-options="PAGE_SIZE_OPTIONS"
        search-placeholder="Buscar por referência, número ou OS..."
        :show-search="true"
        empty-icon="i-lucide-file-text"
        empty-title="Nenhuma NFS-e encontrada"
        empty-description="Nenhuma nota fiscal de serviço corresponde aos filtros aplicados."
        @search-submit="submitSearch"
      >
        <template #toolbar-right>
          <USelect
            v-model="statusFilter"
            :options="STATUS_OPTIONS"
            value-key="value"
            label-key="label"
            size="sm"
            class="w-40"
          />
        </template>

        <template #provider_reference-cell="{ row }">
          <button class="font-mono text-xs text-primary hover:underline" @click="openDetail(row.original as NfseRow)">
            {{ row.original.provider_reference }}
          </button>
        </template>

        <template #nfse_number-cell="{ row }">
          <span class="font-medium text-highlighted">{{ row.original.nfse_number ?? '—' }}</span>
        </template>

        <template #service_order_number-cell="{ row }">
          <span class="text-sm text-muted">{{ row.original.service_order_number ?? '—' }}</span>
        </template>

        <template #issued_at-cell="{ row }">
          <span class="text-sm">{{ formatDate(row.original.issued_at as string | null) }}</span>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :label="statusLabel(row.original.status as string)"
            :color="statusColor(row.original.status as string)"
            variant="subtle"
            size="sm"
            class="font-medium"
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
                @click="openDetail(row.original as NfseRow)"
              />
            </UTooltip>
            <UTooltip text="Reenviar por e-mail">
              <UButton
                icon="i-lucide-mail"
                color="neutral"
                variant="ghost"
                size="xs"
                :disabled="(row.original.status as string) === 'cancelled'"
                @click="requestEmail(row.original as NfseRow)"
              />
            </UTooltip>
            <UTooltip v-if="canDelete" text="Cancelar NFS-e">
              <UButton
                icon="i-lucide-x-circle"
                color="error"
                variant="ghost"
                size="xs"
                :disabled="(row.original.status as string) === 'cancelled'"
                @click="requestCancel(row.original as NfseRow)"
              />
            </UTooltip>
          </div>
        </template>
      </AppDataTable>
    </template>
  </UDashboardPanel>

  <FinancialNfseDetailSlideover
    :open="showDetail"
    :row="selectedRow"
    @update:open="(v) => { showDetail = v; if (!v) selectedRow = null }"
    @cancel="(row) => requestCancel(row)"
    @email="(row) => requestEmail(row)"
  />

  <FinancialNfseCancelModal
    :open="showCancelModal"
    :nfse="nfsePendingCancel"
    @update:open="(v) => { showCancelModal = v; if (!v) nfsePendingCancel = null }"
    @cancelled="onCancelled"
  />

  <FinancialNfseEmailModal
    :open="showEmailModal"
    :nfse="nfseForEmail"
    @update:open="(v) => { showEmailModal = v; if (!v) nfseForEmail = null }"
  />
</template>
