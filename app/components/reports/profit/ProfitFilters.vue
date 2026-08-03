<script setup lang="ts">
import type { TagFilterOption } from '~/components/ui/TagFilter.vue'

const props = withDefaults(
  defineProps<{
    dateLabel?: string
    statusLabel?: string
    compareLabel?: string
  }>(),
  {
    dateLabel: 'Período',
    statusLabel: 'Status do pagamento',
    compareLabel: 'Comparação'
  }
)

const dateFrom = defineModel<string>('dateFrom')
const dateTo = defineModel<string>('dateTo')
const statusFilters = defineModel<string[]>('statusFilters', { default: () => ['paid'] })
const compareMode = defineModel<string>('compareMode', { default: 'no_compare' })
const mode = defineModel<'cash_flow' | 'by_order' | 'period_result'>('mode', { default: 'cash_flow' })

const statusOptions: TagFilterOption[] = [
  { value: 'paid', label: 'Pago', color: 'success', icon: 'i-lucide-circle-check' },
  { value: 'pending', label: 'Pendente', color: 'warning', icon: 'i-lucide-clock' }
]

const compareOptions = [
  { label: 'Não comparar', value: 'no_compare' },
  { label: 'Período anterior equivalente', value: 'previous_period' },
  { label: 'Mesmo período do ano anterior', value: 'same_period_last_year' },
  { label: 'Mês anterior', value: 'previous_month' },
  { label: 'Trimestre anterior', value: 'previous_quarter' }
]

const modeItems = [
  { label: 'Fluxo de Caixa', value: 'cash_flow' as const, slot: 'cash_flow' as const, icon: 'i-lucide-wallet' },
  { label: 'Pelas OS', value: 'by_order' as const, slot: 'by_order' as const, icon: 'i-lucide-wrench' },
  { label: 'Resultado do Período', value: 'period_result' as const, slot: 'period_result' as const, icon: 'i-lucide-scale' }
]

const modeDescription: Record<'cash_flow' | 'by_order' | 'period_result', string> = {
  cash_flow: 'Dinheiro que já entrou/saiu (ou está prestes a) — tenho dinheiro no caixa?',
  by_order: 'Receita de cada OS menos o custo de peças da própria OS, independente de status de pagamento — o preço do serviço cobre o custo da peça?',
  period_result: 'Toda receita de OS reconhecida menos toda despesa geral reconhecida no período, independente de status de pagamento — o negócio deu lucro de verdade?'
}
</script>

<template>
  <UCard :ui="{ body: 'p-3' }">
    <div class="space-y-3">
      <div class="flex items-center gap-2 text-muted">
        <UIcon name="i-lucide-filter" class="size-4" />
        <span class="text-sm font-medium">Filtros</span>
      </div>

      <div>
        <UTabs
          v-model="mode"
          :items="modeItems"
          variant="link"
          class="w-full"
        />
        <p class="mt-1 text-xs text-muted">
          {{ modeDescription[mode] }}
        </p>
      </div>

      <div class="grid grid-cols-2 gap-3 space-y-3">
        <div>
          <p class="mb-1 text-xs font-medium text-muted">
            {{ props.dateLabel }}
          </p>
          <UiDateRangePicker
            v-model:from="dateFrom"
            v-model:to="dateTo"
            class="w-full"
          />
        </div>

        <div />

        <div>
          <p class="mb-1 text-xs font-medium text-muted">
            {{ props.statusLabel }}
          </p>
          <UiTagFilter
            v-if="mode === 'cash_flow'"
            v-model="statusFilters"
            :options="statusOptions"
            placeholder="Todos"
            class="w-full"
          />
          <p v-else class="rounded-md border border-dashed border-default px-3 py-2 text-xs text-muted">
            Considera todas as OS do período, independente do status de pagamento.
          </p>
        </div>

        <div>
          <p class="mb-1 text-xs font-medium text-muted">
            {{ props.compareLabel }}
          </p>
          <USelect
            :model-value="compareMode"
            :items="compareOptions"
            value-key="value"
            leading-icon="i-lucide-git-compare-arrows"
            class="w-full"
            @update:model-value="compareMode = String($event || 'no_compare')"
          />
        </div>
      </div>
    </div>
  </UCard>
</template>
