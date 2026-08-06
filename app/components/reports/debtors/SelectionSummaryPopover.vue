<script setup lang="ts">
const props = defineProps<{
  count: number
  total: number
  overdue: number
  current: number
}>()

const open = ref(false)

function formatCurrency(value: number) {
  return Number.isFinite(value) ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00'
}
</script>

<template>
  <UPopover v-model:open="open">
    <div
      class="inline-flex cursor-default items-center gap-1.5 rounded-full border border-default/80 bg-elevated/60 px-3 py-1.5 text-xs font-medium text-highlighted"
      @mouseenter="open = true"
      @mouseleave="open = false"
    >
      <UIcon name="i-lucide-list-checks" class="size-3.5 shrink-0 text-primary" />
      {{ props.count }} selecionado(s)
    </div>

    <template #content>
      <div
        class="w-60 p-3"
        @mouseenter="open = true"
        @mouseleave="open = false"
      >
        <div class="mb-2.5 flex items-center gap-1.5">
          <UIcon name="i-lucide-calculator" class="size-3.5 shrink-0 text-primary" />
          <p class="text-xs font-semibold uppercase tracking-wide text-muted">
            Resumo da seleção
          </p>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-1.5 text-sm text-muted">
              <UIcon name="i-lucide-alert-triangle" class="size-3.5 shrink-0 text-error" />
              Em atraso
            </div>
            <span class="shrink-0 text-sm font-semibold text-error">{{ formatCurrency(props.overdue) }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-1.5 text-sm text-muted">
              <UIcon name="i-lucide-calendar-clock" class="size-3.5 shrink-0 text-warning" />
              No prazo
            </div>
            <span class="shrink-0 text-sm font-semibold text-warning">{{ formatCurrency(props.current) }}</span>
          </div>
        </div>

        <div class="mt-3 flex items-center justify-between border-t border-default pt-2.5">
          <span class="text-xs font-medium text-muted">Total selecionado</span>
          <span class="text-sm font-bold text-highlighted">{{ formatCurrency(props.total) }}</span>
        </div>
      </div>
    </template>
  </UPopover>
</template>
