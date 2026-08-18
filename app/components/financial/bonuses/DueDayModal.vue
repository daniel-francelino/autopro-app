<script setup lang="ts">
const props = defineProps<{
  open: boolean
  bonusId: string
  currentDueDay: number | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()
const isSaving = ref(false)
const dueDay = ref<number | string>('')

watch(
  () => props.open,
  (open) => {
    if (open) dueDay.value = props.currentDueDay ?? ''
  },
  { immediate: true }
)

async function save() {
  if (isSaving.value) return

  const value = dueDay.value === '' ? null : Number(dueDay.value)
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 31)) {
    toast.add({ title: 'Dia de vencimento deve ser um número inteiro entre 1 e 31', color: 'warning' })
    return
  }

  isSaving.value = true
  try {
    await $fetch(`/api/bonuses/${props.bonusId}`, { method: 'PUT', body: { dueDay: value } })
    toast.add({ title: 'Dia de vencimento atualizado', color: 'success' })
    emit('saved')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível atualizar o dia de vencimento', color: 'error' })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Dia de vencimento"
    description="Dia do mês em que um bônus gerado fica com vencimento. Se o mês não tiver esse dia, usa o último dia do mês."
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <UFormField label="Dia de vencimento" hint="Deixe em branco para usar sempre o último dia do mês">
        <UInput
          v-model="dueDay"
          type="number"
          min="1"
          max="31"
          placeholder="Ex: 5"
          class="w-full"
        />
      </UFormField>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="ghost"
          :disabled="isSaving"
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
