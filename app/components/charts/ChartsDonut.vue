<script setup lang="ts">
import type { ApexOptions } from 'apexcharts'
import VueApexCharts from 'vue3-apexcharts'

const props = defineProps<{
  labels: string[]
  series: number[]
  height?: number
  colors?: string[]
  formatValue?: (v: number) => string
  donutSize?: string
}>()

const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')

const defaultColors = [
  '#f87171', '#fb923c', '#facc15', '#4ade80', '#34d399',
  '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6', '#94a3b8'
]

function fmt(v: number) {
  return props.formatValue ? props.formatValue(v) : v.toLocaleString('pt-BR')
}

const total = computed(() => props.series.reduce((a, b) => a + b, 0))

const chartOptions = computed<ApexOptions>(() => ({
  chart: {
    type: 'donut',
    toolbar: { show: false },
    fontFamily: 'inherit',
    background: 'transparent',
    animations: { enabled: true, speed: 300 }
  },
  theme: { mode: isDark.value ? 'dark' : 'light' },
  colors: props.colors ?? defaultColors,
  labels: props.labels,
  plotOptions: {
    pie: {
      donut: {
        size: props.donutSize ?? '65%',
        labels: {
          show: true,
          total: {
            show: true,
            label: 'Total',
            fontSize: '13px',
            fontFamily: 'inherit',
            fontWeight: 600,
            color: isDark.value ? '#d1d5db' : '#374151',
            formatter: () => fmt(total.value)
          },
          value: {
            show: true,
            fontSize: '14px',
            fontFamily: 'inherit',
            fontWeight: 700,
            color: isDark.value ? '#f9fafb' : '#111827',
            formatter: fmt
          },
          name: {
            show: true,
            fontSize: '12px',
            fontFamily: 'inherit',
            color: isDark.value ? '#9ca3af' : '#6b7280'
          }
        }
      }
    }
  },
  dataLabels: { enabled: false },
  stroke: { width: 0 },
  tooltip: {
    theme: isDark.value ? 'dark' : 'light',
    y: {
      formatter: (val: number) => {
        const pct = total.value > 0 ? ((val / total.value) * 100).toFixed(1) : '0'
        return `${fmt(val)} (${pct}%)`
      }
    }
  },
  legend: {
    position: 'bottom',
    fontSize: '12px',
    fontFamily: 'inherit',
    labels: { colors: isDark.value ? '#d1d5db' : '#374151' },
    markers: { size: 8, shape: 'square', offsetY: 0 },
    itemMargin: { horizontal: 8, vertical: 4 }
  }
}))
</script>

<template>
  <ClientOnly>
    <div class="w-full" :style="`height: ${height ?? 260}px`">
      <VueApexCharts
        type="donut"
        :height="height ?? 260"
        :options="chartOptions"
        :series="series"
        class="w-full"
      />
    </div>
    <template #fallback>
      <div
        class="animate-pulse bg-elevated rounded-xl w-full"
        :style="`height: ${height ?? 260}px`"
      />
    </template>
  </ClientOnly>
</template>
