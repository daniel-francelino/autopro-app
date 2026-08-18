<script setup lang="ts">
import { ActionCode } from '~/constants/action-codes'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Categorias de produtos' })

interface ProductCategory {
  id: string
  name: string
  description: string | null
  products_count: number
  commission_rules_count: number
}

const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const canRead = computed(() => workshop.can(ActionCode.PRODUCTS_READ))
const canCreate = computed(() => workshop.can(ActionCode.PRODUCTS_CREATE))
const canUpdate = computed(() => workshop.can(ActionCode.PRODUCTS_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.PRODUCTS_DELETE))

const search = ref('')
const page = ref(1)
const pageSize = ref(20)

const { data, status, refresh } = await useAsyncData(
  'products-categories-crud',
  async () => {
    if (!canRead.value) return { items: [] as ProductCategory[] }
    return requestFetch<{ items: ProductCategory[] }>('/api/product-categories', {
      headers: requestHeaders,
      query: { includeUsage: 'true' }
    })
  },
  { default: () => ({ items: [] }) }
)

const allCategories = computed(() => data.value?.items ?? [])

const filteredCategories = computed(() => {
  const term = search.value.trim().toLowerCase()
  return allCategories.value
    .filter(category => !term || category.name.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
})

const paginatedCategories = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredCategories.value.slice(start, start + pageSize.value)
})

watch(search, () => {
  page.value = 1
})

const columns = [
  { accessorKey: 'name', header: 'Nome', enableSorting: false },
  { id: 'products', header: 'Produtos', enableSorting: false },
  { id: 'commissions', header: 'Regras de comissão', enableSorting: false },
  { id: 'actions', header: '', enableSorting: false }
]

// ─── Create / Edit ─────────────────────────────────────────────────────────
const showFormModal = ref(false)
const selectedCategory = ref<ProductCategory | null>(null)

function openCreate() {
  selectedCategory.value = null
  showFormModal.value = true
}
function openEdit(category: ProductCategory) {
  selectedCategory.value = category
  showFormModal.value = true
}
async function onSaved() {
  showFormModal.value = false
  selectedCategory.value = null
  await refresh()
}

// ─── Delete ──────────────────────────────────────────────────────────────────
const isDeleting = ref(false)
const showDeleteModal = ref(false)
const categoryPendingDeletion = ref<ProductCategory | null>(null)

function requestRemove(category: ProductCategory) {
  if (isDeleting.value || category.products_count > 0 || category.commission_rules_count > 0) return
  categoryPendingDeletion.value = category
  showDeleteModal.value = true
}

async function confirmRemove() {
  if (!categoryPendingDeletion.value || isDeleting.value) return
  isDeleting.value = true
  try {
    await $fetch(`/api/product-categories/${categoryPendingDeletion.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Categoria removida', color: 'success' })
    showDeleteModal.value = false
    categoryPendingDeletion.value = null
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível remover a categoria', color: 'error' })
  } finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Categorias de produtos" />
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar categorias de produtos.
        </p>
      </div>

      <div v-else class="space-y-4 p-4">
        <p class="text-sm text-muted">
          Categorias usadas para organizar produtos e definir regras de comissão em Financeiro &gt; Comissões.
        </p>

        <AppDataTable
          v-model:search-term="search"
          v-model:page="page"
          v-model:page-size="pageSize"
          :columns="columns"
          :data="paginatedCategories as Record<string, unknown>[]"
          :total="filteredCategories.length"
          :loading="status === 'pending'"
          :show-search="true"
          search-placeholder="Buscar categoria..."
          empty-icon="i-lucide-tags"
          empty-title="Nenhuma categoria encontrada"
          empty-description="Crie uma categoria para começar a organizar seus produtos."
        >
          <template #toolbar-right>
            <UButton
              v-if="canCreate"
              label="Nova categoria"
              icon="i-lucide-plus"
              size="sm"
              @click="openCreate"
            />
          </template>

          <template #name-cell="{ row }">
            <div class="min-w-0">
              <p class="font-medium text-highlighted">
                {{ (row.original as ProductCategory).name }}
              </p>
              <p v-if="(row.original as ProductCategory).description" class="truncate text-xs text-muted">
                {{ (row.original as ProductCategory).description }}
              </p>
            </div>
          </template>

          <template #products-cell="{ row }">
            <UBadge
              :label="String((row.original as ProductCategory).products_count)"
              color="neutral"
              variant="subtle"
              size="sm"
            />
          </template>

          <template #commissions-cell="{ row }">
            <UBadge
              :label="String((row.original as ProductCategory).commission_rules_count)"
              :color="(row.original as ProductCategory).commission_rules_count > 0 ? 'info' : 'neutral'"
              variant="subtle"
              size="sm"
            />
          </template>

          <template #actions-cell="{ row }">
            <div class="flex items-center justify-end gap-2">
              <UButton
                v-if="canUpdate"
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="openEdit(row.original as ProductCategory)"
              />
              <UTooltip
                :text="
                  (row.original as ProductCategory).products_count > 0 || (row.original as ProductCategory).commission_rules_count > 0
                    ? 'Categoria em uso — remova produtos e regras de comissão vinculados antes de excluir'
                    : 'Excluir categoria'
                "
              >
                <UButton
                  v-if="canDelete"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :disabled="(row.original as ProductCategory).products_count > 0 || (row.original as ProductCategory).commission_rules_count > 0"
                  @click="requestRemove(row.original as ProductCategory)"
                />
              </UTooltip>
            </div>
          </template>
        </AppDataTable>
      </div>
    </template>
  </UDashboardPanel>

  <ProductsCategoriesFormModal
    v-model:open="showFormModal"
    :category="selectedCategory"
    @saved="onSaved"
  />

  <AppConfirmModal
    v-model:open="showDeleteModal"
    title="Excluir categoria"
    confirm-label="Excluir categoria"
    confirm-color="error"
    :loading="isDeleting"
    @confirm="confirmRemove"
    @update:open="(value: boolean) => { showDeleteModal = value; if (!value && !isDeleting) categoryPendingDeletion = null }"
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir a categoria
        <strong class="text-highlighted">{{ categoryPendingDeletion?.name ?? 'esta categoria' }}</strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>
</template>
