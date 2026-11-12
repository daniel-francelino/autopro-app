<script setup lang="ts">
import type { MasterProductItem } from '~/types/service-orders'

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  editProduct: MasterProductItem | null
}>()

const emit = defineEmits<{
  'update:open': [v: boolean]
  'saved': [product: MasterProductItem]
}>()

const toast = useToast()
const isSaving = ref(false)

const form = reactive({ name: '', description: '', notes: '' })

watch(
  () => props.open,
  (opened) => {
    if (!opened) return
    form.name = props.editProduct?.name ?? ''
    form.description = props.editProduct?.description ?? ''
    form.notes = props.editProduct?.notes ?? ''
  }
)

async function save() {
  if (isSaving.value) return
  if (!form.name.trim()) {
    toast.add({ title: 'Nome do produto master é obrigatório', color: 'warning' })
    return
  }

  isSaving.value = true
  try {
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      notes: form.notes.trim() || null
    }

    const res = props.mode === 'create'
      ? await $fetch<{ item: MasterProductItem }>('/api/master-products', { method: 'POST', body })
      : await $fetch<{ item: MasterProductItem }>(`/api/master-products/${props.editProduct!.id}`, { method: 'PUT', body })

    toast.add({
      title: props.mode === 'create' ? 'Produto master criado' : 'Produto master atualizado',
      color: 'success'
    })
    emit('saved', res.item)
    emit('update:open', false)
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao salvar produto master',
      description: err?.data?.statusMessage || err?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="mode === 'create' ? 'Novo produto master' : 'Editar produto master'"
    :ui="{ body: 'overflow-y-auto max-h-[75vh]' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Nome" required>
          <UInput v-model="form.name" class="w-full" />
        </UFormField>
        <UFormField label="Descrição">
          <UTextarea v-model="form.description" :rows="3" class="w-full" />
        </UFormField>
        <UFormField label="Observações">
          <UTextarea v-model="form.notes" :rows="3" class="w-full" />
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
          @click="emit('update:open', false)"
        />
        <UButton
          :label="mode === 'create' ? 'Criar' : 'Salvar'"
          icon="i-lucide-save"
          :loading="isSaving"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
