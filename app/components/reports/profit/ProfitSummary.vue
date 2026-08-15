<script setup lang="ts">
interface PeriodData {
  revenue?: number
  costs?: number
  profit?: number
  profitMargin?: number
  partsCost?: number
  commissionCost?: number
}

interface VariationValue {
  variation?: number | null
  type?: 'increase' | 'decrease' | 'equal'
  fromZeroBase?: boolean
}

const props = defineProps<{
  currentData: PeriodData | null | undefined
  variations: {
    revenue?: VariationValue
    costs?: VariationValue
    profit?: VariationValue
    margin?: VariationValue
  } | null | undefined
}>()

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const costsTooltip = computed(() => {
  const partsCost = props.currentData?.partsCost
  const commissionCost = props.currentData?.commissionCost
  if (partsCost !== undefined && commissionCost !== undefined) {
    return `peças: ${formatCurrency(partsCost)} · comissão: ${formatCurrency(commissionCost)}`
  }
  return undefined
})

function formatPercent(v: number | string) {
  return `${parseFloat(String(v || 0)).toFixed(1)}%`
}

function variationText(value?: VariationValue, suffix = '') {
  if (!value) return null
  if (value.fromZeroBase) return 'Sem base anterior'
  if (!Number.isFinite(Number(value.variation))) return `Novo${suffix ? ` ${suffix}` : ''}`
  return `${Number(value.variation || 0).toFixed(1)}%${suffix}`
}

function variationIcon(value?: VariationValue) {
  if (value?.type === 'increase') return 'i-lucide-trending-up'
  if (value?.type === 'decrease') return 'i-lucide-trending-down'
  return 'i-lucide-minus'
}

function variationColor(value?: VariationValue, invert = false) {
  if (value?.type === 'equal') return 'text-muted'
  if (invert) return value?.type === 'increase' ? 'text-error' : 'text-success'
  return value?.type === 'increase' ? 'text-success' : 'text-error'
}
</script>

<template>
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <UTooltip
      v-for="stat in [
        {
          label: 'Faturamento',
          value: formatCurrency(currentData?.revenue ?? 0),
          icon: 'i-lucide-badge-dollar-sign',
          color: 'text-primary',
          bg: 'bg-primary/10',
          description: 'receita do período',
          variation: variations?.revenue,
          invertVariation: false
        },
        {
          label: 'Custos',
          value: formatCurrency(currentData?.costs ?? 0),
          icon: 'i-lucide-wallet-cards',
          color: 'text-error',
          bg: 'bg-error/10',
          description: 'despesas consideradas',
          tooltip: costsTooltip,
          variation: variations?.costs,
          invertVariation: true
        },
        {
          label: 'Lucro líquido',
          value: formatCurrency(currentData?.profit ?? 0),
          icon: 'i-lucide-calculator',
          color: (currentData?.profit ?? 0) >= 0 ? 'text-success' : 'text-error',
          bg: (currentData?.profit ?? 0) >= 0 ? 'bg-success/10' : 'bg-error/10',
          description: 'receita menos custos',
          variation: variations?.profit,
          invertVariation: false
        },
        {
          label: 'Margem de lucro',
          value: formatPercent(currentData?.profitMargin ?? 0),
          icon: 'i-lucide-percent',
          color: 'text-info',
          bg: 'bg-info/10',
          description: 'sobre a receita',
          variation: variations?.margin,
          variationSuffix: ' pp',
          invertVariation: false
        }
      ]"
      :key="stat.label"
      :text="stat.tooltip"
      class="w-full"
    >
      <UCard :ui="{ body: 'p-3 sm:p-4' }" class="w-full">
        <div class="flex items-start gap-3">
          <div :class="[stat.bg, 'rounded-xl p-2 shrink-0']">
            <UIcon :name="stat.icon" :class="[stat.color, 'size-5']" />
          </div>
          <div class="min-w-0">
            <p class="text-lg font-bold leading-tight">
              {{ stat.value }}
            </p>
            <p class="text-xs font-medium text-highlighted">
              {{ stat.label }}
            </p>
            <p class="text-xs text-muted">
              {{ stat.description }}
            </p>
            <div v-if="stat.variation" class="mt-1.5 flex items-center gap-1.5 text-xs">
              <UIcon
                :name="variationIcon(stat.variation)"
                :class="[variationColor(stat.variation, stat.invertVariation), 'size-3.5']"
              />
              <span :class="variationColor(stat.variation, stat.invertVariation)">
                {{ variationText(stat.variation, stat.variationSuffix ?? '') }}
              </span>
            </div>
          </div>
        </div>
      </UCard>
    </UTooltip>
  </div>
</template>
