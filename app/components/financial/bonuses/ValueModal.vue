<script setup lang="ts">
const props = defineProps<{
  open: boolean
  bonusId: string
  currentValue: {
    commissionBase: 'revenue' | 'profit'
    goalAmount: number
    bonusAmount: number
  } | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()
const isSaving = ref(false)

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const form = reactive({
  commissionBase: 'revenue' as 'revenue' | 'profit',
  goalAmount: '' as number | string,
  bonusAmount: '' as number | string,
  effectiveMonth: currentMonthValue()
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    form.commissionBase = props.currentValue?.commissionBase ?? 'revenue'
    form.goalAmount = props.currentValue?.goalAmount ?? ''
    form.bonusAmount = props.currentValue?.bonusAmount ?? ''
    form.effectiveMonth = currentMonthValue()
  },
  { immediate: true }
)

const commissionBaseOptions = [
  { label: 'Faturamento (valor bruto)', value: 'revenue' },
  { label: 'Lucro (receita − custos)', value: 'profit' }
]

async function save() {
  if (isSaving.value) return

  const goalAmount = Number(form.goalAmount)
  const bonusAmount = Number(form.bonusAmount)
  if (!goalAmount || goalAmount <= 0) {
    toast.add({ title: 'Informe a meta a bater', color: 'warning' })
    return
  }
  if (!bonusAmount || bonusAmount <= 0) {
    toast.add({ title: 'Informe o valor do bônus', color: 'warning' })
    return
  }

  isSaving.value = true
  try {
    await $fetch(`/api/bonuses/${props.bonusId}/value-versions`, {
      method: 'POST',
      body: {
        commissionBase: form.commissionBase,
        goalAmount,
        bonusAmount,
        effectiveFrom: `${form.effectiveMonth}-01`
      }
    })
    toast.add({ title: 'Novo valor cadastrado', color: 'success' })
    emit('saved')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível salvar o novo valor', color: 'error' })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Alterar valor do bônus"
    description="Isso cria uma nova versão do valor — o histórico do valor anterior é preservado, nunca sobrescrito."
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Base de cálculo" required>
          <USelectMenu
            v-model="form.commissionBase"
            :items="commissionBaseOptions"
            value-key="value"
            class="w-full"
          />
        </UFormField>

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Meta a bater" required>
            <UiCurrencyInput v-model="form.goalAmount" />
          </UFormField>
          <UFormField label="Valor do bônus" required>
            <UiCurrencyInput v-model="form.bonusAmount" />
          </UFormField>
        </div>

        <UFormField label="Vale a partir de" required>
          <input
            v-model="form.effectiveMonth"
            type="month"
            class="h-9 w-full rounded-md border border-default bg-default px-3 text-sm text-highlighted outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
        </UFormField>
      </div>
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
          label="Salvar novo valor"
          color="neutral"
          :loading="isSaving"
          :disabled="isSaving"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
