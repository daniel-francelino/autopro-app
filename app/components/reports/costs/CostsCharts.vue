<script setup lang="ts">
interface CategoryRow {
  categoryKey: string
  category: string
  icon: string
  color: string
  amount: number
  percentage: number
}

interface EvolutionPoint {
  name: string
  cost: number
}

const props = defineProps<{
  categories: CategoryRow[]
  evolution: EvolutionPoint[]
}>()

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDay(value: string) {
  if (!value) return '-'
  if (value.includes('/')) return value
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}`
}

const donutLabels = computed(() => props.categories.map(category => category.category))
const donutSeries = computed(() => props.categories.map(category => Number(category.amount ?? 0)))
const donutColors = computed(() => props.categories.map(category => category.color))

const evolutionCategories = computed(() => props.evolution.map(point => formatDay(point.name)))
const evolutionSeries = computed(() => [
  { name: 'Custo', data: props.evolution.map(point => Number(point.cost ?? 0)) }
])
</script>

<template>
  <div v-if="categories.length > 0 || evolution.length > 0" class="grid grid-cols-1 gap-4 xl:grid-cols-3">
    <UCard v-if="categories.length > 0" :ui="{ body: 'p-4' }">
      <div class="mb-4 flex items-center gap-2">
        <UIcon name="i-lucide-pie-chart" class="size-4 text-primary" />
        <p class="text-sm font-semibold text-highlighted">
          Custos por categoria
        </p>
      </div>
      <ChartsDonut
        :labels="donutLabels"
        :series="donutSeries"
        :colors="donutColors"
        :height="300"
        :format-value="formatCurrency"
      />
    </UCard>

    <UCard v-if="evolution.length > 0" :ui="{ body: 'p-4' }" :class="categories.length > 0 ? 'xl:col-span-2' : 'xl:col-span-3'">
      <div class="mb-4 flex items-center gap-2">
        <UIcon name="i-lucide-trending-down" class="size-4 text-primary" />
        <p class="text-sm font-semibold text-highlighted">
          Evolução dos custos
        </p>
      </div>
      <ChartsLine
        :categories="evolutionCategories"
        :series="evolutionSeries"
        :height="300"
        :colors="['#ef4444']"
        :format-value="formatCurrency"
        show-markers
      />
    </UCard>
  </div>
</template>
