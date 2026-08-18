<script setup lang="ts">
const props = defineProps<{
  summary: {
    grossSales?: number
    osExpenses?: number
    totalCommissions?: number
    otherEmployeesCommissions?: number
    netSales?: number
  } | null
}>()

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const netSales = computed(() => props.summary?.netSales ?? 0)

const stats = computed(() => [
  { label: 'Venda bruta', value: formatCurrency(props.summary?.grossSales ?? 0), icon: 'i-lucide-banknote', color: 'text-primary', bg: 'bg-primary/10', description: 'total das OS' },
  {
    label: 'Despesas da OS',
    value: formatCurrency(props.summary?.osExpenses ?? 0),
    icon: 'i-lucide-wallet-cards',
    color: 'text-error',
    bg: 'bg-error/10',
    description: 'custo de peças',
    tooltip: 'Soma do custo das peças e produtos usados nas OS deste funcionário no período selecionado. Não inclui despesas gerais da oficina (aluguel, contas, etc.).'
  },
  { label: 'Comissões', value: formatCurrency(props.summary?.totalCommissions ?? 0), icon: 'i-lucide-hand-coins', color: 'text-warning', bg: 'bg-warning/10', description: 'do funcionário' },
  {
    label: 'Venda líquida',
    value: formatCurrency(netSales.value),
    icon: 'i-lucide-calculator',
    color: netSales.value >= 0 ? 'text-success' : 'text-error',
    bg: netSales.value >= 0 ? 'bg-success/10' : 'bg-error/10',
    description: 'bruta − despesas − comissões',
    tooltip: 'Venda bruta menos as despesas de peças e a comissão deste funcionário. Não desconta a comissão de outros funcionários também responsáveis pela mesma OS.'
  }
])
</script>

<template>
  <div class="flex flex-wrap gap-3">
    <UCard
      v-for="stat in stats"
      :key="stat.label"
      class="w-60"
      :ui="{ body: 'p-3 sm:p-4' }"
    >
      <div class="flex items-start gap-3">
        <div :class="[stat.bg, 'rounded-xl p-2 shrink-0']">
          <UIcon :name="stat.icon" :class="[stat.color, 'size-5']" />
        </div>
        <div class="min-w-0">
          <p class="text-lg font-bold leading-tight truncate">
            {{ stat.value }}
          </p>
          <p class="flex items-center gap-1 text-xs font-medium text-highlighted">
            <span class="truncate">{{ stat.label }}</span>
            <UTooltip v-if="stat.tooltip" :text="stat.tooltip" :ui="{ content: 'h-auto max-w-64 py-1.5', text: 'whitespace-normal' }">
              <UIcon name="i-lucide-info" class="size-3 shrink-0 text-muted" />
            </UTooltip>
          </p>
          <p class="text-xs text-muted">
            {{ stat.description }}
          </p>
        </div>
      </div>
    </UCard>
  </div>
</template>
