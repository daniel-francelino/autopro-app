<script setup lang="ts">
import type { TagFilterOption } from '~/components/ui/TagFilter.vue'

const props = withDefaults(
  defineProps<{
    dateLabel?: string
    statusLabel?: string
    compareLabel?: string
    orderStatusLabel?: string
    orderPaymentStatusLabel?: string
  }>(),
  {
    dateLabel: 'Período',
    statusLabel: 'Status do pagamento',
    compareLabel: 'Comparação',
    orderStatusLabel: 'Status da OS',
    orderPaymentStatusLabel: 'Status do pagamento'
  }
)

const dateFrom = defineModel<string>('dateFrom')
const dateTo = defineModel<string>('dateTo')
const statusFilters = defineModel<string[]>('statusFilters', { default: () => ['paid'] })
const compareMode = defineModel<string>('compareMode', { default: 'no_compare' })
const mode = defineModel<'cash_flow' | 'by_order'>('mode', { default: 'cash_flow' })
const orderStatusFilters = defineModel<string[]>('orderStatusFilters', { default: () => ['completed', 'invoiced', 'delivered'] })
const orderPaymentStatusFilters = defineModel<string[]>('orderPaymentStatusFilters', { default: () => [] })

const statusOptions: TagFilterOption[] = [
  { value: 'paid', label: 'Pago', color: 'success', icon: 'i-lucide-circle-check' },
  { value: 'pending', label: 'Pendente', color: 'warning', icon: 'i-lucide-clock' }
]

const orderStatusOptions: TagFilterOption[] = [
  { value: 'open', label: 'Aberta', color: 'info', icon: 'i-lucide-circle-dot' },
  { value: 'in_progress', label: 'Em andamento', color: 'warning', icon: 'i-lucide-wrench' },
  { value: 'waiting_for_part', label: 'Aguard. peça', color: 'warning', icon: 'i-lucide-package-search' },
  { value: 'completed', label: 'Concluída', color: 'success', icon: 'i-lucide-check-circle-2' },
  { value: 'invoiced', label: 'Faturada', color: 'primary', icon: 'i-lucide-receipt' },
  { value: 'delivered', label: 'Entregue', color: 'success', icon: 'i-lucide-truck' },
  { value: 'estimate', label: 'Orçamento', color: 'neutral', icon: 'i-lucide-file-text' },
  { value: 'cancelled', label: 'Cancelada', color: 'error', icon: 'i-lucide-ban' }
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
  { label: 'Pelas OS', value: 'by_order' as const, slot: 'by_order' as const, icon: 'i-lucide-wrench' }
]

const modeDescription: Record<'cash_flow' | 'by_order', string> = {
  cash_flow: 'Dinheiro que já entrou/saiu (ou está prestes a) — tenho dinheiro no caixa?',
  by_order: 'Receita de cada OS menos o custo de peças da própria OS — o preço do serviço cobre o custo da peça?'
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

        <!-- Fluxo de Caixa: status de pagamento das transações financeiras -->
        <div v-if="mode === 'cash_flow'" class="col-span-2">
          <p class="mb-1 text-xs font-medium text-muted">
            {{ props.statusLabel }}
          </p>
          <UiTagFilter
            v-model="statusFilters"
            :options="statusOptions"
            placeholder="Todos"
            class="w-full"
          />
        </div>

        <!-- Pelas OS: status da OS e status de pagamento da própria OS, independentes -->
        <template v-else>
          <div>
            <p class="mb-1 text-xs font-medium text-muted">
              {{ props.orderStatusLabel }}
            </p>
            <UiTagFilter
              v-model="orderStatusFilters"
              :options="orderStatusOptions"
              placeholder="Todos"
              class="w-full"
            />
          </div>
          <div>
            <p class="mb-1 text-xs font-medium text-muted">
              {{ props.orderPaymentStatusLabel }}
            </p>
            <UiTagFilter
              v-model="orderPaymentStatusFilters"
              :options="statusOptions"
              placeholder="Todos"
              class="w-full"
            />
          </div>
        </template>
      </div>
    </div>
  </UCard>
</template>
