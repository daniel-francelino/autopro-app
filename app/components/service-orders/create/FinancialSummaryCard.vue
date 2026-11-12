<script setup lang="ts">
import { formatCurrency } from '~/utils/service-orders'

defineProps<{
  subtotal: number
  totalCost: number
  totalTaxesAmount: number
  totalCommissionAmount: number
  totalAmount: number
  estimatedProfit: number
  discount: number | string
}>()

defineEmits<{
  'update:discount': [v: number | string]
}>()
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-calculator" class="size-4 text-primary" />
        <h3 class="font-semibold text-highlighted">
          Resumo financeiro
        </h3>
      </div>
    </template>

    <div class="space-y-4">
      <div class="rounded-2xl bg-primary/8 p-4 text-center">
        <p class="flex items-center justify-center gap-1.5 text-sm text-muted">
          <UIcon name="i-lucide-circle-dollar-sign" class="size-4 text-primary" />
          Valor previsto para o cliente
        </p>
        <p class="mt-1 text-3xl font-bold text-highlighted">
          {{ formatCurrency(totalAmount) }}
        </p>
      </div>

      <div class="grid grid-cols-2 gap-3 text-center">
        <div class="rounded-xl bg-elevated/70 p-3">
          <p class="flex items-center justify-center gap-1.5 text-xs uppercase tracking-wide text-muted">
            <UIcon name="i-lucide-receipt" class="size-3.5" />Subtotal
          </p>
          <p class="mt-1 font-semibold text-highlighted">
            {{ formatCurrency(subtotal) }}
          </p>
        </div>
        <div class="rounded-xl bg-elevated/70 p-3">
          <p class="flex items-center justify-center gap-1.5 text-xs uppercase tracking-wide text-muted">
            <UIcon name="i-lucide-badge-dollar-sign" class="size-3.5" />Custo
          </p>
          <p class="mt-1 font-semibold text-error">
            {{ formatCurrency(totalCost) }}
          </p>
        </div>
        <div class="rounded-xl bg-elevated/70 p-3">
          <p class="flex items-center justify-center gap-1.5 text-xs uppercase tracking-wide text-muted">
            <UIcon name="i-lucide-percent" class="size-3.5" />Impostos
          </p>
          <p class="mt-1 font-semibold text-warning">
            {{ formatCurrency(totalTaxesAmount) }}
          </p>
        </div>
        <div class="rounded-xl bg-elevated/70 p-3">
          <p class="flex items-center justify-center gap-1.5 text-xs uppercase tracking-wide text-muted">
            <UIcon name="i-lucide-wallet-cards" class="size-3.5" />Comissão
          </p>
          <p class="mt-1 font-semibold text-info">
            {{ formatCurrency(totalCommissionAmount) }}
          </p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <UFormField>
          <template #label>
            <span class="flex items-center gap-1.5">
              <UIcon name="i-lucide-badge-percent" class="size-4 text-warning" />
              <span>Desconto</span>
            </span>
          </template>
          <UiCurrencyInput
            :model-value="discount"
            @update:model-value="$emit('update:discount', $event ?? '')"
          />
        </UFormField>

        <UFormField label="Margem estimada">
          <UInput
            :model-value="formatCurrency(estimatedProfit)"
            icon="i-lucide-chart-column-big"
            :color="estimatedProfit >= 0 ? 'success' : 'error'"
            class="w-full"
            disabled
          />
        </UFormField>
      </div>
    </div>
  </UCard>
</template>
