<script setup lang="ts">
import { ActionCode } from '~/constants/action-codes'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Categorias Financeiras' })

type Category = {
  id: string
  name: string
  type: 'income' | 'expense'
  icon: string
  color: string
  is_default: boolean
  usage_count: number
}

type CategoriesResponse = {
  defaults: Category[]
  custom: Category[]
}

const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const canRead = computed(() => workshop.can(ActionCode.FINANCIAL_READ))
const canUpdate = computed(() => workshop.can(ActionCode.FINANCIAL_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.FINANCIAL_DELETE))

const activeType = ref<'income' | 'expense'>('expense')
const search = ref('')

const { data, status, refresh } = await useAsyncData(
  'financial-categories-crud',
  async () => {
    if (!canRead.value) return { defaults: [], custom: [] } satisfies CategoriesResponse
    return requestFetch<CategoriesResponse>('/api/financial/categories', {
      headers: requestHeaders,
      query: { includeUsage: 'true' }
    })
  },
  { default: () => ({ defaults: [], custom: [] }) }
)

const allCategories = computed<Category[]>(() => [...(data.value?.defaults ?? []), ...(data.value?.custom ?? [])])

const filteredCategories = computed(() => {
  const term = search.value.trim().toLowerCase()
  return allCategories.value
    .filter(c => c.type === activeType.value)
    .filter(c => !term || c.name.toLowerCase().includes(term))
    .sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1
      return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
    })
})

const columns = [
  { accessorKey: 'name', header: 'Nome', enableSorting: false },
  { id: 'origin', header: 'Origem', enableSorting: false },
  { id: 'usage', header: 'Em uso', enableSorting: false },
  { id: 'actions', header: '', enableSorting: false }
]

// ─── Create / Edit ─────────────────────────────────────────────────────────
const showFormModal = ref(false)
const selectedCategory = ref<Category | null>(null)

function openCreate() {
  selectedCategory.value = null
  showFormModal.value = true
}
function openEdit(category: Category) {
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
const categoryPendingDeletion = ref<Category | null>(null)

function requestRemove(category: Category) {
  if (isDeleting.value) return
  categoryPendingDeletion.value = category
  showDeleteModal.value = true
}

async function confirmRemove() {
  if (!categoryPendingDeletion.value || isDeleting.value) return
  isDeleting.value = true
  try {
    await $fetch(`/api/financial/categories/${categoryPendingDeletion.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Categoria removida', color: 'success' })
    showDeleteModal.value = false
    categoryPendingDeletion.value = null
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível remover', color: 'error' })
  } finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Categorias Financeiras" />
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar categorias financeiras.
        </p>
      </div>

      <div v-else class="space-y-4 p-4">
        <!-- Tipo toggle -->
        <div class="flex w-full max-w-xs overflow-hidden rounded-lg border border-default">
          <button
            type="button"
            class="flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium transition-colors focus:outline-none"
            :class="activeType === 'income' ? 'bg-success/10 text-success' : 'text-muted hover:bg-elevated'"
            @click="activeType = 'income'"
          >
            <UIcon name="i-lucide-trending-up" class="size-4" />
            Entrada
          </button>
          <div class="w-px bg-border" />
          <button
            type="button"
            class="flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium transition-colors focus:outline-none"
            :class="activeType === 'expense' ? 'bg-error/10 text-error' : 'text-muted hover:bg-elevated'"
            @click="activeType = 'expense'"
          >
            <UIcon name="i-lucide-trending-down" class="size-4" />
            Saída
          </button>
        </div>

        <AppDataTable
          v-model:search-term="search"
          :columns="columns"
          :data="filteredCategories as Record<string, unknown>[]"
          :loading="status === 'pending'"
          :show-search="true"
          search-placeholder="Buscar categoria..."
          empty-icon="i-lucide-tag"
          empty-title="Nenhuma categoria encontrada"
          empty-description="Crie uma categoria personalizada para começar."
        >
          <template #toolbar-right>
            <UButton
              v-if="canUpdate"
              label="Nova categoria"
              icon="i-lucide-plus"
              size="sm"
              @click="openCreate"
            />
          </template>

          <template #name-cell="{ row }">
            <div class="flex items-center gap-3">
              <div
                class="flex size-8 shrink-0 items-center justify-center rounded-full"
                :class="`bg-${(row.original as Category).color}/10`"
              >
                <UIcon :name="(row.original as Category).icon" class="size-4" :class="`text-${(row.original as Category).color}`" />
              </div>
              <p class="font-medium text-highlighted">
                {{ (row.original as Category).name }}
              </p>
            </div>
          </template>

          <template #origin-cell="{ row }">
            <UBadge
              :label="(row.original as Category).is_default ? 'Padrão' : 'Personalizada'"
              :color="(row.original as Category).is_default ? 'neutral' : 'primary'"
              variant="subtle"
              size="sm"
            />
          </template>

          <template #usage-cell="{ row }">
            <span class="text-sm text-muted">
              {{ (row.original as Category).usage_count }} lançamento{{ (row.original as Category).usage_count !== 1 ? 's' : '' }}
            </span>
          </template>

          <template #actions-cell="{ row }">
            <div class="flex items-center justify-end gap-2">
              <UTooltip :text="(row.original as Category).is_default ? 'Categorias padrão não podem ser editadas' : 'Editar categoria'">
                <UButton
                  v-if="canUpdate"
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :disabled="(row.original as Category).is_default"
                  @click="openEdit(row.original as Category)"
                />
              </UTooltip>
              <UTooltip
                :text="(row.original as Category).is_default
                  ? 'Categorias padrão não podem ser removidas'
                  : (row.original as Category).usage_count > 0
                    ? 'Categoria em uso não pode ser removida'
                    : 'Remover categoria'"
              >
                <UButton
                  v-if="canDelete"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :disabled="(row.original as Category).is_default || (row.original as Category).usage_count > 0"
                  @click="requestRemove(row.original as Category)"
                />
              </UTooltip>
            </div>
          </template>
        </AppDataTable>
      </div>
    </template>
  </UDashboardPanel>

  <FinancialCategoriesFormModal
    v-model:open="showFormModal"
    :category="selectedCategory"
    :active-type="activeType"
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
        <strong class="text-highlighted">{{ categoryPendingDeletion?.name || 'esta categoria' }}</strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>
</template>
