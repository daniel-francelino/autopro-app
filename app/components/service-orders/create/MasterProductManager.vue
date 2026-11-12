<script setup lang="ts">
import { ActionCode } from '~/constants/action-codes'

interface MasterProductItem {
  id: string
  name: string
  description?: string | null
  notes?: string | null
}

const props = defineProps<{
  open: boolean
  products: MasterProductItem[]
  selectedMasterProductId: string
}>()

const emit = defineEmits<{
  'update:open': [v: boolean]
  'select': [id: string]
  'openCreate': []
  'openEdit': [product: MasterProductItem]
  'deleted': [id: string]
}>()

const toast = useToast()
const workshop = useWorkshopPermissions()
const canCreate = computed(() => workshop.can(ActionCode.ORDERS_CREATE))
const canUpdate = computed(() => workshop.can(ActionCode.ORDERS_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.ORDERS_DELETE))
const search = ref('')
const pendingDelete = ref<MasterProductItem | null>(null)
const isDeleting = ref(false)

const isDeleteModalOpen = computed({
  get: () => !!pendingDelete.value,
  set: (v: boolean) => { if (!v && !isDeleting.value) pendingDelete.value = null }
})

const filteredProducts = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return props.products
  return props.products.filter(p =>
    [p.name, p.description ?? '', p.notes ?? ''].join(' ').toLowerCase().includes(term)
  )
})

async function confirmDelete() {
  if (!pendingDelete.value || isDeleting.value) return
  isDeleting.value = true
  try {
    await $fetch(`/api/master-products/${pendingDelete.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Produto master removido', color: 'success' })
    emit('deleted', pendingDelete.value.id)
    pendingDelete.value = null
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao remover produto master',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isDeleting.value = false
  }
}

function handleSelect(id: string) {
  emit('select', id)
  emit('update:open', false)
}

watch(() => props.open, (opened) => {
  if (opened) search.value = ''
})
</script>

<template>
  <UModal
    :open="open"
    title="Gerenciar produtos master"
    :ui="{ body: 'overflow-y-auto max-h-[75vh]' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <div class="flex flex-col gap-3 sm:flex-row">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            placeholder="Buscar produto master..."
            class="w-full"
          />
          <UButton
            v-if="canCreate"
            label="Novo"
            icon="i-lucide-plus"
            color="neutral"
            variant="outline"
            @click="emit('openCreate')"
          />
        </div>

        <div
          v-if="!filteredProducts.length"
          class="rounded-xl border border-dashed border-default bg-elevated/40 px-4 py-8 text-center"
        >
          <UIcon name="i-lucide-box" class="mx-auto size-8 text-dimmed" />
          <p class="mt-3 text-sm font-medium text-highlighted">
            Nenhum produto master encontrado
          </p>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="product in filteredProducts"
            :key="product.id"
            class="rounded-xl border border-default bg-default p-4 shadow-xs"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0 flex-1">
                <p class="truncate font-semibold text-highlighted">
                  {{ product.name }}
                </p>
                <p v-if="product.description" class="mt-1 text-sm text-muted">
                  {{ product.description }}
                </p>
                <p v-if="product.notes" class="mt-2 text-xs text-dimmed">
                  {{ product.notes }}
                </p>
              </div>
              <div class="flex items-center gap-1">
                <UButton
                  icon="i-lucide-check"
                  color="success"
                  variant="ghost"
                  square
                  @click="handleSelect(product.id)"
                />
                <UButton
                  v-if="canUpdate"
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  square
                  @click="emit('openEdit', product)"
                />
                <UButton
                  v-if="canDelete"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  square
                  @click="pendingDelete = product"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UModal>

  <AppConfirmModal
    v-model:open="isDeleteModalOpen"
    title="Excluir produto master"
    confirm-label="Excluir"
    confirm-color="error"
    :loading="isDeleting"
    @confirm="confirmDelete"
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir o produto master
        <strong class="text-highlighted">{{ pendingDelete?.name ?? '' }}</strong>?
      </p>
    </template>
  </AppConfirmModal>
</template>
