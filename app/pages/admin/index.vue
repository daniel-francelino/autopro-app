<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['owner-only']
})
useSeoMeta({ title: 'Admin Dashboard' })

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

// ─── Stats ─────────────────────────────────────────────────────────────────────
const { data: stats, status: statsStatus } = await useAsyncData(
  'admin-stats',
  () => requestFetch<Record<string, unknown>>('/api/admin/stats', { headers: requestHeaders })
)

const statsCards = computed(() => [
  {
    label: 'Organizações',
    value: stats.value?.total_organizations ?? 0,
    sub: `+${stats.value?.new_organizations_last_30_days ?? 0} nos últimos 30 dias`,
    icon: 'i-lucide-building-2',
    color: 'primary'
  },
  {
    label: 'Usuários',
    value: stats.value?.total_users ?? 0,
    icon: 'i-lucide-users',
    color: 'secondary'
  },
  {
    label: 'Assinaturas Ativas',
    value: stats.value?.active_subscriptions ?? 0,
    sub: `${stats.value?.total_subscriptions ?? 0} total`,
    icon: 'i-lucide-credit-card',
    color: 'success'
  },
  {
    label: 'Ordens de Serviço',
    value: stats.value?.total_service_orders ?? 0,
    icon: 'i-lucide-wrench',
    color: 'warning'
  }
])

// ─── Active tab ────────────────────────────────────────────────────────────────
const activeTab = ref('invoices')

// ─── Subscriptions chart (last 12 months) ──────────────────────────────────────
const { data: subsChartData, status: subsChartStatus } = await useAsyncData(
  'admin-subscriptions-chart',
  () => requestFetch<{ categories: string[], series: { name: string, data: number[] }[] }>(
    '/api/admin/subscriptions/chart',
    { headers: requestHeaders }
  )
)

const subsChartCategories = computed(() => subsChartData.value?.categories ?? [])
const subsChartSeries = computed(() => subsChartData.value?.series ?? [])

// ─── Subscriptions table ────────────────────────────────────────────────────────
const subsPage = ref(1)
const subsPageSize = 15
const subsSearch = ref('')

const { data: subsData, status: subsStatus, refresh: refreshSubs } = await useAsyncData(
  'admin-subscriptions-list',
  () => requestFetch<{ items: Record<string, unknown>[], total: number }>(
    '/api/admin/subscriptions',
    {
      headers: requestHeaders,
      query: {
        page: subsPage.value,
        page_size: subsPageSize,
        search: subsSearch.value || undefined
      }
    }
  )
)

watch([subsPage, subsSearch], () => refreshSubs())

const subsItems = computed(() => subsData.value?.items ?? [])
const subsTotal = computed(() => subsData.value?.total ?? 0)

const subsColumns = [
  { accessorKey: 'organization_name', header: 'Organização', enableSorting: false },
  { accessorKey: 'user_email', header: 'E-mail', enableSorting: false },
  { accessorKey: 'plan_name', header: 'Plano', enableSorting: false },
  { accessorKey: 'status', header: 'Status', enableSorting: false },
  { accessorKey: 'monthly_amount', header: 'Valor/mês', enableSorting: false },
  { accessorKey: 'next_payment_date', header: 'Próx. cobrança', enableSorting: false },
  { accessorKey: 'created_at', header: 'Início', enableSorting: false }
]

const SUB_STATUS_COLORS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  trial: 'warning',
  suspended: 'error',
  cancelled: 'neutral'
}

const SUB_STATUS_LABELS: Record<string, string> = {
  active: 'Ativa',
  trial: 'Trial',
  suspended: 'Suspensa',
  cancelled: 'Cancelada'
}

// ─── Invoices chart ─────────────────────────────────────────────────────────────
const { data: invChartData, status: invChartStatus } = await useAsyncData(
  'admin-invoices-chart',
  () => requestFetch<{ categories: string[], series: { name: string, data: number[] }[] }>(
    '/api/admin/invoices/chart',
    { headers: requestHeaders }
  )
)

const invChartCategories = computed(() => invChartData.value?.categories ?? [])
const invChartSeries = computed(() => invChartData.value?.series ?? [])

// ─── Invoices table ─────────────────────────────────────────────────────────────
const invPage = ref(1)
const invPageSize = 15
const invSearch = ref('')

const { data: invData, status: invStatus, refresh: refreshInv } = await useAsyncData(
  'admin-invoices-list',
  () => requestFetch<{ items: Record<string, unknown>[], total: number }>(
    '/api/admin/invoices',
    {
      headers: requestHeaders,
      query: {
        page: invPage.value,
        page_size: invPageSize,
        search: invSearch.value || undefined
      }
    }
  )
)

watch([invPage, invSearch], () => refreshInv())

const invItems = computed(() => invData.value?.items ?? [])
const invTotal = computed(() => invData.value?.total ?? 0)

const invColumns = [
  { accessorKey: 'organization_name', header: 'Organização', enableSorting: false },
  { accessorKey: 'user_email', header: 'E-mail', enableSorting: false },
  { accessorKey: 'invoice_number', header: 'Nº Fatura', enableSorting: false },
  { accessorKey: 'amount', header: 'Valor', enableSorting: false },
  { accessorKey: 'status', header: 'Status', enableSorting: false },
  { accessorKey: 'issue_date', header: 'Emissão', enableSorting: false },
  { accessorKey: 'payment_date', header: 'Pagamento', enableSorting: false },
  { id: 'pdf', header: '', enableSorting: false }
]

const INV_STATUS_COLORS: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  paid: 'success',
  pending: 'warning',
  failed: 'error',
  cancelled: 'neutral'
}

const INV_STATUS_LABELS: Record<string, string> = {
  open: 'Aberta',
  paid: 'Paga',
  pending: 'Pendente',
  failed: 'Falhou',
  cancelled: 'Cancelada'
}

// ─── Shared helpers ──────────────────────────────────────────────────────────────
function formatCurrency(val: unknown) {
  if (val == null) return '—'
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(val: string | null) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('pt-BR')
}
</script>

<template>
  <UDashboardPanel>
    <UDashboardNavbar title="Admin Dashboard" />

    <div class="p-6 space-y-8 overflow-auto">
      <!-- Stats cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <template v-if="statsStatus === 'pending'">
          <USkeleton v-for="i in 4" :key="i" class="h-28 rounded-xl" />
        </template>
        <template v-else>
          <UPageCard
            v-for="card in statsCards"
            :key="card.label"
            :title="String(card.value)"
            :description="card.label"
          >
            <template #leading>
              <UIcon :name="card.icon" class="size-6 text-primary" />
            </template>
            <template v-if="card.sub" #footer>
              <span class="text-xs text-muted">{{ card.sub }}</span>
            </template>
          </UPageCard>
        </template>
      </div>

      <!-- Tabs: Assinaturas / Faturas -->
      <UTabs
        v-model="activeTab"
        :items="[
          { label: 'Assinaturas', value: 'subscriptions', slot: 'subscriptions' as const, icon: 'i-lucide-credit-card' },
          { label: 'Faturas', value: 'invoices', slot: 'invoices' as const, icon: 'i-lucide-receipt' }
        ]"
        variant="link"
        class="w-full"
      >
        <!-- ── Assinaturas ── -->
        <template #subscriptions>
          <div class="space-y-6 pt-4">
            <!-- Chart -->
            <UPageCard :ui="{ body: 'p-4' }">
              <div class="mb-4 flex items-center gap-2">
                <UIcon name="i-lucide-chart-line" class="size-4 text-primary" />
                <p class="text-sm font-semibold text-highlighted">
                  Assinaturas — últimos 12 meses
                </p>
              </div>
              <USkeleton v-if="subsChartStatus === 'pending'" class="h-56 rounded-xl" />
              <ChartsArea
                v-else
                :categories="subsChartCategories"
                :series="subsChartSeries"
                :height="220"
                :colors="['#22c55e', '#ef4444']"
              />
            </UPageCard>

            <!-- Table -->
            <AppDataTable
              v-model:search-term="subsSearch"
              v-model:page="subsPage"
              :columns="subsColumns"
              :data="subsItems as Record<string, unknown>[]"
              :loading="subsStatus === 'pending'"
              :page-size="subsPageSize"
              :total="subsTotal"
              show-search
              search-placeholder="Buscar por e-mail ou plano..."
              empty-icon="i-lucide-credit-card"
              empty-title="Nenhuma assinatura encontrada"
              empty-description="As assinaturas das organizações aparecerão aqui."
            >
              <template #status-cell="{ row }">
                <UBadge
                  :color="SUB_STATUS_COLORS[String(row.original.status)] ?? 'neutral'"
                  variant="subtle"
                  size="sm"
                >
                  {{ SUB_STATUS_LABELS[String(row.original.status)] ?? row.original.status }}
                </UBadge>
              </template>

              <template #monthly_amount-cell="{ row }">
                <span class="font-mono text-sm">{{ formatCurrency(row.original.monthly_amount) }}</span>
              </template>

              <template #next_payment_date-cell="{ row }">
                {{ formatDate(String(row.original.next_payment_date ?? '')) }}
              </template>

              <template #created_at-cell="{ row }">
                {{ formatDate(String(row.original.created_at ?? '')) }}
              </template>
            </AppDataTable>
          </div>
        </template>

        <!-- ── Faturas ── -->
        <template #invoices>
          <div class="space-y-6 pt-4">
            <!-- Chart -->
            <UPageCard :ui="{ body: 'p-4' }">
              <div class="mb-4 flex items-center gap-2">
                <UIcon name="i-lucide-chart-line" class="size-4 text-primary" />
                <p class="text-sm font-semibold text-highlighted">
                  Faturas — últimos 12 meses
                </p>
              </div>
              <USkeleton v-if="invChartStatus === 'pending'" class="h-56 rounded-xl" />
              <ChartsArea
                v-else
                :categories="invChartCategories"
                :series="invChartSeries"
                :height="220"
                :colors="['#22c55e', '#f59e0b', '#ef4444']"
                :format-value="(v: number) => formatCurrency(v)"
              />
            </UPageCard>

            <!-- Table -->
            <AppDataTable
              v-model:search-term="invSearch"
              v-model:page="invPage"
              :columns="invColumns"
              :data="invItems as Record<string, unknown>[]"
              :loading="invStatus === 'pending'"
              :page-size="invPageSize"
              :total="invTotal"
              show-search
              search-placeholder="Buscar por e-mail ou nº da fatura..."
              empty-icon="i-lucide-receipt"
              empty-title="Nenhuma fatura encontrada"
              empty-description="As faturas das organizações aparecerão aqui."
            >
              <template #status-cell="{ row }">
                <UBadge
                  :color="INV_STATUS_COLORS[String(row.original.status)] ?? 'neutral'"
                  variant="subtle"
                  size="sm"
                >
                  {{ INV_STATUS_LABELS[String(row.original.status)] ?? row.original.status }}
                </UBadge>
              </template>

              <template #amount-cell="{ row }">
                <span class="font-mono text-sm font-medium">{{ formatCurrency(row.original.amount) }}</span>
              </template>

              <template #issue_date-cell="{ row }">
                {{ formatDate(String(row.original.issue_date ?? '')) }}
              </template>

              <template #payment_date-cell="{ row }">
                {{ formatDate(String(row.original.payment_date ?? '')) }}
              </template>

              <template #pdf-cell="{ row }">
                <UButton
                  v-if="row.original.pdf_url"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-file-down"
                  :to="String(row.original.pdf_url)"
                  target="_blank"
                />
              </template>
            </AppDataTable>
          </div>
        </template>
      </UTabs>
    </div>
  </UDashboardPanel>
</template>
