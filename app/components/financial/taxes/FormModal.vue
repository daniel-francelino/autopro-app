<script setup lang="ts">
import type { Tax } from '~/types/financial'

const props = defineProps<{
  open: boolean
  tax: Tax | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()
const isSaving = ref(false)

const isEditing = computed(() => !!props.tax?.id)

const form = reactive({
  name: '',
  type: '',
  rate: '' as string | number
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    if (props.tax) {
      Object.assign(form, {
        name: props.tax.name ?? '',
        type: props.tax.type ?? '',
        rate: props.tax.rate ?? ''
      })
    } else {
      Object.assign(form, { name: '', type: '', rate: '' })
    }
  },
  { immediate: true }
)

async function save() {
  if (isSaving.value) return
  if (!form.name.trim()) {
    toast.add({ title: 'Nome é obrigatório', color: 'warning' })
    return
  }
  if (!form.type) {
    toast.add({ title: 'Tipo é obrigatório', color: 'warning' })
    return
  }
  if (form.rate === '' || form.rate === null) {
    toast.add({ title: 'Alíquota é obrigatória', color: 'warning' })
    return
  }
  isSaving.value = true
  try {
    const body = {
      name: form.name.trim(),
      type: form.type,
      rate: Number(form.rate)
    }
    if (isEditing.value) {
      await $fetch(`/api/taxes/${props.tax!.id}`, { method: 'PUT', body })
      toast.add({ title: 'Imposto atualizado', color: 'success' })
    } else {
      await $fetch('/api/taxes', { method: 'POST', body })
      toast.add({ title: 'Imposto criado', color: 'success' })
    }
    emit('update:open', false)
    emit('saved')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível salvar', color: 'error' })
  } finally {
    isSaving.value = false
  }
}

const taxTypeOptions = [
  { label: 'Municipal', value: 'municipal' },
  { label: 'Estadual', value: 'state' },
  { label: 'Federal', value: 'federal' },
  { label: 'Outro', value: 'other' }
]
</script>

<template>
  <UModal
    :open="open"
    :title="isEditing ? 'Editar imposto' : 'Novo imposto'"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Nome" required>
          <UInput v-model="form.name" class="w-full" />
        </UFormField>
        <UFormField label="Tipo" required>
          <USelectMenu
            v-model="form.type"
            :items="taxTypeOptions"
            value-key="value"
            class="w-full"
            placeholder="Selecionar..."
          />
        </UFormField>
        <UFormField label="Alíquota (%)" required>
          <UInput
            v-model.number="form.rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          @click="emit('update:open', false)"
        />
        <UButton
          label="Salvar"
          color="neutral"
          :loading="isSaving"
          :disabled="isSaving"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
