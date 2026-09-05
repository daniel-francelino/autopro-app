<script setup lang="ts">
import type { ResolvedCommissionRule } from '../../../lib/utils/employee-commission-engine'
import { formatCurrency } from '~/utils/service-orders'

const props = defineProps<{
  rules: ResolvedCommissionRule[]
  categoryNameById: Map<string, string>
}>()

const open = ref(false)

function formatRuleRate(rule: ResolvedCommissionRule) {
  const baseLabel = rule.commission_base === 'profit' ? 'Lucro' : 'Faturamento'
  return rule.commission_type === 'percentage'
    ? `${rule.commission_amount}% sobre ${baseLabel}`
    : `${formatCurrency(rule.commission_amount)} por unidade`
}

function formatRuleCategories(rule: ResolvedCommissionRule) {
  if (rule.is_default) return 'Todas as categorias (regra padrão)'
  if (!rule.category_ids.length) return 'Nenhuma categoria vinculada'
  return rule.category_ids
    .map(id => props.categoryNameById.get(id) || 'Categoria removida')
    .join(', ')
}
</script>

<template>
  <UPopover v-model:open="open">
    <div
      class="inline-flex cursor-default"
      @mouseenter="open = true"
      @mouseleave="open = false"
    >
      <slot />
    </div>

    <template #content>
      <div
        class="w-72 p-3"
        @mouseenter="open = true"
        @mouseleave="open = false"
      >
        <div class="mb-2.5 flex items-center gap-1.5">
          <UIcon name="i-lucide-list-checks" class="size-3.5 shrink-0 text-primary" />
          <p class="text-xs font-semibold uppercase tracking-wide text-muted">
            Regras de comissão do funcionário
          </p>
        </div>

        <div
          v-if="!rules.length"
          class="py-3 text-center text-sm text-muted"
        >
          Nenhuma regra configurada
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="rule in rules"
            :key="rule.id"
            class="border-l-2 border-primary/40 pl-2.5"
          >
            <p class="text-sm font-medium text-highlighted">
              {{ rule.name || (rule.is_default ? 'Regra padrão' : 'Regra') }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              {{ formatRuleRate(rule) }}
            </p>
            <p class="mt-0.5 text-xs text-dimmed">
              {{ formatRuleCategories(rule) }}
            </p>
          </div>
        </div>

        <div class="mt-3 border-t border-default pt-2">
          <p class="text-xs text-dimmed">
            Configurado em Financeiro > Comissões.
          </p>
        </div>
      </div>
    </template>
  </UPopover>
</template>
