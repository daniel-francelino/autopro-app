<script setup lang="ts">
const props = defineProps<{
  open: boolean
  bonusId: string
  currentValue: {
    commissionBase: 'revenue' | 'profit' | 'revenue_minus_parts' | 'employee_net_profit'
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
  commissionBase: 'revenue' as 'revenue' | 'profit' | 'revenue_minus_parts' | 'employee_net_profit',
  goalAmount: '' as number | string,
  bonusAmount: '' as number | string,
  effectiveMonth: currentMonthValue() as string | undefined
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
  {
    label: 'Faturamento (valor bruto)',
    value: 'revenue',
    description: 'Soma o valor total das OS concluídas ou faturadas.',
    formula: 'Faturamento'
  },
  {
    label: 'Lucro (receita - custos)',
    value: 'profit',
    description: 'Soma o valor total das OS concluídas ou faturadas, descontando os custos das peças.',
    formula: 'Faturamento - custos das peças'
  },
  {
    label: 'Faturamento menos peças',
    value: 'revenue_minus_parts',
    description: 'Soma o faturamento líquido de peças das OS concluídas ou faturadas.',
    formula: 'Faturamento - custos das peças'
  },
  {
    label: 'Lucro líquido do funcionário',
    value: 'employee_net_profit',
    description: 'Soma o resultado das OS concluídas ou faturadas, descontando peças e apenas a comissão deste funcionário.',
    formula: 'Faturamento - custos das peças - comissão do funcionário'
  }
]

const selectedCommissionBase = computed(() =>
  commissionBaseOptions.find(option => option.value === form.commissionBase) ?? commissionBaseOptions[0]!
)

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
  if (!form.effectiveMonth) {
    toast.add({ title: 'Informe a partir de qual mês o novo valor vale', color: 'warning' })
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
          <div class="mt-2 rounded-md border border-default bg-muted/30 px-3 py-2 text-sm">
            <div class="flex items-start gap-2">
              <UIcon name="i-lucide-calculator" class="mt-0.5 size-4 shrink-0 text-muted" />
              <div class="space-y-1">
                <p class="text-highlighted">
                  {{ selectedCommissionBase.description }}
                </p>
                <p class="text-muted">
                  Fórmula: {{ selectedCommissionBase.formula }}
                </p>
              </div>
            </div>
          </div>
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
          <UiDatePicker v-model="form.effectiveMonth" mode="month" />
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
          label="Salvar novo valor"
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
