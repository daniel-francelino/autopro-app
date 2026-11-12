<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['owner-only']
})
useSeoMeta({ title: 'Fiscal — Logs' })

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server
  ? useRequestHeaders(['cookie'])
  : undefined

const page = ref(1)
const pageSize = 50

const { data, status, refresh } = await useAsyncData('admin-fiscal-logs', () =>
  requestFetch<{
    success: boolean
    data: Record<string, unknown>[]
    meta: { total: number, page: number, pageSize: number }
  }>('/api/admin/fiscal/logs', {
    headers: requestHeaders,
    query: { page: page.value, pageSize }
  })
)

watch(page, () => refresh())

const logs = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta?.total ?? 0)

const columns = [
  { accessorKey: 'created_at', header: 'Data/Hora', enableSorting: false },
  { accessorKey: 'function_name', header: 'Função', enableSorting: false },
  { accessorKey: 'response_status', header: 'Status', enableSorting: false },
  { accessorKey: 'user_email', header: 'Usuário', enableSorting: false },
  { accessorKey: 'request_url', header: 'URL', enableSorting: false },
  { accessorKey: 'duration_ms', header: 'Duração (ms)', enableSorting: false }
]

function formatDate(val: string | null) {
  if (!val) return '—'
  return new Date(val).toLocaleString('pt-BR')
}
</script>

<template>
  <UDashboardPanel>
    <AppPageHeader title="Logs de Integração Fiscal" />
    <div class="p-6 space-y-8 overflow-auto">
      <AppDataTable
        v-model:page="page"
        :columns="columns"
        :data="logs as Record<string, unknown>[]"
        :loading="status === 'pending'"
        :page-size="pageSize"
        :total="total"
        empty-icon="i-lucide-scroll-text"
        empty-title="Nenhum log fiscal"
        empty-description="Cada chamada ao provedor de NFS-e fica registrada aqui. Ainda não houve nenhuma."
      >
        <template #created_at-cell="{ row }">
          <span class="font-mono text-xs">{{
            formatDate(String(row.original.created_at ?? ""))
          }}</span>
        </template>

        <template #response_status-cell="{ row }">
          <AdminStatusBadge kind="http" :value="Number(row.original.response_status) || null" />
        </template>

        <template #request_url-cell="{ row }">
          <span
            class="block max-w-64 truncate font-mono text-xs"
            :title="String(row.original.request_url ?? '')"
          >
            {{ row.original.request_url || "—" }}
          </span>
        </template>

        <template #duration_ms-cell="{ row }">
          {{
            row.original.duration_ms != null
              ? `${row.original.duration_ms}ms`
              : "—"
          }}
        </template>
      </AppDataTable>
    </div>
  </UDashboardPanel>
</template>
