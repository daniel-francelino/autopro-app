<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['owner-only']
})
useSeoMeta({ title: 'Usuários — Admin' })

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server
  ? useRequestHeaders(['cookie'])
  : undefined

const search = ref('')
const page = ref(1)
const pageSize = 30

const { data, status, refresh } = await useAsyncData(
  'admin-users',
  () =>
    requestFetch<{
      items: Record<string, unknown>[]
      total: number
      page: number
      page_size: number
    }>('/api/admin/users', {
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
  { accessorKey: 'display_name', header: 'Nome', enableSorting: false },
  { accessorKey: 'email', header: 'E-mail', enableSorting: false },
  { accessorKey: 'organization_name', header: 'Organização', enableSorting: false },
  { accessorKey: 'is_owner', header: 'Owner', enableSorting: false },
  { accessorKey: 'is_active', header: 'Status', enableSorting: false },
  { accessorKey: 'created_at', header: 'Criado em', enableSorting: false }
]

function formatDate(val: string | null) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('pt-BR')
}
</script>

<template>
  <UDashboardPanel>
    <UDashboardNavbar title="Usuários" />

    <div class="p-6 overflow-auto">
      <AppDataTable
        v-model:search-term="search"
        v-model:page="page"
        :columns="columns"
        :data="items"
        :loading="status === 'pending'"
        :page-size="pageSize"
        :total="total"
        show-search
        search-placeholder="Buscar por nome ou e-mail..."
        empty-icon="i-lucide-users"
        empty-title="Nenhum usuário encontrado"
        empty-description="Nenhum usuário corresponde à sua busca."
      >
        <template #is_active-cell="{ row }">
          <UBadge
            :color="row.original.is_active ? 'success' : 'neutral'"
            variant="subtle"
            size="sm"
          >
            {{ row.original.is_active ? 'Ativo' : 'Inativo' }}
          </UBadge>
        </template>

        <template #is_owner-cell="{ row }">
          <UIcon
            v-if="row.original.is_owner"
            name="i-lucide-shield-check"
            class="size-4 text-warning"
          />
          <span v-else class="text-muted text-sm">—</span>
        </template>

        <template #created_at-cell="{ row }">
          {{ formatDate(String(row.original.created_at ?? '')) }}
        </template>
      </AppDataTable>
    </div>
  </UDashboardPanel>
</template>
