<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['owner-only']
})
useSeoMeta({ title: 'Auditoria — Admin' })

type AuditRow = {
  id: string
  created_at: string
  request_id: string
  actor_email: string | null
  actor_type: string
  actor_role: string | null
  organization_id: string | null
  organization_name: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  http_method: string
  route_pattern: string | null
  status_code: number
  outcome: 'success' | 'denied' | 'invalid' | 'error'
  duration_ms: number | null
  error_message: string | null
  platform: string | null
}

type AuditDetail = AuditRow & {
  http_path: string
  query_params: unknown
  request_body: unknown
  body_truncated: boolean
  response_body: unknown
  response_truncated: boolean
  response_size_bytes: number | null
  changes: { changed_fields?: string[], diff?: Record<string, { from: unknown, to: unknown }>, before?: unknown, after?: unknown } | null
  ip_address: string | null
  user_agent: string | null
  related: Array<{ id: string, created_at: string, action: string, status_code: number, outcome: string }>
}

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const HOUR = 3_600_000
const periods = [
  { label: 'Últimas 24 h', value: 24 * HOUR },
  { label: 'Últimos 7 dias', value: 7 * 24 * HOUR },
  { label: 'Últimos 31 dias', value: 31 * 24 * HOUR }
]

const filters = reactive({
  period: periods[0]!.value,
  actorEmail: '',
  action: '',
  requestId: '',
  organizationId: String(useRoute().query.organizationId ?? ''),
  outcome: [] as string[]
})
const page = ref(1)
const pageSize = 50

const shortcuts: Array<{ label: string, apply: () => void }> = [
  { label: 'Falhas de hoje', apply: () => Object.assign(filters, { period: 24 * HOUR, outcome: ['denied', 'invalid', 'error'], action: '' }) },
  { label: 'Tentativas negadas', apply: () => Object.assign(filters, { period: 7 * 24 * HOUR, outcome: ['denied'], action: '' }) },
  { label: 'Erros 5xx (24 h)', apply: () => Object.assign(filters, { period: 24 * HOUR, outcome: ['error'], action: '' }) },
  { label: 'Limpar', apply: () => Object.assign(filters, { period: 24 * HOUR, outcome: [], action: '', actorEmail: '', requestId: '', organizationId: '' }) }
]

const { data, status, error, refresh } = await useAsyncData('admin-audit-logs', () => {
  const to = new Date()
  return requestFetch<{ data: AuditRow[], total: number }>('/api/admin/audit-logs', {
    headers: requestHeaders,
    query: {
      from: new Date(to.getTime() - filters.period).toISOString(),
      to: to.toISOString(),
      actorEmail: filters.actorEmail || undefined,
      action: filters.action || undefined,
      requestId: filters.requestId || undefined,
      organizationId: filters.organizationId || undefined,
      outcome: filters.outcome.length ? filters.outcome.join(',') : undefined,
      page: page.value,
      pageSize
    }
  })
})

watch(filters, () => {
  page.value = 1
  refresh()
}, { deep: true })
watch(page, () => refresh())

const items = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.total ?? 0)

const columns = [
  { accessorKey: 'created_at', header: 'Quando', enableSorting: false },
  { accessorKey: 'actor_email', header: 'Usuário', enableSorting: false },
  { accessorKey: 'organization_name', header: 'Oficina', enableSorting: false },
  { accessorKey: 'action', header: 'Ação', enableSorting: false },
  { accessorKey: 'outcome', header: 'Resultado', enableSorting: false },
  { accessorKey: 'duration_ms', header: 'Tempo', enableSorting: false },
  { accessorKey: 'detail', header: '', enableSorting: false }
]

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('pt-BR')
}

// Detalhe
const detailOpen = ref(false)
const detail = ref<AuditDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const tab = ref('request')

async function openDetail(id: string) {
  detailOpen.value = true
  detail.value = null
  detailError.value = ''
  detailLoading.value = true
  tab.value = 'request'
  try {
    detail.value = await $fetch<AuditDetail>(`/api/admin/audit-logs/${id}`)
  } catch (err) {
    detailError.value = (err as { statusMessage?: string })?.statusMessage || 'Não foi possível abrir o registro.'
  } finally {
    detailLoading.value = false
  }
}

const json = (value: unknown) => (value === null || value === undefined ? '—' : JSON.stringify(value, null, 2))

const tabs = [
  { label: 'Request', value: 'request' },
  { label: 'Response', value: 'response' },
  { label: 'Mudanças', value: 'changes' }
]
</script>

<template>
  <UDashboardPanel>
    <AppPageHeader title="Auditoria" />

    <div class="p-6 overflow-auto space-y-4">
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="shortcut in shortcuts"
          :key="shortcut.label"
          :label="shortcut.label"
          size="xs"
          color="neutral"
          variant="outline"
          @click="shortcut.apply()"
        />
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <USelect
          v-model="filters.period"
          :items="periods"
          value-key="value"
          label-key="label"
        />
        <UInput
          v-model.trim="filters.actorEmail"
          placeholder="E-mail do usuário"
          icon="i-lucide-user"
        />
        <UInput
          v-model.trim="filters.action"
          placeholder="Ação (ex.: service_order.cancel)"
          icon="i-lucide-zap"
        />
        <UInput
          v-model.trim="filters.requestId"
          placeholder="Código do erro (ex.: abc12345)"
          icon="i-lucide-hash"
        />
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-x"
        title="Não foi possível carregar o log"
        :description="(error as { statusMessage?: string })?.statusMessage || 'Tente novamente.'"
      />

      <AppDataTable
        v-model:page="page"
        :columns="columns"
        :data="(items as unknown as Record<string, unknown>[])"
        :loading="status === 'pending'"
        :page-size="pageSize"
        :total="total"
        empty-icon="i-lucide-scroll-text"
        empty-title="Nenhum registro no período"
        empty-description="Nenhuma requisição corresponde aos filtros. Aumente o período ou limpe os filtros."
      >
        <template #created_at-cell="{ row }">
          <span class="whitespace-nowrap text-sm">{{ formatDateTime(String(row.original.created_at)) }}</span>
        </template>

        <template #actor_email-cell="{ row }">
          <div class="text-sm">
            {{ row.original.actor_email || '—' }}
            <div class="text-xs text-muted">
              {{ row.original.actor_role || row.original.actor_type }}
            </div>
          </div>
        </template>

        <template #organization_name-cell="{ row }">
          {{ row.original.organization_name || '—' }}
        </template>

        <template #action-cell="{ row }">
          <div class="text-sm">
            <span class="font-medium">{{ row.original.action }}</span>
            <div class="text-xs text-muted">
              {{ row.original.http_method }} {{ row.original.route_pattern }}
            </div>
          </div>
        </template>

        <template #outcome-cell="{ row }">
          <AdminStatusBadge kind="outcome" :value="String(row.original.outcome)" :prefix="row.original.status_code as number" />
        </template>

        <template #duration_ms-cell="{ row }">
          <span class="text-sm text-muted">{{ row.original.duration_ms ?? '—' }} ms</span>
        </template>

        <template #detail-cell="{ row }">
          <UButton
            icon="i-lucide-eye"
            label="Detalhe"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Ver detalhe"
            @click="openDetail(String(row.original.id))"
          />
        </template>
      </AppDataTable>
    </div>

    <USlideover
      v-model:open="detailOpen"
      title="Detalhe da requisição"
      :ui="{ content: 'max-w-2xl' }"
    >
      <template #body>
        <div
          v-if="detailLoading"
          class="space-y-4"
        >
          <AdminSkeleton />
          <AdminSkeleton variant="list" :rows="3" />
        </div>
        <UAlert
          v-else-if="detailError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-x"
          :title="detailError"
        />
        <div
          v-else-if="detail"
          class="space-y-4"
        >
          <div class="space-y-1 text-sm">
            <div class="flex items-center gap-2">
              <AdminStatusBadge kind="outcome" :value="detail.outcome" :prefix="detail.status_code" />
              <span class="font-medium">{{ detail.action }}</span>
            </div>
            <div>{{ detail.http_method }} {{ detail.http_path }}</div>
            <div class="text-muted">
              {{ formatDateTime(detail.created_at) }} · {{ detail.duration_ms ?? '—' }} ms · {{ detail.platform || 'plataforma n/d' }}
            </div>
            <div>
              {{ detail.actor_email || 'anônimo' }} ({{ detail.actor_role || detail.actor_type }})
              <span v-if="detail.organization_name"> · {{ detail.organization_name }}</span>
            </div>
            <div class="text-xs text-muted break-all">
              Código: {{ detail.request_id }} · IP {{ detail.ip_address || '—' }}
            </div>
            <div
              v-if="detail.error_message"
              class="text-error"
            >
              {{ detail.error_message }}
            </div>
          </div>

          <UTabs
            v-model="tab"
            :items="tabs"
            :content="false"
          />

          <div
            v-if="tab === 'request'"
            class="space-y-2"
          >
            <p
              v-if="detail.body_truncated"
              class="text-xs text-warning"
            >
              Corpo truncado: mostrando um resumo.
            </p>
            <pre class="text-xs bg-elevated rounded p-3 overflow-auto max-h-96">{{ json({ query: detail.query_params, body: detail.request_body }) }}</pre>
          </div>

          <div
            v-else-if="tab === 'response'"
            class="space-y-2"
          >
            <p
              v-if="detail.response_truncated"
              class="text-xs text-warning"
            >
              Resposta truncada ({{ detail.response_size_bytes }} bytes): mostrando um resumo.
            </p>
            <pre class="text-xs bg-elevated rounded p-3 overflow-auto max-h-96">{{ json(detail.response_body) }}</pre>
          </div>

          <div
            v-else
            class="space-y-2"
          >
            <p
              v-if="detail.changes?.changed_fields?.length"
              class="text-sm"
            >
              Campos alterados: {{ detail.changes.changed_fields.join(', ') }}
            </p>
            <pre class="text-xs bg-elevated rounded p-3 overflow-auto max-h-96">{{ json(detail.changes) }}</pre>
          </div>

          <div v-if="detail.related.length">
            <p class="text-sm font-medium mb-1">
              Outras linhas da mesma requisição
            </p>
            <ul class="text-xs space-y-1">
              <li
                v-for="rel in detail.related"
                :key="rel.id"
              >
                <button
                  type="button"
                  class="underline"
                  @click="openDetail(rel.id)"
                >
                  {{ rel.action }} · {{ rel.status_code }}
                </button>
              </li>
            </ul>
          </div>
        </div>
      </template>
    </USlideover>
  </UDashboardPanel>
</template>
