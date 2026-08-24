<script setup lang="ts">
import type { ServiceOrderDetailFull } from '~/types/service-orders'
import {
  computeServiceOrderCommissionBreakdown,
  formatCurrency
} from '~/utils/service-orders'
import type { CommissionBreakdownLine } from '../CommissionBreakdownPopover.vue'

const props = defineProps<{
  orderId: string
  order: ServiceOrderDetailFull['order']
  responsibleNames: ServiceOrderDetailFull['responsibleNames']
  employees: ServiceOrderDetailFull['employees']
  commissions: ServiceOrderDetailFull['commissions']
  canUpdate?: boolean
}>()

const emit = defineEmits<{ recalculated: [] }>()

const toast = useToast()

type ResponsibleInfo = {
  employee_id: string
  name: string | null
  commission_type: string | null | undefined
  configured_commission_amount: number | null | undefined
  commission_base: string | null | undefined
  commission_categories: string[]
  has_commission: boolean
  commission_amount: number | null
  item_breakdown: CommissionBreakdownLine[]
}

const commissionBreakdown = computed(() =>
  computeServiceOrderCommissionBreakdown(props.order, props.employees)
)

const responsiblesInfo = computed<ResponsibleInfo[]>(() => {
  const items = props.order.items ?? []

  return props.responsibleNames.map((r) => {
    const emp = props.employees.find(e => e.id === r.employee_id)

    const commission_amount = emp
      ? (commissionBreakdown.value.byEmployeeId.get(emp.id)?.value ?? 0)
      : 0

    const item_breakdown: CommissionBreakdownLine[] = []
    if (emp) {
      for (const [itemIndex, entry] of commissionBreakdown.value.byItemIndex) {
        const c = entry.commissions.find(x => x.employee_id === emp.id)
        if (!c || c.amount <= 0) continue
        const item = items[itemIndex]
        if (!item) continue
        item_breakdown.push({
          label: item.description || item.name || `Item ${itemIndex + 1}`,
          amount: c.amount
        })
      }
    }

    return {
      employee_id: r.employee_id,
      name: r.name,
      commission_type: emp?.commission_type,
      configured_commission_amount: emp?.commission_amount,
      commission_base: emp?.commission_base,
      commission_categories: emp?.commission_categories ?? [],
      has_commission: Boolean(emp?.has_commission),
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

function getResponsibleRateLabel(assignee: ResponsibleInfo) {
  if (!assignee.has_commission || assignee.configured_commission_amount == null)
    return null

  return assignee.commission_type === 'percentage'
    ? `${assignee.configured_commission_amount}%`
    : formatCurrency(assignee.configured_commission_amount)
}

function getResponsibleBaseLabel(assignee: ResponsibleInfo) {
  if (!assignee.has_commission) return null

  return assignee.commission_base === 'profit'
    ? 'Base: lucro'
    : 'Base: faturamento'
}

function getResponsibleCommissionNote(assignee: ResponsibleInfo) {
  if (!assignee.has_commission) {
    return {
      label: 'Sem comissão',
      color: 'neutral' as const,
      icon: 'i-lucide-circle-off'
    }
  }
  return null
}

// ─── Recalculate ───────────────────────────────────────────────────────────────

const recalculatingEmployeeId = ref<string | null>(null)
const pendingRecalculate = ref<{ employeeId: string, name: string | null, currentAmount: number } | null>(null)
const recalculateReason = ref('')
const recalculateReasonValid = computed(() => recalculateReason.value.trim().length > 0)

function requestRecalculate(assignee: ResponsibleInfo) {
  pendingRecalculate.value = {
    employeeId: assignee.employee_id,
    name: assignee.name,
    currentAmount: assignee.commission_amount ?? 0
  }
}

function closeRecalculateModal() {
  if (recalculatingEmployeeId.value) return
  pendingRecalculate.value = null
  recalculateReason.value = ''
}

async function confirmRecalculate() {
  if (!pendingRecalculate.value || !recalculateReasonValid.value) return
  const { employeeId, name } = pendingRecalculate.value
  recalculatingEmployeeId.value = employeeId

  try {
    const { data } = await $fetch<{
      data: { recalculationLogEntry: { previous_amount: number, new_amount: number } | null }
    }>(`/api/service-orders/${props.orderId}/generate-commissions`, {
      method: 'POST',
      body: { employeeId, reason: recalculateReason.value.trim() }
    })

    const entry = data.recalculationLogEntry
    toast.add({
      title: 'Comissão recalculada com sucesso',
      description: entry
        ? `${name ?? 'Funcionário'}: ${formatCurrency(entry.previous_amount)} → ${formatCurrency(entry.new_amount)}`
        : undefined,
      color: 'success'
    })
    pendingRecalculate.value = null
    recalculateReason.value = ''
    emit('recalculated')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro ao recalcular comissão',
      description: err?.data?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    recalculatingEmployeeId.value = null
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
              <UBadge
                v-if="getResponsibleRateLabel(assignee)"
                color="success"
                variant="subtle"
                leading-icon="i-lucide-badge-percent"
                :label="getResponsibleRateLabel(assignee)"
              />
              <UBadge
                v-if="getResponsibleBaseLabel(assignee)"
                color="neutral"
                variant="outline"
                leading-icon="i-lucide-scale"
                :label="getResponsibleBaseLabel(assignee)"
              />
              <UTooltip
                v-if="getResponsibleCommissionNote(assignee)"
                :text="getResponsibleCommissionNote(assignee)?.label"
              >
                <UButton
                  :color="
                    getResponsibleCommissionNote(assignee)?.color ?? 'neutral'
                  "
                  variant="ghost"
                  :icon="getResponsibleCommissionNote(assignee)?.icon"
                  size="xs"
                  square
                />
              </UTooltip>
              <UButton
                v-if="canUpdate && assignee.has_commission"
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-refresh-cw"
                label="Recalcular"
                :loading="recalculatingEmployeeId === assignee.employee_id"
                :disabled="!!recalculatingEmployeeId"
                square
                @click="requestRecalculate(assignee)"
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

  <!-- Recalculate confirmation -->
  <AppConfirmModal
    :open="!!pendingRecalculate"
    title="Recalcular comissão"
    confirm-label="Recalcular"
    confirm-color="primary"
    :loading="!!recalculatingEmployeeId"
    :confirm-disabled="!recalculateReasonValid"
    @update:open="(value: boolean) => !value && closeRecalculateModal()"
    @confirm="confirmRecalculate"
  >
    <template #description>
      <div class="space-y-3">
        <p class="text-sm text-muted">
          Isso recalcula a comissão de
          <strong class="text-highlighted">{{ pendingRecalculate?.name ?? 'este funcionário' }}</strong>
          com base na configuração de comissão atual dele e nos itens desta OS
          (valor estimado hoje: {{ formatCurrency(pendingRecalculate?.currentAmount ?? 0) }}).
        </p>
        <p class="text-sm text-muted">
          Só é possível recalcular comissões ainda não pagas. Se este
          funcionário já tiver alguma comissão paga nesta OS, o recálculo será
          bloqueado.
        </p>
        <UFormField label="Motivo do recálculo" required>
          <UTextarea
            v-model="recalculateReason"
            class="w-full"
            :rows="2"
            placeholder="Ex.: percentual de comissão do funcionário foi alterado"
          />
        </UFormField>
      </div>
    </template>
  </AppConfirmModal>
</template>
