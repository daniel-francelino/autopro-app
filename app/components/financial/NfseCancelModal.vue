<script setup lang="ts">
import type { NfseRow } from '~/types/nfse'

const props = defineProps<{
  open: boolean
  nfse: NfseRow | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'cancelled': []
}>()

const toast = useToast()
const justification = ref('')
const isCancelling = ref(false)

watch(() => props.open, (val) => {
  if (val) justification.value = ''
})

async function confirm() {
  if (!props.nfse || isCancelling.value) return
  isCancelling.value = true
  try {
    await $fetch(`/api/fiscal/nfse/${encodeURIComponent(props.nfse.provider_reference)}`, {
      method: 'DELETE',
      body: justification.value.trim() ? { justification: justification.value.trim() } : {}
    })
    toast.add({ title: 'NFS-e cancelada com sucesso', color: 'success' })
    emit('update:open', false)
    emit('cancelled')
  } catch (err: unknown) {
    const fetchError = err as { data?: { data?: { error?: string }, statusMessage?: string } } | null
    toast.add({
      title: 'Erro ao cancelar NFS-e',
      description: fetchError?.data?.data?.error || fetchError?.data?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isCancelling.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Cancelar NFS-e"
    :ui="{ overlay: 'z-30', content: 'z-40' }"
    @update:open="(v) => !v && !isCancelling && $emit('update:open', false)"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          Esta ação é irreversível. A NFS-e
          <span class="font-mono font-semibold text-highlighted">{{ nfse?.provider_reference }}</span>
          será cancelada junto à prefeitura.
        </p>
        <UFormField label="Justificativa (opcional)" hint="15–255 caracteres se informada">
          <UTextarea
            v-model="justification"
            placeholder="Ex: Serviço não foi prestado..."
            :rows="3"
            class="w-full"
          />
        </UFormField>
        <div class="flex justify-end gap-3">
          <UButton
            label="Voltar"
            color="neutral"
            variant="ghost"
            :disabled="isCancelling"
            @click="$emit('update:open', false)"
          />
          <UButton
            label="Confirmar cancelamento"
            color="error"
            :loading="isCancelling"
            @click="confirm"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
