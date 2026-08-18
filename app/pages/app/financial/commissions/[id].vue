<script setup lang="ts">
import { ActionCode } from '~/constants/action-codes'

definePageMeta({ layout: 'app' })

interface CommissionRuleItem {
  id: string
  name: string | null
  commission_type: 'percentage' | 'fixed_amount'
  commission_amount: number
  commission_base: 'revenue' | 'profit'
  is_default: boolean
  sort_order: number
  categories: Array<{ id: string, name: string | null }>
}

interface CommissionRuleVersionItem {
  id: string
  effective_from: string
  notes: string | null
  created_at?: string
  created_by?: string | null
  isEffective: boolean
  rules: CommissionRuleItem[]
}

interface CommissionAssignmentItem {
  id: string
  employeeId: string
  employeeName: string
  active: boolean
}

interface CommissionPlanDetail {
  id: string
  name: string
  description: string | null
  active: boolean
  versions: CommissionRuleVersionItem[]
  currentVersionId: string | null
  assignments: CommissionAssignmentItem[]
}

const route = useRoute()
const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const canRead = computed(() => workshop.can(ActionCode.COMMISSIONS_READ))
const canUpdate = computed(() => workshop.can(ActionCode.COMMISSIONS_UPDATE))

const planId = computed(() => String(route.params.id || ''))

const { data, status, error, refresh } = await useAsyncData(
  () => `commission-plan-detail-${planId.value}`,
  () => requestFetch<{ item: CommissionPlanDetail }>(`/api/commissions/${planId.value}`, { headers: requestHeaders })
)

const plan = computed(() => data.value?.item ?? null)
useSeoMeta({ title: () => plan.value?.name || 'Comissão' })

const currentVersion = computed(() =>
  plan.value?.versions.find(version => version.id === plan.value?.currentVersionId) ?? null
)
const activeAssignments = computed(() => (plan.value?.assignments ?? []).filter(assignment => assignment.active))
const assignedEmployeeIds = computed(() => activeAssignments.value.map(assignment => assignment.employeeId))

function formatCurrency(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const [year, month, day] = String(value).split('-')
  if (!year || !month || !day) return String(value)
  return `${day}/${month}/${year}`
}
function ruleAmountLabel(rule: CommissionRuleItem) {
  return rule.commission_type === 'percentage'
    ? `${Number(rule.commission_amount).toLocaleString('pt-BR')}%`
    : formatCurrency(rule.commission_amount)
}
function ruleBaseLabel(rule: CommissionRuleItem) {
  return rule.commission_base === 'profit' ? 'Lucro' : 'Faturamento'
}

function retryLoad() {
  return refresh()
}

// ─── Toggle active ──────────────────────────────────────────────────────────
const isTogglingActive = ref(false)
async function toggleActive() {
  if (!plan.value || isTogglingActive.value) return
  isTogglingActive.value = true
  try {
    await $fetch(`/api/commissions/${planId.value}`, { method: 'PUT', body: { active: !plan.value.active } })
    await refresh()
  } catch {
    toast.add({ title: 'Erro ao atualizar status da comissão', color: 'error' })
  } finally {
    isTogglingActive.value = false
  }
}

// ─── Version modal ──────────────────────────────────────────────────────────
const showVersionModal = ref(false)
const currentRulesForModal = computed(() =>
  (currentVersion.value?.rules ?? []).map(rule => ({
    name: rule.name,
    commission_type: rule.commission_type,
    commission_amount: rule.commission_amount,
    commission_base: rule.commission_base,
    is_default: rule.is_default,
    category_ids: rule.categories.map(category => category.id)
  }))
)
async function onVersionSaved() {
  showVersionModal.value = false
  await refresh()
}

// ─── Assign employee ────────────────────────────────────────────────────────
const showAssignModal = ref(false)
async function onAssigned() {
  showAssignModal.value = false
  await refresh()
}

// ─── Unassign ───────────────────────────────────────────────────────────────
const isUnassigning = ref(false)
const showUnassignModal = ref(false)
const assignmentPendingUnassign = ref<CommissionAssignmentItem | null>(null)

function requestUnassign(assignment: CommissionAssignmentItem) {
  if (isUnassigning.value) return
  assignmentPendingUnassign.value = assignment
  showUnassignModal.value = true
}

async function confirmUnassign() {
  if (!assignmentPendingUnassign.value || isUnassigning.value) return
  isUnassigning.value = true
  try {
    await $fetch(`/api/commissions/${planId.value}/assignments/${assignmentPendingUnassign.value.employeeId}`, { method: 'DELETE' })
    toast.add({ title: 'Funcionário removido da comissão', color: 'success' })
    showUnassignModal.value = false
    assignmentPendingUnassign.value = null
    await refresh()
  } catch {
    toast.add({ title: 'Erro ao remover funcionário', color: 'error' })
  } finally {
    isUnassigning.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Comissões">
        <template #right>
          <UButton
            label="Voltar"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            to="/app/financial/commissions"
          />
        </template>
      </AppPageHeader>
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar comissões.
        </p>
      </div>

      <div v-else class="space-y-4 p-4">
        <template v-if="status === 'pending' && !plan">
          <USkeleton class="h-20 w-full rounded-2xl" />
          <USkeleton class="h-40 w-full rounded-2xl" />
          <USkeleton class="h-64 w-full rounded-2xl" />
        </template>

        <template v-else-if="error || !plan">
          <div class="rounded-2xl border border-error/30 bg-error/10 p-6">
            <p class="text-sm font-medium text-error">
              Não foi possível carregar esta comissão.
            </p>
            <div class="mt-4 flex gap-2">
              <UButton
                label="Tentar novamente"
                icon="i-lucide-rotate-cw"
                color="neutral"
                @click="retryLoad"
              />
              <UButton
                label="Voltar para comissões"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                to="/app/financial/commissions"
              />
            </div>
          </div>
        </template>

        <template v-else>
          <!-- Cabeçalho -->
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-default bg-elevated/30 p-4">
            <div class="flex items-center gap-3">
              <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <UIcon name="i-lucide-badge-percent" class="size-5 text-primary" />
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h1 class="text-lg font-semibold text-highlighted">
                    {{ plan.name }}
                  </h1>
                  <UBadge
                    :label="plan.active ? 'Ativo' : 'Inativo'"
                    :color="plan.active ? 'success' : 'neutral'"
                    variant="subtle"
                    size="sm"
                  />
                </div>
                <p v-if="plan.description" class="text-sm text-muted">
                  {{ plan.description }}
                </p>
              </div>
            </div>
            <UButton
              v-if="canUpdate"
              :label="plan.active ? 'Desativar' : 'Ativar'"
              :icon="plan.active ? 'i-lucide-power-off' : 'i-lucide-power'"
              color="neutral"
              variant="outline"
              size="sm"
              :loading="isTogglingActive"
              @click="toggleActive"
            />
          </div>

          <!-- Regras vigentes -->
          <div class="space-y-3 rounded-2xl border border-default p-4">
            <div class="flex items-center justify-between gap-3">
              <p class="flex items-center gap-2 text-sm font-semibold text-highlighted">
                <UIcon name="i-lucide-list-checks" class="size-4 text-muted" />
                Regras vigentes
              </p>
              <UButton
                v-if="canUpdate"
                label="Alterar regras"
                icon="i-lucide-pencil"
                color="neutral"
                variant="outline"
                size="xs"
                @click="showVersionModal = true"
              />
            </div>

            <p v-if="!currentVersion" class="text-sm text-muted">
              Nenhuma versão vigente.
            </p>
            <template v-else>
              <p class="text-xs text-muted">
                Vigente desde {{ formatDate(currentVersion.effective_from) }}
              </p>
              <div class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
                <div
                  v-for="rule in currentVersion.rules"
                  :key="rule.id"
                  class="rounded-xl border border-default/70 bg-default/40 p-3"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-medium text-highlighted">{{ ruleAmountLabel(rule) }}</span>
                    <UBadge
                      :label="ruleBaseLabel(rule)"
                      color="neutral"
                      variant="subtle"
                      size="sm"
                    />
                    <UBadge
                      v-if="rule.is_default"
                      label="Padrão (catch-all)"
                      color="info"
                      variant="subtle"
                      size="sm"
                    />
                  </div>
                  <p v-if="rule.name" class="mt-1 text-xs font-medium text-highlighted">
                    {{ rule.name }}
                  </p>
                  <p v-if="!rule.is_default" class="mt-1 text-xs text-muted">
                    <template v-if="rule.categories.length">
                      {{ rule.categories.map(c => c.name).join(', ') }}
                    </template>
                    <template v-else>
                      Nenhuma categoria vinculada
                    </template>
                  </p>
                </div>
              </div>
            </template>

            <details v-if="plan.versions.length > 1" class="group">
              <summary class="cursor-pointer text-sm text-primary select-none">
                Ver histórico de versões ({{ plan.versions.length }})
              </summary>
              <div class="mt-3 overflow-x-auto rounded-xl border border-default">
                <table class="min-w-full text-sm">
                  <thead class="bg-elevated/40">
                    <tr>
                      <th class="px-3 py-2 text-left font-medium text-muted">
                        Vigente a partir de
                      </th>
                      <th class="px-3 py-2 text-left font-medium text-muted">
                        Regras
                      </th>
                      <th class="px-3 py-2 text-left font-medium text-muted">
                        Notas
                      </th>
                      <th class="px-3 py-2 text-left font-medium text-muted">
                        Criado em
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-default/60">
                    <tr v-for="version in plan.versions" :key="version.id">
                      <td class="px-3 py-2">
                        {{ formatDate(version.effective_from) }}
                        <UBadge
                          v-if="version.isEffective"
                          label="Vigente"
                          color="success"
                          variant="subtle"
                          size="sm"
                          class="ml-1"
                        />
                      </td>
                      <td class="px-3 py-2">
                        {{ version.rules.length }} regra{{ version.rules.length !== 1 ? 's' : '' }}
                      </td>
                      <td class="px-3 py-2 text-muted">
                        {{ version.notes || '—' }}
                      </td>
                      <td class="px-3 py-2 text-muted">
                        {{ formatDate(version.created_at?.split('T')[0]) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          </div>

          <!-- Funcionários atribuídos -->
          <div class="space-y-3 rounded-2xl border border-default p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="flex items-center gap-2 text-sm font-semibold text-highlighted">
                <UIcon name="i-lucide-users-round" class="size-4 text-muted" />
                Funcionários atribuídos
              </p>
              <UButton
                v-if="canUpdate"
                label="Atribuir funcionário"
                icon="i-lucide-user-plus"
                color="neutral"
                variant="outline"
                size="sm"
                @click="showAssignModal = true"
              />
            </div>

            <div v-if="activeAssignments.length === 0" class="rounded-xl border border-dashed border-default p-6 text-center text-sm text-muted">
              Nenhum funcionário atribuído ainda.
            </div>

            <div v-else class="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
              <div
                v-for="assignment in activeAssignments"
                :key="assignment.id"
                class="flex items-center justify-between gap-2 rounded-xl border border-default/70 bg-default/40 p-3"
              >
                <NuxtLink
                  :to="`/app/settings/employees/${assignment.employeeId}`"
                  class="truncate text-sm font-medium text-highlighted hover:underline"
                >
                  {{ assignment.employeeName }}
                </NuxtLink>
                <UTooltip v-if="canUpdate" text="Remover da comissão">
                  <UButton
                    icon="i-lucide-x"
                    color="error"
                    variant="ghost"
                    size="xs"
                    @click="requestUnassign(assignment)"
                  />
                </UTooltip>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>

  <FinancialCommissionsVersionModal
    v-if="plan"
    v-model:open="showVersionModal"
    :plan-id="planId"
    :current-rules="currentRulesForModal"
    @saved="onVersionSaved"
  />

  <FinancialCommissionsAssignEmployeeModal
    v-model:open="showAssignModal"
    :plan-id="planId"
    :exclude-employee-ids="assignedEmployeeIds"
    @assigned="onAssigned"
  />

  <AppConfirmModal
    v-model:open="showUnassignModal"
    title="Remover funcionário da comissão"
    confirm-label="Remover"
    confirm-color="error"
    :loading="isUnassigning"
    @confirm="confirmUnassign"
    @update:open="(value: boolean) => { showUnassignModal = value; if (!value && !isUnassigning) assignmentPendingUnassign = null }"
  >
    <template #description>
      <p class="text-sm text-muted">
        Remover <strong class="text-highlighted">{{ assignmentPendingUnassign?.employeeName || 'este funcionário' }}</strong> desta comissão?
        Comissões já geradas para ele continuam no histórico.
      </p>
    </template>
  </AppConfirmModal>
</template>
