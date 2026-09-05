<script setup lang="ts">
import type { ServiceOrderDetailFull } from '~/types/service-orders'
import {
  computeServiceOrderCommissionBreakdown,
  formatCommissionRuleSublabel,
  formatCurrency
} from '~/utils/service-orders'
import type { CommissionBreakdownLine } from '../CommissionBreakdownPopover.vue'

const props = defineProps<{
  order: ServiceOrderDetailFull['order']
  responsibleNames: ServiceOrderDetailFull['responsibleNames']
  commissions: ServiceOrderDetailFull['commissions']
}>()

type ResponsibleInfo = {
  employee_id: string
  name: string | null
  /** This employee has at least one active plan in the new model (docs/finance/commissions-configuration-architecture.md). */
  has_commission_plan: boolean
  commission_amount: number
  item_breakdown: CommissionBreakdownLine[]
}

const { rulesByEmployeeId, ensureRules } = useEmployeeCommissionRules()

watch(
  () => [props.order.responsible_employees, props.order.entry_date] as const,
  ([responsibleEmployees, entryDate]) => {
    const responsibleEmployeeIds = (responsibleEmployees ?? []).map(r => r.employee_id)
    ensureRules(responsibleEmployeeIds, entryDate || new Date().toISOString().substring(0, 10))
  },
  { immediate: true, deep: true }
)

const commissionBreakdown = computed(() =>
  computeServiceOrderCommissionBreakdown(props.order, rulesByEmployeeId.value)
)

const responsiblesInfo = computed<ResponsibleInfo[]>(() => {
  const items = props.order.items ?? []

  return props.responsibleNames.map((r) => {
    const commission_amount = commissionBreakdown.value.byEmployeeId.get(r.employee_id)?.value ?? 0

    const item_breakdown: CommissionBreakdownLine[] = []
    for (const [itemIndex, entry] of commissionBreakdown.value.byItemIndex) {
      const c = entry.commissions.find(x => x.employee_id === r.employee_id)
      if (!c || c.amount <= 0) continue
      const item = items[itemIndex]
      if (!item) continue
      item_breakdown.push({
        label: item.description || item.name || `Item ${itemIndex + 1}`,
        sublabel: formatCommissionRuleSublabel(c),
        amount: c.amount
      })
    }

    return {
      employee_id: r.employee_id,
      name: r.name,
      has_commission_plan: (rulesByEmployeeId.value.get(r.employee_id)?.length ?? 0) > 0,
      commission_amount,
      item_breakdown
    }
  })
})

const totalCommissionAmount = computed(() =>
  responsiblesInfo.value.reduce(
    (total, responsible) => total + Number(responsible.commission_amount ?? 0),
    0
  )
)

function getResponsibleCommissionNote(assignee: ResponsibleInfo) {
  if (assignee.has_commission_plan) {
    return {
      label: 'Por regra/categoria',
      tooltip: 'Comissão configurada por regra e categoria em Financeiro > Comissões — o valor varia por item, veja o detalhamento em "Comissão".',
      color: 'primary' as const,
      icon: 'i-lucide-list-checks'
    }
  }

  return {
    label: 'Sem comissão',
    tooltip: null,
    color: 'neutral' as const,
    icon: 'i-lucide-circle-off'
  }
}
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-user-round-cog" class="size-4 text-primary" />
        <h3 class="font-semibold text-highlighted">
          Responsáveis e comissão
        </h3>
      </div>
    </template>

    <div class="space-y-4">
      <div
        v-if="!responsiblesInfo.length"
        class="rounded-xl border border-dashed border-default bg-elevated/40 px-4 py-8 text-center"
      >
        <UIcon name="i-lucide-users-round" class="mx-auto size-8 text-dimmed" />
        <p class="mt-3 text-sm font-medium text-highlighted">
          Nenhum responsável adicionado
        </p>
        <p class="mt-1 text-sm text-muted">
          Esta OS não possui responsáveis vinculados.
        </p>
      </div>

      <div
        v-for="assignee in responsiblesInfo"
        :key="assignee.employee_id"
        class="rounded-xl border border-default bg-default p-4 shadow-xs"
      >
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div class="min-w-0 flex-1">
            <div
              class="rounded-xl border border-default bg-default px-3 py-2 text-sm text-highlighted"
            >
              {{ assignee.name ?? "Funcionário não encontrado" }}
            </div>

            <div
              class="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-elevated/60 px-3 py-2 text-sm lg:flex-nowrap"
            >
              <ServiceOrdersCommissionBreakdownPopover
                :total="assignee.commission_amount ?? 0"
                :lines="assignee.item_breakdown"
                title="Comissão por item"
                empty-message="Nenhum item comissionado"
                :disabled="!assignee.item_breakdown.length"
              >
                <UBadge
                  color="primary"
                  variant="soft"
                  leading-icon="i-lucide-wallet-cards"
                  :label="`Comissão: ${formatCurrency(assignee.commission_amount)}`"
                  class="cursor-default"
                />
              </ServiceOrdersCommissionBreakdownPopover>
              <UTooltip
                v-if="getResponsibleCommissionNote(assignee).tooltip"
                :text="getResponsibleCommissionNote(assignee).tooltip ?? undefined"
                :ui="{ content: 'h-auto max-w-64 py-1.5', text: 'whitespace-normal' }"
              >
                <UBadge
                  :color="getResponsibleCommissionNote(assignee).color"
                  variant="subtle"
                  :leading-icon="getResponsibleCommissionNote(assignee).icon"
                  :label="getResponsibleCommissionNote(assignee).label"
                />
              </UTooltip>
              <UBadge
                v-else
                :color="getResponsibleCommissionNote(assignee).color"
                variant="subtle"
                :leading-icon="getResponsibleCommissionNote(assignee).icon"
                :label="getResponsibleCommissionNote(assignee).label"
              />
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="responsiblesInfo.length"
        class="rounded-xl border border-success/20 bg-success/10 p-4"
      >
        <p class="text-xs uppercase tracking-wide text-success/80">
          Total de comissão estimada
        </p>
        <p class="mt-1 text-lg font-semibold text-success">
          {{ formatCurrency(totalCommissionAmount) }}
        </p>
      </div>
    </div>
  </UCard>
</template>
