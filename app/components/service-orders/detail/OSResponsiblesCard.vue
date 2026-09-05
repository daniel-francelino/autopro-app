<script setup lang="ts">
import type { ServiceOrderDetailFull, ServiceOrderCommissionManualAdjustmentLogEntry } from '~/types/service-orders'
import {
  computeServiceOrderCommissionBreakdown,
  formatCommissionRuleSublabel,
  formatCurrency
} from '~/utils/service-orders'
import {
  getActiveOverridePlanIds,
  resolveEffectiveCommissionRules,
  type ResolvedCommissionRule
} from '../../../../lib/utils/employee-commission-engine'
import type { CommissionBreakdownLine } from '../CommissionBreakdownPopover.vue'

type CommissionPlanOption = {
  id: string
  name: string
  currentVersion: { ruleCount: number, categoryCount: number } | null
}

const props = defineProps<{
  orderId: string
  order: ServiceOrderDetailFull['order']
  responsibleNames: ServiceOrderDetailFull['responsibleNames']
  commissions: ServiceOrderDetailFull['commissions']
  canUpdate?: boolean
}>()

const emit = defineEmits<{ recalculated: [] }>()

const toast = useToast()

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { data: categoriesData } = await useAsyncData(
  'product-categories-lookup',
  () => requestFetch<{ items: Array<{ id: string, name: string }> }>('/api/product-categories', { headers: requestHeaders }),
  { default: () => ({ items: [] }) }
)
const categoryNameById = computed(() => new Map(categoriesData.value?.items.map(c => [c.id, c.name]) ?? []))

// Options for the "aplicar comissão manual" plan picker — same source as
// Financeiro > Comissões. Requires commissions.read; if the current user
// doesn't have it, this just resolves empty (see docs/finance/
// commissions-manual-override.md §12.5) rather than breaking the card.
const { data: commissionPlansData } = await useAsyncData(
  'commission-plans-lookup',
  () => requestFetch<{ items: CommissionPlanOption[] }>('/api/commissions', {
    query: { activeOnly: 'true' },
    headers: requestHeaders
  }),
  { default: () => ({ items: [] }) }
)
const commissionPlanOptions = computed(() => commissionPlansData.value?.items ?? [])

type ResponsibleInfo = {
  employee_id: string
  name: string | null
  /** This employee has at least one active plan in the new model (docs/finance/commissions-configuration-architecture.md). */
  has_commission_plan: boolean
  commission_amount: number
  item_breakdown: CommissionBreakdownLine[]
  /** Rules actually driving this employee's commission on this OS — their override plan's rules when one is active, otherwise their own (docs/finance/commissions-manual-override.md). Feeds the "Regras" popover. */
  effectiveRules: ResolvedCommissionRule[]
  /** Active override entry for this employee on this OS, or null. */
  override: ServiceOrderCommissionManualAdjustmentLogEntry | null
}

const { rulesByEmployeeId, ensureRules } = useEmployeeCommissionRules()
const { rulesByPlanId, ensureRules: ensurePlanRules } = usePlanCommissionRules()

watch(
  () => [props.order.responsible_employees, props.order.entry_date] as const,
  ([responsibleEmployees, entryDate]) => {
    const responsibleEmployeeIds = (responsibleEmployees ?? []).map(r => r.employee_id)
    ensureRules(responsibleEmployeeIds, entryDate || new Date().toISOString().substring(0, 10))
  },
  { immediate: true, deep: true }
)

watch(
  () => [props.order.commission_manual_adjustments_log, props.order.entry_date] as const,
  ([log, entryDate]) => {
    ensurePlanRules(getActiveOverridePlanIds(log ?? []), entryDate || new Date().toISOString().substring(0, 10))
  },
  { immediate: true, deep: true }
)

const commissionBreakdown = computed(() =>
  computeServiceOrderCommissionBreakdown(props.order, rulesByEmployeeId.value, rulesByPlanId.value)
)

/**
 * Same patch-over-standard resolution computeServiceOrderCommissionBreakdown()
 * applies internally — recomputed here (cheap, pure, no I/O) just so the
 * "Regras" popover can show exactly which rules are driving the amount above
 * it: the override's rules for the categories it covers, the employee's own
 * rules for everything else (docs/finance/commissions-manual-override.md).
 */
const effectiveRulesByEmployeeId = computed(() =>
  resolveEffectiveCommissionRules(
    rulesByEmployeeId.value,
    props.order.commission_manual_adjustments_log ?? [],
    rulesByPlanId.value
  )
)

/** Last log entry with an override_action for this employee — the active override when it's an 'apply', or null (removed, or never had one). */
function getAssigneeOverride(employeeId: string): ServiceOrderCommissionManualAdjustmentLogEntry | null {
  const log = props.order.commission_manual_adjustments_log ?? []
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i]!
    if (entry.employee_id !== employeeId || !entry.override_action) continue
    return entry.override_action === 'apply' ? entry : null
  }
  return null
}

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

    const override = getAssigneeOverride(r.employee_id)
    const effectiveRules = effectiveRulesByEmployeeId.value.get(r.employee_id) ?? []

    return {
      employee_id: r.employee_id,
      name: r.name,
      has_commission_plan: (rulesByEmployeeId.value.get(r.employee_id)?.length ?? 0) > 0,
      commission_amount,
      item_breakdown,
      effectiveRules,
      override
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
      color: 'primary' as const,
      icon: 'i-lucide-list-checks'
    }
  }

  return {
    label: 'Sem comissão',
    color: 'neutral' as const,
    icon: 'i-lucide-circle-off'
  }
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

// ─── Manual commission override (docs/finance/commissions-manual-override.md) ──
// Applies/removes an existing commission configuration (not a typed-in
// rate) for one employee, scoped to this OS — the configuration can have
// several rules by category, same as a normal assignment would.

const commissionPlanSelectItems = computed(() =>
  commissionPlanOptions.value.map(plan => ({
    label: plan.currentVersion
      ? `${plan.name} (${plan.currentVersion.ruleCount} ${plan.currentVersion.ruleCount === 1 ? 'regra' : 'regras'}, ${plan.currentVersion.categoryCount} ${plan.currentVersion.categoryCount === 1 ? 'categoria' : 'categorias'})`
      : `${plan.name} (sem versão vigente)`,
    value: plan.id
  }))
)

const overrideSubmittingEmployeeId = ref<string | null>(null)

const pendingOverrideApply = ref<{ employeeId: string, name: string | null, isEdit: boolean } | null>(null)
const overrideSelectedPlanId = ref<string | undefined>(undefined)
const overrideApplyReason = ref('')
const overrideApplyValid = computed(() =>
  overrideApplyReason.value.trim().length > 0 && !!overrideSelectedPlanId.value
)

function requestApplyOverride(assignee: ResponsibleInfo) {
  pendingOverrideApply.value = {
    employeeId: assignee.employee_id,
    name: assignee.name,
    isEdit: !!assignee.override
  }
  overrideSelectedPlanId.value = assignee.override?.override_commission_plan_id ?? undefined
  overrideApplyReason.value = ''
}

function closeOverrideApplyModal() {
  if (overrideSubmittingEmployeeId.value) return
  pendingOverrideApply.value = null
  overrideSelectedPlanId.value = undefined
  overrideApplyReason.value = ''
}

async function confirmApplyOverride() {
  if (!pendingOverrideApply.value || !overrideApplyValid.value) return
  const { employeeId, name } = pendingOverrideApply.value
  overrideSubmittingEmployeeId.value = employeeId

  try {
    const { data } = await $fetch<{
      data: { recalculationLogEntry: { previous_amount: number, new_amount: number } | null }
    }>(`/api/service-orders/${props.orderId}/generate-commissions`, {
      method: 'POST',
      body: {
        employeeId,
        reason: overrideApplyReason.value.trim(),
        override: { action: 'apply', commissionPlanId: overrideSelectedPlanId.value }
      }
    })

    const entry = data.recalculationLogEntry
    toast.add({
      title: 'Comissão manual aplicada',
      description: entry
        ? `${name ?? 'Funcionário'}: ${formatCurrency(entry.previous_amount)} → ${formatCurrency(entry.new_amount)}`
        : undefined,
      color: 'success'
    })
    closeOverrideApplyModal()
    emit('recalculated')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro ao aplicar comissão manual',
      description: err?.data?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    overrideSubmittingEmployeeId.value = null
  }
}

const pendingOverrideRemove = ref<{ employeeId: string, name: string | null } | null>(null)
const overrideRemoveReason = ref('')
const overrideRemoveReasonValid = computed(() => overrideRemoveReason.value.trim().length > 0)

function requestRemoveOverride(assignee: ResponsibleInfo) {
  pendingOverrideRemove.value = { employeeId: assignee.employee_id, name: assignee.name }
  overrideRemoveReason.value = ''
}

function closeOverrideRemoveModal() {
  if (overrideSubmittingEmployeeId.value) return
  pendingOverrideRemove.value = null
  overrideRemoveReason.value = ''
}

async function confirmRemoveOverride() {
  if (!pendingOverrideRemove.value || !overrideRemoveReasonValid.value) return
  const { employeeId, name } = pendingOverrideRemove.value
  overrideSubmittingEmployeeId.value = employeeId

  try {
    const { data } = await $fetch<{
      data: { recalculationLogEntry: { previous_amount: number, new_amount: number } | null }
    }>(`/api/service-orders/${props.orderId}/generate-commissions`, {
      method: 'POST',
      body: { employeeId, reason: overrideRemoveReason.value.trim(), override: { action: 'remove' } }
    })

    const entry = data.recalculationLogEntry
    toast.add({
      title: 'Comissão manual removida',
      description: entry
        ? `${name ?? 'Funcionário'} volta ao plano padrão: ${formatCurrency(entry.previous_amount)} → ${formatCurrency(entry.new_amount)}`
        : undefined,
      color: 'success'
    })
    closeOverrideRemoveModal()
    emit('recalculated')
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string } }
    toast.add({
      title: 'Erro ao remover comissão manual',
      description: err?.data?.statusMessage || 'Tente novamente.',
      color: 'error'
    })
  } finally {
    overrideSubmittingEmployeeId.value = null
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
              <ServiceOrdersCommissionRulesPopover
                v-if="assignee.has_commission_plan"
                :rules="assignee.effectiveRules"
                :category-name-by-id="categoryNameById"
              >
                <UBadge
                  :color="getResponsibleCommissionNote(assignee).color"
                  variant="subtle"
                  :leading-icon="getResponsibleCommissionNote(assignee).icon"
                  :label="getResponsibleCommissionNote(assignee).label"
                />
              </ServiceOrdersCommissionRulesPopover>
              <UBadge
                v-else
                :color="getResponsibleCommissionNote(assignee).color"
                variant="subtle"
                :leading-icon="getResponsibleCommissionNote(assignee).icon"
                :label="getResponsibleCommissionNote(assignee).label"
              />
              <UTooltip
                v-if="assignee.override"
                :text="`Motivo: ${assignee.override.reason} — aplicado por ${assignee.override.recalculated_by_name ?? assignee.override.recalculated_by_email ?? 'alguém'}`"
                :ui="{ content: 'h-auto max-w-64 py-1.5', text: 'whitespace-normal' }"
              >
                <UBadge
                  color="warning"
                  variant="subtle"
                  leading-icon="i-lucide-sparkles"
                  :label="`Comissão manual: ${assignee.override.override_commission_plan_name ?? 'configuração removida'}`"
                />
              </UTooltip>
              <UButton
                v-if="canUpdate && assignee.has_commission_plan"
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
              <UButton
                v-if="canUpdate && assignee.has_commission_plan"
                size="xs"
                color="warning"
                variant="soft"
                icon="i-lucide-sparkles"
                :label="assignee.override ? 'Trocar comissão' : 'Aplicar comissão diferente'"
                :loading="overrideSubmittingEmployeeId === assignee.employee_id"
                :disabled="!!overrideSubmittingEmployeeId"
                square
                @click="requestApplyOverride(assignee)"
              />
              <UButton
                v-if="canUpdate && assignee.override"
                size="xs"
                color="error"
                variant="soft"
                icon="i-lucide-rotate-ccw"
                label="Remover"
                :loading="overrideSubmittingEmployeeId === assignee.employee_id"
                :disabled="!!overrideSubmittingEmployeeId"
                square
                @click="requestRemoveOverride(assignee)"
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

  <!-- Apply/change manual commission override -->
  <AppConfirmModal
    :open="!!pendingOverrideApply"
    :title="pendingOverrideApply?.isEdit ? 'Trocar comissão manual' : 'Aplicar comissão diferente'"
    :confirm-label="pendingOverrideApply?.isEdit ? 'Trocar' : 'Aplicar'"
    confirm-color="warning"
    :loading="!!overrideSubmittingEmployeeId"
    :confirm-disabled="!overrideApplyValid"
    @update:open="(value: boolean) => !value && closeOverrideApplyModal()"
    @confirm="confirmApplyOverride"
  >
    <template #description>
      <div class="space-y-3">
        <p class="text-sm text-muted">
          Aplica uma configuração de comissão diferente da padrão para
          <strong class="text-highlighted">{{ pendingOverrideApply?.name ?? 'este funcionário' }}</strong>,
          só nesta OS — não muda a atribuição padrão dele em Financeiro > Comissões.
        </p>
        <p class="text-sm text-muted">
          Vale só para as categorias que essa configuração cobre. Se ela não
          cobrir alguma categoria dos itens desta OS, esses itens continuam
          na comissão padrão do funcionário — a configuração escolhida não
          substitui tudo, só sobrepõe onde ela tem uma regra.
        </p>
        <UFormField label="Configuração de comissão" required>
          <USelectMenu
            v-model="overrideSelectedPlanId"
            :items="commissionPlanSelectItems"
            value-key="value"
            placeholder="Selecione uma configuração"
            class="w-full"
          />
        </UFormField>
        <p class="text-sm text-muted">
          Só é possível aplicar/trocar comissões ainda não pagas.
        </p>
        <UFormField label="Motivo" required>
          <UTextarea
            v-model="overrideApplyReason"
            class="w-full"
            :rows="2"
            placeholder="Ex.: funcionário ficou até tarde neste serviço"
          />
        </UFormField>
      </div>
    </template>
  </AppConfirmModal>

  <!-- Remove manual commission override -->
  <AppConfirmModal
    :open="!!pendingOverrideRemove"
    title="Remover comissão manual"
    confirm-label="Remover"
    confirm-color="error"
    :loading="!!overrideSubmittingEmployeeId"
    :confirm-disabled="!overrideRemoveReasonValid"
    @update:open="(value: boolean) => !value && closeOverrideRemoveModal()"
    @confirm="confirmRemoveOverride"
  >
    <template #description>
      <div class="space-y-3">
        <p class="text-sm text-muted">
          Remove a comissão manual de
          <strong class="text-highlighted">{{ pendingOverrideRemove?.name ?? 'este funcionário' }}</strong>
          nesta OS — a comissão dele volta a usar a configuração padrão
          atribuída em Financeiro > Comissões.
        </p>
        <UFormField label="Motivo" required>
          <UTextarea
            v-model="overrideRemoveReason"
            class="w-full"
            :rows="2"
            placeholder="Ex.: OS revisada, comissão manual não se aplica mais"
          />
        </UFormField>
      </div>
    </template>
  </AppConfirmModal>
</template>
