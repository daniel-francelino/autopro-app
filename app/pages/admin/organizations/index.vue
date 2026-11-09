<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['owner-only']
})
useSeoMeta({ title: 'Organizações — Admin' })

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server
  ? useRequestHeaders(['cookie'])
  : undefined

const search = ref('')
const page = ref(1)
const pageSize = 30

const { data, status, refresh } = await useAsyncData(
  'admin-organizations',
  () =>
    requestFetch<{
      items: any[]
      total: number
      page: number
      page_size: number
    }>('/api/admin/organizations', {
      headers: requestHeaders,
      query: {
        search: search.value || undefined,
        page: page.value,
        page_size: pageSize
      }
    })
)

watch(search, () => {
  page.value = 1
  refresh()
})
watch(page, () => refresh())

const items = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

const columns = [
  { accessorKey: 'name', header: 'Razão Social', enableSorting: false },
  { accessorKey: 'tax_id', header: 'CNPJ/CPF', enableSorting: false },
  { accessorKey: 'email', header: 'E-mail', enableSorting: false },
  { accessorKey: 'user_count', header: 'Usuários', enableSorting: false },
  { accessorKey: 'is_active', header: 'Status', enableSorting: false },
  { accessorKey: 'created_at', header: 'Criado em', enableSorting: false },
  { accessorKey: 'detail', header: '', enableSorting: false }
]

function formatDate(val: string | null) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('pt-BR')
}
</script>

<template>
  <UDashboardPanel>
    <AppPageHeader title="Organizações" />

    <div class="p-6 space-y-8 overflow-auto">
      <AppDataTable
        v-model:search-term="search"
        v-model:page="page"
        :columns="columns"
        :data="items as Record<string, unknown>[]"
        :loading="status === 'pending'"
        :page-size="pageSize"
        :total="total"
        show-search
        search-placeholder="Buscar por nome, fantasia ou CNPJ..."
        empty-icon="i-lucide-building-2"
        empty-title="Nenhuma organização encontrada"
        empty-description="Nenhuma oficina corresponde à busca. Tente o nome, o nome fantasia ou o CNPJ."
      >
        <template #tax_id-cell="{ row }">
          <span class="font-mono text-sm">{{
            row.original.tax_id || "—"
          }}</span>
        </template>

        <template #user_count-cell="{ row }">
          <span class="font-medium">{{ row.original.user_count }}</span>
        </template>

        <template #is_active-cell="{ row }">
          <AdminStatusBadge
            :kind="row.original.suspended_at ? 'org' : 'active'"
            :value="row.original.suspended_at ? 'suspended' : Boolean(row.original.is_active)"
          />
        </template>

        <template #detail-cell="{ row }">
          <UButton
            :to="`/admin/organizations/${row.original.id}`"
            icon="i-lucide-eye"
            label="Abrir"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Abrir ficha da oficina"
          />
        </template>

        <template #created_at-cell="{ row }">
          {{ formatDate(String(row.original.created_at ?? "")) }}
        </template>
      </AppDataTable>
    </div>
  </UDashboardPanel>
</template>
