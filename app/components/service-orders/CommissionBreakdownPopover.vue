<script setup lang="ts">
import { formatCurrency } from '~/utils/service-orders'

export type CommissionBreakdownLine = {
  label: string
  sublabel?: string | null
  amount: number
}

defineProps<{
  total: number
  lines: CommissionBreakdownLine[]
  title?: string
  emptyMessage?: string
  disabled?: boolean
}>()

const open = ref(false)
</script>

<template>
  <UPopover v-model:open="open" :disabled="disabled">
    <div
      class="inline-flex cursor-default"
      @mouseenter="open = true"
      @mouseleave="open = false"
    >
      <slot />
    </div>

    <template #content>
      <div
        class="w-64 p-3"
        @mouseenter="open = true"
        @mouseleave="open = false"
      >
        <div class="mb-2.5 flex items-center gap-1.5">
          <UIcon name="i-lucide-calculator" class="size-3.5 shrink-0 text-primary" />
          <p class="text-xs font-semibold uppercase tracking-wide text-muted">
            {{ title ?? 'Detalhes da comissão' }}
          </p>
        </div>

        <div
          v-if="!lines.length"
          class="py-3 text-center text-sm text-muted"
        >
          {{ emptyMessage ?? 'Nenhuma comissão calculada' }}
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="(line, i) in lines"
            :key="i"
            class="flex items-start justify-between gap-3"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-highlighted">
                {{ line.label }}
              </p>
              <p v-if="line.sublabel" class="mt-0.5 text-xs text-muted">
                {{ line.sublabel }}
              </p>
            </div>
            <span class="shrink-0 text-sm font-semibold text-info">
              {{ formatCurrency(line.amount) }}
            </span>
          </div>
        </div>

        <div class="mt-3 flex items-center justify-between border-t border-default pt-2.5">
          <span class="text-xs font-medium text-muted">Total de comissão</span>
          <span class="text-sm font-bold text-success">{{ formatCurrency(total) }}</span>
        </div>
      </div>
    </template>
  </UPopover>
</template>
