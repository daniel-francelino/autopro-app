<script setup lang="ts">
const props = defineProps<{
  label: string
  value: number | string
  /** Valor do período anterior de mesmo tamanho (para o ▲▼). */
  previous?: number
  /** Para "robôs", queda é boa: inverte a cor. */
  invert?: boolean
  hint?: string
}>()

const delta = computed(() => {
  if (props.previous === undefined || typeof props.value !== 'number') return null
  if (props.previous === 0) return props.value === 0 ? null : { text: 'novo', up: true, pct: null as number | null }
  const pct = ((props.value - props.previous) / props.previous) * 100
  if (Math.abs(pct) < 0.5) return { text: '0%', up: null as boolean | null, pct }
  return { text: `${pct > 0 ? '▲' : '▼'} ${Math.abs(Math.round(pct))}%`, up: pct > 0, pct }
})

const tone = computed(() => {
  if (!delta.value || delta.value.up === null) return 'text-muted'
  const good = props.invert ? !delta.value.up : delta.value.up
  return good ? 'text-success' : 'text-error'
})
</script>

<template>
  <UPageCard variant="subtle" :ui="{ container: 'p-4 sm:p-5 gap-1.5' }">
    <p class="text-xs font-medium uppercase tracking-wide text-muted">
      {{ label }}
    </p>
    <p class="text-2xl font-semibold text-highlighted tabular-nums">
      {{ typeof value === 'number' ? value.toLocaleString('pt-BR') : value }}
    </p>
    <p v-if="delta" class="text-xs" :class="tone">
      {{ delta.text }} <span class="text-muted">vs. período anterior</span>
    </p>
    <p v-else-if="hint" class="text-xs text-muted">
      {{ hint }}
    </p>
  </UPageCard>
</template>
