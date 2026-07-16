<script setup lang="ts">
import { ActionCode } from '~/constants/action-codes'
import { formatCategoryName } from '~/utils/financial-category-options'

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
    .filter(c => !term || c.name.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
})

const typeLabel: Record<Category['type'], string> = { income: 'Entrada', expense: 'Saída' }
const typeIcon: Record<Category['type'], string> = { income: 'i-lucide-trending-up', expense: 'i-lucide-trending-down' }
const typeColor: Record<Category['type'], 'success' | 'error'> = { income: 'success', expense: 'error' }

const columns = [
  { accessorKey: 'name', header: 'Nome', enableSorting: false },
  { id: 'type', header: 'Tipo', enableSorting: false },
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

// Migration
const isMigrating = ref(false)
const showMigrationModal = ref(false)
const categoryPendingMigration = ref<Category | null>(null)
const migrationTargetId = ref('')

const migrationTargetOptions = computed(() => {
  if (!categoryPendingMigration.value) return []
  return allCategories.value
    .filter(category =>
      category.id !== categoryPendingMigration.value?.id
      && category.type === categoryPendingMigration.value?.type
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
    .map(category => ({
      label: `${formatCategoryName(category.name)} (${category.is_default ? 'Padrao' : 'Personalizada'})`,
      value: category.id
    }))
})

function requestMigration(category: Category) {
  if (isMigrating.value || category.usage_count === 0) return
  categoryPendingMigration.value = category
  migrationTargetId.value = ''
  showMigrationModal.value = true
}

async function confirmMigration() {
  if (!categoryPendingMigration.value || isMigrating.value) return
  if (!migrationTargetId.value) {
    toast.add({ title: 'Selecione a categoria de destino', color: 'warning' })
    return
  }

  isMigrating.value = true
  try {
    const result = await $fetch<{ migrated: number }>(
      `/api/financial/categories/${categoryPendingMigration.value.id}/migrate`,
      {
        method: 'POST',
        body: { target_category_id: migrationTargetId.value }
      }
    )
    toast.add({
      title: 'Itens migrados',
      description: `${result.migrated} lancamento${result.migrated !== 1 ? 's' : ''} movido${result.migrated !== 1 ? 's' : ''}.`,
      color: 'success'
    })
    showMigrationModal.value = false
    categoryPendingMigration.value = null
    migrationTargetId.value = ''
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Nao foi possivel migrar os itens', color: 'error' })
  } finally {
    isMigrating.value = false
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
                :style="{ backgroundColor: `${(row.original as Category).color}1A` }"
              >
                <UIcon :name="(row.original as Category).icon" class="size-4" :style="{ color: (row.original as Category).color }" />
              </div>
              <p class="font-medium text-highlighted">
                {{ formatCategoryName((row.original as Category).name) }}
              </p>
            </div>
          </template>

          <template #type-cell="{ row }">
            <UBadge
              :label="typeLabel[(row.original as Category).type]"
              :icon="typeIcon[(row.original as Category).type]"
              :color="typeColor[(row.original as Category).type]"
              variant="subtle"
              size="sm"
            />
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
            <UTooltip
              :text="`${(row.original as Category).usage_count} lançamento${(row.original as Category).usage_count !== 1 ? 's' : ''}`"
            >
              <span
                class="inline-block size-2.5 rounded-full"
                :class="(row.original as Category).usage_count > 0 ? 'bg-success' : 'bg-error'"
              />
            </UTooltip>
          </template>

          <template #actions-cell="{ row }">
            <div class="flex items-center justify-end gap-2">
              <UTooltip :text="(row.original as Category).usage_count > 0 ? 'Migrar itens para outra categoria' : 'Categoria sem itens para migrar'">
                <UButton
                  v-if="canUpdate"
                  icon="i-lucide-arrow-right-left"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :disabled="(row.original as Category).usage_count === 0"
                  @click="requestMigration(row.original as Category)"
                />
              </UTooltip>
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
              <UButton
                v-if="canDelete && (row.original as Category).usage_count === 0"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                @click="requestRemove(row.original as Category)"
              />
            </div>
          </template>
        </AppDataTable>
      </div>
    </template>
  </UDashboardPanel>

  <FinancialCategoriesFormModal
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
        <strong class="text-highlighted">{{ categoryPendingDeletion ? formatCategoryName(categoryPendingDeletion.name) : 'esta categoria' }}</strong>?
        Esta ação não pode ser desfeita.
      </p>
    </template>
  </AppConfirmModal>

  <UModal
    :open="showMigrationModal"
    title="Migrar itens"
    description="Mova todos os lancamentos desta categoria para outra categoria do mesmo tipo."
    :ui="{ overlay: 'z-30', content: 'z-40' }"
    @update:open="(value: boolean) => { showMigrationModal = value; if (!value && !isMigrating) { categoryPendingMigration = null; migrationTargetId = '' } }"
  >
    <template #body>
      <div class="space-y-4">
        <div class="rounded-lg border border-default p-3">
          <p class="text-xs text-muted">
            Categoria de origem
          </p>
          <div class="mt-2 flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-3">
              <div
                v-if="categoryPendingMigration"
                class="flex size-8 shrink-0 items-center justify-center rounded-full"
                :style="{ backgroundColor: `${categoryPendingMigration.color}1A` }"
              >
                <UIcon :name="categoryPendingMigration.icon" class="size-4" :style="{ color: categoryPendingMigration.color }" />
              </div>
              <p class="truncate text-sm font-medium text-highlighted">
                {{ categoryPendingMigration ? formatCategoryName(categoryPendingMigration.name) : 'Categoria' }}
              </p>
            </div>
            <UBadge
              :label="`${categoryPendingMigration?.usage_count ?? 0} item${(categoryPendingMigration?.usage_count ?? 0) !== 1 ? 's' : ''}`"
              color="neutral"
              variant="subtle"
              size="sm"
            />
          </div>
        </div>

        <UFormField label="Categoria de destino" required>
          <USelectMenu
            v-model="migrationTargetId"
            :items="migrationTargetOptions"
            value-key="value"
            searchable
            placeholder="Selecione a categoria"
            class="w-full"
            :disabled="isMigrating || migrationTargetOptions.length === 0"
          />
        </UFormField>

        <p class="text-sm text-muted">
          Apenas a quantidade de itens e mostrada aqui. A migracao roda em lotes no servidor para evitar falhas em categorias com muitos lancamentos.
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          :disabled="isMigrating"
          @click="showMigrationModal = false"
        />
        <UButton
          label="Migrar itens"
          color="neutral"
          :loading="isMigrating"
          :disabled="isMigrating || !migrationTargetId"
          @click="confirmMigration"
        />
      </div>
    </template>
  </UModal>
</template>
