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
</script>

<template>
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
    <UCard
      v-for="stat in [
        { label: 'Venda bruta', value: formatCurrency(summary?.grossSales ?? 0), icon: 'i-lucide-banknote', color: 'text-primary', bg: 'bg-primary/10', description: 'total das OS' },
        { label: 'Despesas da OS', value: formatCurrency(summary?.osExpenses ?? 0), icon: 'i-lucide-wallet-cards', color: 'text-error', bg: 'bg-error/10', description: 'custo de peças' },
        { label: 'Comissões', value: formatCurrency(summary?.totalCommissions ?? 0), icon: 'i-lucide-hand-coins', color: 'text-warning', bg: 'bg-warning/10', description: 'do funcionário' },
        { label: 'Comissões de outros', value: formatCurrency(summary?.otherEmployeesCommissions ?? 0), icon: 'i-lucide-users', color: 'text-info', bg: 'bg-info/10', description: 'nas mesmas OS, ainda não descontado da líquida' },
        { label: 'Venda líquida', value: formatCurrency(netSales), icon: 'i-lucide-calculator', color: netSales >= 0 ? 'text-success' : 'text-error', bg: netSales >= 0 ? 'bg-success/10' : 'bg-error/10', description: 'bruta − despesas − comissões' }
      ]"
      :key="stat.label"
      :ui="{ body: 'p-3 sm:p-4' }"
    >
      <div class="flex items-start gap-3">
        <div :class="[stat.bg, 'rounded-xl p-2 shrink-0']">
          <UIcon :name="stat.icon" :class="[stat.color, 'size-5']" />
        </div>
        <div>
          <p class="text-lg font-bold leading-tight">
            {{ stat.value }}
          </p>
          <p class="text-xs font-medium text-highlighted">
            {{ stat.label }}
          </p>
          <p class="text-xs text-muted">
            {{ stat.description }}
          </p>
        </div>
      </div>
    </UCard>
  </div>
</template>
