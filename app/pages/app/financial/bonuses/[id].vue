<script setup lang="ts">
import { ActionCode } from '~/constants/action-codes'

definePageMeta({ layout: 'app' })

type CommissionBase = 'revenue' | 'profit' | 'revenue_minus_parts' | 'employee_net_profit'

interface BonusValueHistoryEntry {
  id: string
  commissionBase: CommissionBase
  goalAmount: number
  bonusAmount: number
  effectiveFrom: string
  createdAt?: string
  createdBy?: string | null
}

interface BonusAssignment {
  id: string
  employeeId: string
  employeeName: string
  active: boolean
}

interface BonusDetail {
  id: string
  name: string
  description: string | null
  active: boolean
  currentValue: { commissionBase: CommissionBase, goalAmount: number, bonusAmount: number, effectiveFrom: string } | null
  valueHistory: BonusValueHistoryEntry[]
  assignments: BonusAssignment[]
}

interface ProgressItem {
  employeeId: string
  employeeName: string
  referenceMonth: string
  commissionBase: CommissionBase | null
  goalAmount: number | null
  bonusAmount: number | null
  achievedAmount: number
  goalMet: boolean
  generated: boolean
  financialRecordId: string | null
}

interface GenerateResponse {
  data: {
    referenceMonth: string
    generatedCount: number
    skippedCount: number
    results: Array<{ employeeId: string, employeeName: string, status: string }>
  }
}

const route = useRoute()
const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const canRead = computed(() => workshop.can(ActionCode.BONUSES_READ))
const canUpdate = computed(() => workshop.can(ActionCode.BONUSES_UPDATE))

const bonusId = computed(() => String(route.params.id || ''))

const { data, status, error, refresh } = await useAsyncData(
  () => `bonus-detail-${bonusId.value}`,
  () => requestFetch<{ item: BonusDetail }>(`/api/bonuses/${bonusId.value}`, { headers: requestHeaders })
)

const bonus = computed(() => data.value?.item ?? null)

useSeoMeta({ title: () => bonus.value?.name || 'Bônus' })

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const referenceMonth = ref(currentMonthValue())
const isCurrentMonth = computed(() => referenceMonth.value === currentMonthValue())

// Wraps referenceMonth for the picker: "Limpar" emits undefined, which isn't
// a valid state here (there's always a month being viewed) — fall back to
// the current month instead of leaking an empty value into the API calls.
const referenceMonthInput = computed({
  get: () => referenceMonth.value,
  set: (value: string | undefined) => { referenceMonth.value = value || currentMonthValue() }
})

const { data: progressData, status: progressStatus, refresh: refreshProgress } = await useAsyncData(
  () => `bonus-progress-${bonusId.value}-${referenceMonth.value}`,
  () => requestFetch<{ items: ProgressItem[] }>(`/api/bonuses/${bonusId.value}/progress`, {
    headers: requestHeaders,
    query: { referenceMonth: `${referenceMonth.value}-01` }
  }),
  { watch: [referenceMonth], default: () => ({ items: [] }) }
)

const progressItems = computed(() => progressData.value?.items ?? [])
const isProgressLoading = computed(() => progressStatus.value === 'pending')
const generatedProgressItems = computed(() => progressItems.value.filter(item => item.generated))

const assignedEmployeeIds = computed(() => (bonus.value?.assignments ?? []).filter(a => a.active).map(a => a.employeeId))

function formatCurrency(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const [year, month, day] = String(value).split('-')
  if (!year || !month || !day) return String(value)
  return `${day}/${month}/${year}`
}

function formatMonthLabel(monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number)
  if (!year || !month) return monthValue
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

const commissionBaseLabel: Record<CommissionBase, string> = {
  revenue: 'Faturamento',
  profit: 'Lucro',
  revenue_minus_parts: 'Faturamento - peças',
  employee_net_profit: 'Lucro líquido do funcionário'
}

function retryLoad() {
  return refresh()
}

function progressStatusLabel(item: ProgressItem): { label: string, color: 'success' | 'warning' | 'neutral' } {
  if (item.goalAmount == null) return { label: 'Sem valor configurado', color: 'neutral' }
  if (item.goalMet) return { label: item.achievedAmount > item.goalAmount ? 'Meta superada' : 'Meta atingida', color: 'success' }
  return { label: 'Abaixo da meta', color: 'warning' }
}

function progressRatio(item: ProgressItem): number {
  if (!item.goalAmount) return 0
  return item.achievedAmount / item.goalAmount
}

function progressBarColor(item: ProgressItem): 'error' | 'warning' | 'success' {
  const ratio = progressRatio(item)
  if (ratio < 0.5) return 'error'
  if (ratio < 0.9) return 'warning'
  return 'success'
}

// ─── Toggle active ──────────────────────────────────────────────────────────
const isTogglingActive = ref(false)
async function toggleActive() {
  if (!bonus.value || isTogglingActive.value) return
  isTogglingActive.value = true
  try {
    await $fetch(`/api/bonuses/${bonusId.value}`, { method: 'PUT', body: { active: !bonus.value.active } })
    await refresh()
  } catch {
    toast.add({ title: 'Erro ao atualizar status do bônus', color: 'error' })
  } finally {
    isTogglingActive.value = false
  }
}

// ─── Value modal ────────────────────────────────────────────────────────────
const showValueModal = ref(false)
async function onValueSaved() {
  showValueModal.value = false
  await Promise.all([refresh(), refreshProgress()])
}

// ─── Assign employee ────────────────────────────────────────────────────────
const showAssignModal = ref(false)
async function onAssigned() {
  showAssignModal.value = false
  await Promise.all([refresh(), refreshProgress()])
}

// ─── Unassign ───────────────────────────────────────────────────────────────
const isUnassigning = ref(false)
const showUnassignModal = ref(false)
const employeePendingUnassign = ref<ProgressItem | null>(null)

function requestUnassign(item: ProgressItem) {
  if (isUnassigning.value) return
  employeePendingUnassign.value = item
  showUnassignModal.value = true
}

async function confirmUnassign() {
  if (!employeePendingUnassign.value || isUnassigning.value) return
  isUnassigning.value = true
  try {
    await $fetch(`/api/bonuses/${bonusId.value}/assignments/${employeePendingUnassign.value.employeeId}`, { method: 'DELETE' })
    toast.add({ title: 'Funcionário removido do bônus', color: 'success' })
    showUnassignModal.value = false
    employeePendingUnassign.value = null
    await Promise.all([refresh(), refreshProgress()])
  } catch {
    toast.add({ title: 'Erro ao remover funcionário do bônus', color: 'error' })
  } finally {
    isUnassigning.value = false
  }
}

// ─── Generate (bulk or single employee) ────────────────────────────────────
const isGeneratingBulk = ref(false)
const generatingEmployeeId = ref<string | null>(null)

async function generate(employeeId?: string) {
  if (isGeneratingBulk.value || generatingEmployeeId.value) return
  if (employeeId) generatingEmployeeId.value = employeeId
  else isGeneratingBulk.value = true

  try {
    const response = await $fetch<GenerateResponse>(`/api/bonuses/${bonusId.value}/generate`, {
      method: 'POST',
      body: { referenceMonth: `${referenceMonth.value}-01`, employeeId }
    })
    const { generatedCount, skippedCount } = response.data
    toast.add({
      title: 'Geração concluída',
      description: `${generatedCount} gerado(s), ${skippedCount} pulado(s).`,
      color: generatedCount > 0 ? 'success' : 'neutral'
    })
    await refreshProgress()
  } catch (err: unknown) {
    const error = err as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro ao gerar bônus', description: error?.data?.statusMessage || error?.statusMessage, color: 'error' })
  } finally {
    isGeneratingBulk.value = false
    generatingEmployeeId.value = null
  }
}

// Generating a past month is unusual — always confirm explicitly first
// (docs/employee-bonus-feature-design.md §9.2).
const showRetroactiveConfirm = ref(false)
const pendingGenerateEmployeeId = ref<string | undefined>(undefined)

function onGenerateClick(employeeId?: string) {
  if (!isCurrentMonth.value) {
    pendingGenerateEmployeeId.value = employeeId
    showRetroactiveConfirm.value = true
    return
  }
  generate(employeeId)
}

function confirmRetroactiveGenerate() {
  showRetroactiveConfirm.value = false
  generate(pendingGenerateEmployeeId.value)
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader :title="bonus?.name || 'Bônus'">
        <template #right>
          <UButton
            label="Voltar"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            to="/app/financial/bonuses"
          />
        </template>
      </AppPageHeader>
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar bônus.
        </p>
      </div>

      <div v-else class="space-y-4 p-4">
        <template v-if="status === 'pending' && !bonus">
          <USkeleton class="h-20 w-full rounded-2xl" />
          <USkeleton class="h-40 w-full rounded-2xl" />
          <USkeleton class="h-64 w-full rounded-2xl" />
        </template>

        <template v-else-if="error || !bonus">
          <div class="rounded-2xl border border-error/30 bg-error/10 p-6">
            <p class="text-sm font-medium text-error">
              Não foi possível carregar este bônus.
            </p>
            <div class="mt-4 flex gap-2">
              <UButton label="Tentar novamente" color="neutral" @click="retryLoad" />
              <UButton
                label="Voltar para bônus"
                color="neutral"
                variant="ghost"
                to="/app/financial/bonuses"
              />
            </div>
          </div>
        </template>

        <template v-else>
          <!-- Cabeçalho -->
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-default bg-elevated/30 p-4">
            <div class="flex items-center gap-3">
              <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <UIcon name="i-lucide-gift" class="size-5 text-primary" />
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h1 class="text-lg font-semibold text-highlighted">
                    {{ bonus.name }}
                  </h1>
                  <UBadge
                    :label="bonus.active ? 'Ativo' : 'Inativo'"
                    :color="bonus.active ? 'success' : 'neutral'"
                    variant="subtle"
                    size="sm"
                  />
                </div>
                <p v-if="bonus.description" class="text-sm text-muted">
                  {{ bonus.description }}
                </p>
              </div>
            </div>
            <UButton
              v-if="canUpdate"
              :label="bonus.active ? 'Desativar' : 'Ativar'"
              color="neutral"
              variant="outline"
              size="sm"
              :loading="isTogglingActive"
              @click="toggleActive"
            />
          </div>

          <!-- Valor atual -->
          <div class="space-y-3 rounded-2xl border border-default p-4">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm font-semibold text-highlighted">
                Valor atual
              </p>
              <UButton
                v-if="canUpdate"
                label="Alterar valor"
                icon="i-lucide-pencil"
                color="neutral"
                variant="outline"
                size="xs"
                @click="showValueModal = true"
              />
            </div>

            <div v-if="bonus.currentValue" class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div class="rounded-xl border border-default/70 bg-default/40 p-3">
                <p class="text-xs uppercase tracking-widest text-muted">
                  Base de cálculo
                </p>
                <p class="mt-1 text-sm font-medium text-highlighted">
                  {{ commissionBaseLabel[bonus.currentValue.commissionBase] }}
                </p>
              </div>
              <div class="rounded-xl border border-default/70 bg-default/40 p-3">
                <p class="text-xs uppercase tracking-widest text-muted">
                  Meta a bater
                </p>
                <p class="mt-1 text-sm font-medium text-highlighted">
                  {{ formatCurrency(bonus.currentValue.goalAmount) }}
                </p>
              </div>
              <div class="rounded-xl border border-default/70 bg-default/40 p-3">
                <p class="text-xs uppercase tracking-widest text-muted">
                  Valor do bônus
                </p>
                <p class="mt-1 text-sm font-medium text-success">
                  {{ formatCurrency(bonus.currentValue.bonusAmount) }}
                </p>
              </div>
            </div>
            <p v-else class="text-sm text-muted">
              Nenhum valor vigente para o mês atual.
            </p>

            <details v-if="bonus.valueHistory.length > 1" class="group">
              <summary class="cursor-pointer text-sm text-primary select-none">
                Ver histórico de valores ({{ bonus.valueHistory.length }})
              </summary>
              <div class="mt-3 overflow-x-auto rounded-xl border border-default">
                <table class="min-w-full text-sm">
                  <thead class="bg-elevated/40">
                    <tr>
                      <th class="px-3 py-2 text-left font-medium text-muted">
                        Vigente a partir de
                      </th>
                      <th class="px-3 py-2 text-left font-medium text-muted">
                        Base
                      </th>
                      <th class="px-3 py-2 text-left font-medium text-muted">
                        Meta
                      </th>
                      <th class="px-3 py-2 text-left font-medium text-muted">
                        Bônus
                      </th>
                      <th class="px-3 py-2 text-left font-medium text-muted">
                        Criado em
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-default/60">
                    <tr v-for="version in bonus.valueHistory" :key="version.id">
                      <td class="px-3 py-2">
                        {{ formatDate(version.effectiveFrom) }}
                      </td>
                      <td class="px-3 py-2">
                        {{ commissionBaseLabel[version.commissionBase] }}
                      </td>
                      <td class="px-3 py-2">
                        {{ formatCurrency(version.goalAmount) }}
                      </td>
                      <td class="px-3 py-2">
                        {{ formatCurrency(version.bonusAmount) }}
                      </td>
                      <td class="px-3 py-2 text-muted">
                        {{ formatDate(version.createdAt?.split('T')[0]) }}
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
              <p class="text-sm font-semibold text-highlighted">
                Funcionários atribuídos
              </p>
              <div class="flex flex-nowrap items-center justify-end gap-2">
                <div class="w-44 shrink-0">
                  <UiDatePicker v-model="referenceMonthInput" mode="month" class="w-full" />
                </div>
                <UButton
                  v-if="canUpdate"
                  label="Atribuir funcionário"
                  icon="i-lucide-user-plus"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  class="h-9 shrink-0"
                  @click="showAssignModal = true"
                />
                <UButton
                  v-if="canUpdate"
                  label="Gerar registros do mês"
                  icon="i-lucide-play"
                  color="neutral"
                  size="sm"
                  class="h-9 shrink-0"
                  :loading="isGeneratingBulk"
                  :disabled="progressItems.length === 0"
                  @click="onGenerateClick()"
                />
              </div>
            </div>

            <div v-if="!isCurrentMonth" class="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0" />
              Você está vendo/gerando <strong>{{ formatMonthLabel(referenceMonth) }}</strong> — um mês diferente do atual.
            </div>

            <div v-if="isProgressLoading" class="space-y-2">
              <USkeleton v-for="i in 3" :key="i" class="h-16 w-full rounded-xl" />
            </div>

            <div v-else-if="progressItems.length === 0" class="rounded-xl border border-dashed border-default p-6 text-center text-sm text-muted">
              Nenhum funcionário atribuído ainda.
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="item in progressItems"
                :key="item.employeeId"
                class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-default/70 bg-default/40 p-3"
              >
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-highlighted">
                    {{ item.employeeName }}
                  </p>
                  <p class="text-xs text-muted">
                    <template v-if="item.goalAmount != null">
                      {{ formatCurrency(item.achievedAmount) }} / {{ formatCurrency(item.goalAmount) }}
                    </template>
                    <template v-else>
                      Sem valor configurado para este mês
                    </template>
                  </p>
                  <UProgress
                    v-if="item.goalAmount != null"
                    :model-value="Math.min(item.achievedAmount, item.goalAmount)"
                    :max="item.goalAmount"
                    :color="progressBarColor(item)"
                    size="sm"
                    class="mt-1.5 max-w-64"
                  />
                </div>

                <UBadge
                  :label="progressStatusLabel(item).label"
                  :color="progressStatusLabel(item).color"
                  variant="subtle"
                  size="sm"
                />

                <div class="flex shrink-0 items-center gap-2">
                  <template v-if="item.generated">
                    <UBadge
                      label="Gerado"
                      color="neutral"
                      variant="subtle"
                      size="sm"
                      icon="i-lucide-check"
                    />
                  </template>
                  <UButton
                    v-else-if="canUpdate && item.goalMet"
                    label="Gerar"
                    color="neutral"
                    variant="outline"
                    size="xs"
                    :loading="generatingEmployeeId === item.employeeId"
                    @click="onGenerateClick(item.employeeId)"
                  />
                  <UTooltip v-if="canUpdate" text="Remover do bônus">
                    <UButton
                      icon="i-lucide-x"
                      color="error"
                      variant="ghost"
                      size="xs"
                      @click="requestUnassign(item)"
                    />
                  </UTooltip>
                </div>
              </div>
            </div>
          </div>

          <!-- Metas geradas no mês selecionado -->
          <div class="space-y-3 rounded-2xl border border-default p-4">
            <p class="text-sm font-semibold text-highlighted">
              Metas geradas em {{ formatMonthLabel(referenceMonth) }}
            </p>

            <div v-if="isProgressLoading" class="space-y-2">
              <USkeleton v-for="i in 2" :key="i" class="h-16 w-full rounded-xl" />
            </div>

            <div v-else-if="generatedProgressItems.length === 0" class="rounded-xl border border-dashed border-default p-6 text-center text-sm text-muted">
              Nenhuma meta gerada neste mês ainda.
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="item in generatedProgressItems"
                :key="item.employeeId"
                class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-default/70 bg-default/40 p-3"
              >
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-highlighted">
                    {{ item.employeeName }}
                  </p>
                  <p class="text-xs text-muted">
                    Meta: {{ formatCurrency(item.goalAmount) }} · Atingido: {{ formatCurrency(item.achievedAmount) }}
                  </p>
                </div>

                <p class="text-sm font-medium" :class="item.goalMet ? 'text-success' : 'text-muted'">
                  {{ item.goalMet ? formatCurrency(item.bonusAmount) : 'Bônus não liberado' }}
                </p>

                <UBadge
                  :label="progressStatusLabel(item).label"
                  :color="progressStatusLabel(item).color"
                  variant="subtle"
                  size="sm"
                />
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>

  <FinancialBonusesValueModal
    v-if="bonus"
    v-model:open="showValueModal"
    :bonus-id="bonusId"
    :current-value="bonus.currentValue"
    @saved="onValueSaved"
  />

  <FinancialBonusesAssignEmployeeModal
    v-model:open="showAssignModal"
    :bonus-id="bonusId"
    :exclude-employee-ids="assignedEmployeeIds"
    @assigned="onAssigned"
  />

  <AppConfirmModal
    v-model:open="showUnassignModal"
    title="Remover funcionário do bônus"
    confirm-label="Remover"
    confirm-color="error"
    :loading="isUnassigning"
    @confirm="confirmUnassign"
    @update:open="(value: boolean) => { showUnassignModal = value; if (!value && !isUnassigning) employeePendingUnassign = null }"
  >
    <template #description>
      <p class="text-sm text-muted">
        Remover <strong class="text-highlighted">{{ employeePendingUnassign?.employeeName || 'este funcionário' }}</strong> deste bônus?
        Gerações e pagamentos já feitos para ele continuam no histórico.
      </p>
    </template>
  </AppConfirmModal>

  <AppConfirmModal
    v-model:open="showRetroactiveConfirm"
    title="Gerar mês atrasado"
    confirm-label="Gerar mesmo assim"
    confirm-color="warning"
    @confirm="confirmRetroactiveGenerate"
  >
    <template #description>
      <p class="text-sm text-muted">
        Você está gerando <strong class="text-highlighted">{{ formatMonthLabel(referenceMonth) }}</strong>, que não é o mês atual.
        Confirma que quer gerar esse mês retroativamente?
      </p>
    </template>
  </AppConfirmModal>
</template>
