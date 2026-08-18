<script setup lang="ts">
interface ProductCategory {
  id: string
  name: string
  description: string | null
}

const props = defineProps<{
  open: boolean
  category: ProductCategory | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()
const isSaving = ref(false)
const isEditing = computed(() => props.category !== null)

const form = reactive({
  name: '',
  description: ''
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    form.name = props.category?.name ?? ''
    form.description = props.category?.description ?? ''
  },
  { immediate: true }
)

async function save() {
  if (isSaving.value) return
  if (!form.name.trim()) {
    toast.add({ title: 'Informe o nome da categoria', color: 'warning' })
    return
  }

  isSaving.value = true
  try {
    const body = { name: form.name.trim(), description: form.description.trim() || null }

    if (isEditing.value && props.category) {
      await $fetch(`/api/product-categories/${props.category.id}`, { method: 'PUT', body })
      toast.add({ title: 'Categoria atualizada', color: 'success' })
    } else {
      await $fetch('/api/product-categories', { method: 'POST', body })
      toast.add({ title: 'Categoria criada', color: 'success' })
    }
    emit('saved')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível salvar a categoria', color: 'error' })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="isEditing ? 'Editar categoria' : 'Nova categoria'"
    description="Categorias organizam produtos no catálogo e definem onde as regras de comissão se aplicam."
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Nome" required>
          <UInput v-model="form.name" class="w-full" placeholder="Ex: Peças, Pneus, Serviços" />
        </UFormField>
        <UFormField label="Descrição">
          <UTextarea
            v-model="form.description"
            class="w-full"
            :rows="2"
            placeholder="Opcional"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          :disabled="isSaving"
          @click="emit('update:open', false)"
        />
        <UButton
          label="Salvar categoria"
          icon="i-lucide-check"
          color="neutral"
          :loading="isSaving"
          :disabled="isSaving"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
