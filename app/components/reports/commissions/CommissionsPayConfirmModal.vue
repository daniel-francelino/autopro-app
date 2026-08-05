<script setup lang="ts">
export interface PayConfirmTarget {
  id: string
  employeeName: string
  osLabel: string | null
  referenceDateLabel: string
  daysPending: number
  amount: number
  completionDateIso: string | null
  completionDateLabel: string | null
}

const props = defineProps<{
  open: boolean
  target: PayConfirmTarget | null
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'confirm': [paymentDate: string]
}>()

type DateChoice = 'today' | 'os_completion'

const choice = ref<DateChoice>('today')
const todayIso = new Date().toISOString().split('T')[0]!

function formatDate(v: string) {
  if (!v) return '—'
  const [y, m, d] = v.split('-')
  return `${d}/${m}/${y}`
}

const todayLabel = formatDate(todayIso)

watch(() => props.target, () => {
  choice.value = 'today'
})

const dateOptions = computed(() => {
  const options: Array<{ label: string, description: string, value: DateChoice }> = [
    {
      label: `Pagar com data de hoje (${todayLabel})`,
      description: 'A despesa entra no fluxo de caixa e nos relatórios do mês atual.',
      value: 'today'
    }
  ]
  if (props.target?.completionDateIso) {
    options.push({
      label: `Pagar na data de conclusão da OS (${props.target.completionDateLabel})`,
      description: 'Lançamento, extrato bancário e data de pagamento retroagem para o período em que o serviço foi concluído.',
      value: 'os_completion'
    })
  }
  return options
})

function formatCurrency(v: number) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function confirm() {
  const paymentDate = choice.value === 'os_completion' && props.target?.completionDateIso
    ? props.target.completionDateIso
    : todayIso
  emit('confirm', paymentDate)
}
</script>

<template>
  <UModal
    :open="open"
    title="Comissão pendente há bastante tempo"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div v-if="target" class="space-y-4">
        <div class="flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning">
          <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" />
          <span>
            Esta comissão é referente a <strong>{{ target.referenceDateLabel }}</strong>,
            pendente há <strong>{{ target.daysPending }} dias</strong>.
          </span>
        </div>

        <div class="rounded-lg bg-elevated p-3 space-y-1.5 text-sm">
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted">Funcionário</span>
            <span class="font-medium text-highlighted">{{ target.employeeName }}</span>
          </div>
          <div v-if="target.osLabel" class="flex items-center justify-between gap-2">
            <span class="text-muted">OS</span>
            <span class="font-mono font-medium">{{ target.osLabel }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted">Valor</span>
            <span class="font-bold text-success">{{ formatCurrency(target.amount) }}</span>
          </div>
        </div>

        <div class="space-y-2">
          <p class="text-sm font-medium text-highlighted">
            Data do pagamento
          </p>

          <URadioGroup
            v-model="choice"
            variant="card"
            :items="dateOptions"
          />

          <div v-if="!target.completionDateIso" class="flex items-start gap-2 rounded-xl border border-dashed border-default p-3 text-xs text-muted">
            <UIcon name="i-lucide-info" class="mt-0.5 size-3.5 shrink-0" />
            <span>Esta comissão não tem uma OS vinculada com data de conclusão, então só é possível pagar com a data de hoje.</span>
          </div>
        </div>

        <div class="flex justify-end gap-3">
          <UButton
            label="Cancelar"
            color="neutral"
            variant="ghost"
            :disabled="loading"
            @click="emit('update:open', false)"
          />
          <UButton
            label="Confirmar pagamento"
            color="success"
            icon="i-lucide-credit-card"
            :loading="loading"
            @click="confirm"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
