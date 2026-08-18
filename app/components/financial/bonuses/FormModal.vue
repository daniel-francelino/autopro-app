<script setup lang="ts">
defineProps<{ open: boolean }>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': [id: string]
}>()

const toast = useToast()
const isSaving = ref(false)

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const form = reactive({
  name: '',
  commissionBase: 'revenue' as 'revenue' | 'profit' | 'revenue_minus_parts' | 'employee_net_profit',
  goalAmount: '' as number | string,
  bonusAmount: '' as number | string,
  effectiveMonth: currentMonthValue() as string | undefined,
  dueDay: '' as string
})

function resetForm() {
  form.name = ''
  form.commissionBase = 'revenue'
  form.goalAmount = ''
  form.bonusAmount = ''
  form.effectiveMonth = currentMonthValue()
  form.dueDay = ''
}

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

  const name = form.name.trim()
  if (!name) {
    toast.add({ title: 'Nome obrigatório', color: 'warning' })
    return
  }
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
    toast.add({ title: 'Informe a partir de qual mês o bônus vale', color: 'warning' })
    return
  }
  const dueDay = form.dueDay === '' ? undefined : Number(form.dueDay)
  if (dueDay !== undefined && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
    toast.add({ title: 'Dia de vencimento deve ser um número entre 1 e 31', color: 'warning' })
    return
  }

  isSaving.value = true
  try {
    const response = await $fetch<{ item: { id: string } }>('/api/bonuses', {
      method: 'POST',
      body: {
        name,
        commissionBase: form.commissionBase,
        goalAmount,
        bonusAmount,
        effectiveFrom: `${form.effectiveMonth}-01`,
        dueDay
      }
    })
    toast.add({ title: 'Bônus criado', color: 'success' })
    resetForm()
    emit('created', response.item.id)
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível criar o bônus', color: 'error' })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Novo bônus"
    description="Configure a meta e o valor — funcionários são atribuídos depois, na tela de detalhes."
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Nome" required>
          <UInput v-model="form.name" class="w-full" placeholder="Ex: Meta de vendas — Peças" />
        </UFormField>

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

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Vale a partir de" required>
            <UiDatePicker v-model="form.effectiveMonth" mode="month" />
          </UFormField>
          <UFormField label="Dia de vencimento" required>
            <UInput
              v-model="form.dueDay"
              type="number"
              min="1"
              max="31"
              placeholder="Ex: 5"
              class="w-full"
            />
          </UFormField>
        </div>
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
          label="Criar bônus"
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
