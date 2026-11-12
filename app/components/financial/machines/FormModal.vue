<script setup lang="ts">
import type { PaymentTerminal as Terminal } from '~/types/financial'

const props = defineProps<{
  open: boolean
  terminal: Terminal | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()
const isSaving = ref(false)

const isEditing = computed(() => !!props.terminal?.id)

const form = reactive({
  terminal_name: '',
  provider_company: '',
  payment_receipt_days: '' as string | number,
  is_active: true
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    if (props.terminal) {
      Object.assign(form, {
        terminal_name: props.terminal.terminal_name ?? '',
        provider_company: props.terminal.provider_company ?? '',
        payment_receipt_days: props.terminal.payment_receipt_days ?? '',
        is_active: props.terminal.is_active ?? true
      })
    } else {
      Object.assign(form, {
        terminal_name: '',
        provider_company: '',
        payment_receipt_days: '',
        is_active: true
      })
    }
  },
  { immediate: true }
)

async function save() {
  if (isSaving.value) return
  if (!form.terminal_name.trim()) {
    toast.add({ title: 'Nome é obrigatório', color: 'warning' })
    return
  }
  isSaving.value = true
  try {
    const body = {
      terminal_name: form.terminal_name.trim(),
      provider_company: form.provider_company || null,
      payment_receipt_days: form.payment_receipt_days !== '' ? Number(form.payment_receipt_days) : null,
      is_active: form.is_active
    }
    if (isEditing.value) {
      await $fetch(`/api/payment-terminals/${props.terminal!.id}`, { method: 'PUT', body })
      toast.add({ title: 'Maquininha atualizada', color: 'success' })
    } else {
      await $fetch('/api/payment-terminals', { method: 'POST', body })
      toast.add({ title: 'Maquininha cadastrada', color: 'success' })
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
</script>

<template>
  <UModal
    :open="open"
    :title="isEditing ? 'Editar maquininha' : 'Nova maquininha'"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Nome" required>
          <UInput v-model="form.terminal_name" class="w-full" placeholder="Ex: Maquininha Recepção" />
        </UFormField>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="Operadora">
            <UInput v-model="form.provider_company" class="w-full" placeholder="Ex: Stone, Cielo, PagSeguro" />
          </UFormField>
          <UFormField label="Prazo de recebimento (dias)">
            <UInput
              v-model.number="form.payment_receipt_days"
              type="number"
              min="0"
              class="w-full"
            />
          </UFormField>
        </div>
        <UCheckbox v-model="form.is_active" label="Ativa" />
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
