<script setup lang="ts">
import type { NfseRow } from '~/types/nfse'

const props = defineProps<{
  open: boolean
  nfse: NfseRow | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'sent': []
}>()

const toast = useToast()
const emailList = ref('')
const isSending = ref(false)

watch(() => props.open, (val) => {
  if (val) emailList.value = ''
})

async function send() {
  if (!props.nfse || isSending.value) return
  const emails = emailList.value.split(/[\n,;]/).map(e => e.trim()).filter(Boolean)
  if (!emails.length) {
    toast.add({ title: 'Informe ao menos um e-mail', color: 'warning' })
    return
  }
  isSending.value = true
  try {
    await $fetch(`/api/fiscal/nfse/${encodeURIComponent(props.nfse.provider_reference)}/email`, {
      method: 'POST',
      body: { emails }
    })
    toast.add({ title: 'E-mail reenviado com sucesso', color: 'success' })
    emit('update:open', false)
    emit('sent')
  } catch (err: unknown) {
    const fetchError = err as { data?: { data?: { error?: string }, statusMessage?: string } } | null
    toast.add({
      title: 'Erro ao reenviar e-mail',
      description: fetchError?.data?.data?.error || fetchError?.data?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    isSending.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Reenviar NFS-e por e-mail"
    :ui="{ overlay: 'z-30', content: 'z-40' }"
    @update:open="(v) => !v && !isSending && $emit('update:open', false)"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          Informe os e-mails que receberão a NFS-e
          <span class="font-mono font-semibold text-highlighted">{{ nfse?.provider_reference }}</span>.
          Separe múltiplos e-mails por vírgula ou linha.
        </p>
        <UFormField label="E-mails destinatários">
          <UTextarea
            v-model="emailList"
            placeholder="cliente@email.com, outro@email.com"
            :rows="3"
            class="w-full"
          />
        </UFormField>
        <div class="flex justify-end gap-3">
          <UButton
            label="Cancelar"
            color="neutral"
            variant="ghost"
            :disabled="isSending"
            @click="$emit('update:open', false)"
          />
          <UButton
            label="Enviar"
            icon="i-lucide-send"
            :loading="isSending"
            @click="send"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
