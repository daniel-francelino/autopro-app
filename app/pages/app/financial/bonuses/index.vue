<script setup lang="ts">
import { ActionCode } from '~/constants/action-codes'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Bônus' })

interface BonusListItem {
  id: string
  name: string
  description: string | null
  active: boolean
  assignedEmployeesCount: number
  assignedEmployees: Array<{
    id: string
    name: string
    photoUrl: string | null
  }>
  currentValue: {
    commissionBase: 'revenue' | 'profit' | 'revenue_minus_parts' | 'employee_net_profit'
    goalAmount: number
    bonusAmount: number
    effectiveFrom: string
  } | null
}

interface GenerateResponse {
  data: {
    referenceMonth: string
    generatedCount: number
    skippedCount: number
  }
}

const toast = useToast()
const router = useRouter()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const canRead = computed(() => workshop.can(ActionCode.BONUSES_READ))
const canUpdate = computed(() => workshop.can(ActionCode.BONUSES_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.BONUSES_DELETE))

const search = ref('')
const generatingBonusId = ref<string | null>(null)

const { data, status, refresh } = await useAsyncData(
  'bonuses-list',
  () => requestFetch<{ items: BonusListItem[] }>('/api/bonuses', { headers: requestHeaders }),
  { default: () => ({ items: [] }) }
)

const bonuses = computed(() => data.value?.items ?? [])

function formatCurrency(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function getInitials(name: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return (parts[0]?.charAt(0) ?? '?').toUpperCase()
  return `${parts[0]?.charAt(0) ?? ''}${parts[parts.length - 1]?.charAt(0) ?? ''}`.toUpperCase()
}

function visibleAssignedEmployees(bonus: BonusListItem) {
  return (bonus.assignedEmployees ?? []).slice(0, 5)
}

function hiddenAssignedEmployees(bonus: BonusListItem) {
  return (bonus.assignedEmployees ?? []).slice(5)
}

function generateActionLabel(bonus: BonusListItem) {
  if (!bonus.currentValue) return 'Configure um valor antes de gerar'
  if (bonus.assignedEmployeesCount === 0) return 'Atribua funcionários antes de gerar'
  return 'Gerar bônus do mês'
}

const commissionBaseLabel: Record<string, string> = {
  revenue: 'Faturamento',
  profit: 'Lucro',
  revenue_minus_parts: 'Faturamento - pecas',
  employee_net_profit: 'Lucro liquido funcionario'
}

function bonusRow(row: { original: unknown }): BonusListItem {
  return row.original as BonusListItem
}

async function generateBonus(bonus: BonusListItem) {
  if (generatingBonusId.value || !bonus.currentValue || bonus.assignedEmployeesCount === 0) return

  generatingBonusId.value = bonus.id
  try {
    const response = await $fetch<GenerateResponse>(`/api/bonuses/${bonus.id}/generate`, {
      method: 'POST'
    })
    const { generatedCount, skippedCount } = response.data
    toast.add({
      title: 'Geração concluída',
      description: `${generatedCount} gerado(s), ${skippedCount} pulado(s).`,
      color: generatedCount > 0 ? 'success' : 'neutral'
    })
  } catch (err: unknown) {
    const error = err as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({
      title: 'Erro ao gerar bônus',
      description: error?.data?.statusMessage || error?.statusMessage,
      color: 'error'
    })
  } finally {
    generatingBonusId.value = null
  }
}

const columns = [
  { accessorKey: 'name', header: 'Bônus', enableSorting: false },
  { id: 'value', header: 'Meta / Valor', enableSorting: false },
  { id: 'assigned', header: 'Funcionários', enableSorting: false },
  { id: 'status_col', header: 'Status', enableSorting: false },
  { id: 'actions', header: '', enableSorting: false }
]

// ─── Create ──────────────────────────────────────────────────────────────
const showFormModal = ref(false)
function openCreate() {
  showFormModal.value = true
}
async function onCreated(id: string) {
  showFormModal.value = false
  await refresh()
  router.push(`/app/financial/bonuses/${id}`)
}

// ─── Delete ──────────────────────────────────────────────────────────────
const isDeleting = ref(false)
const showDeleteModal = ref(false)
const bonusPendingDeletion = ref<BonusListItem | null>(null)

function requestRemove(bonus: BonusListItem) {
  if (isDeleting.value) return
  bonusPendingDeletion.value = bonus
  showDeleteModal.value = true
}

async function confirmRemove() {
  if (!bonusPendingDeletion.value || isDeleting.value) return
  isDeleting.value = true
  try {
    await $fetch(`/api/bonuses/${bonusPendingDeletion.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Bônus removido', color: 'success' })
    showDeleteModal.value = false
    bonusPendingDeletion.value = null
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, statusMessage?: string }
    toast.add({ title: 'Erro', description: err?.data?.statusMessage || err?.statusMessage || 'Não foi possível remover', color: 'error' })
  } finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Bônus" />
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar bônus.
        </p>
      </div>

      <div v-else class="space-y-4 p-4">
        <AppDataTable
          v-model:search-term="search"
          :columns="columns"
          :data="bonuses as unknown as Record<string, unknown>[]"
          :loading="status === 'pending'"
          :show-footer="false"
          show-search
          search-placeholder="Buscar bônus..."
          empty-icon="i-lucide-gift"
          empty-title="Nenhum bônus cadastrado"
          empty-description="Crie um bônus por meta e atribua a um ou mais funcionários."
        >
          <template #toolbar-right>
            <UButton
              v-if="canUpdate"
              label="Novo bônus"
              icon="i-lucide-plus"
              size="sm"
              @click="openCreate"
            />
          </template>

          <template #name-cell="{ row }">
            <NuxtLink
              :to="`/app/financial/bonuses/${bonusRow(row).id}`"
              class="font-medium text-highlighted hover:underline"
            >
              {{ bonusRow(row).name }}
            </NuxtLink>
            <p v-if="bonusRow(row).description" class="truncate text-xs text-muted">
              {{ bonusRow(row).description }}
            </p>
          </template>

          <template #value-cell="{ row }">
            <template v-if="bonusRow(row).currentValue">
              <p class="text-sm text-highlighted">
                Meta: {{ formatCurrency(bonusRow(row).currentValue!.goalAmount) }}
                <span class="text-muted">({{ commissionBaseLabel[bonusRow(row).currentValue!.commissionBase] }})</span>
              </p>
              <p class="text-xs text-muted">
                Bônus: {{ formatCurrency(bonusRow(row).currentValue!.bonusAmount) }}
              </p>
            </template>
            <span v-else class="text-sm text-muted">Sem valor configurado</span>
          </template>

          <template #assigned-cell="{ row }">
            <div
              v-if="bonusRow(row).assignedEmployeesCount > 0"
              class="flex items-center"
            >
              <UTooltip
                v-for="employee in visibleAssignedEmployees(bonusRow(row))"
                :key="employee.id"
                :text="employee.name"
              >
                <UAvatar
                  :src="employee.photoUrl || undefined"
                  :text="getInitials(employee.name)"
                  :alt="employee.name"
                  size="xs"
                  class="-ml-1.5 first:ml-0 ring-2 ring-default bg-primary/10 text-primary"
                />
              </UTooltip>

              <UTooltip
                v-if="hiddenAssignedEmployees(bonusRow(row)).length"
                :text="hiddenAssignedEmployees(bonusRow(row)).map(employee => employee.name).join(', ')"
                :ui="{ content: 'h-auto max-w-64 py-1.5', text: 'whitespace-normal' }"
              >
                <div class="-ml-1.5 flex size-6 items-center justify-center rounded-full bg-elevated text-[10px] font-semibold text-muted ring-2 ring-default">
                  +{{ hiddenAssignedEmployees(bonusRow(row)).length }}
                </div>
              </UTooltip>
            </div>
            <UBadge
              v-else
              :label="`${bonusRow(row).assignedEmployeesCount} funcionário${bonusRow(row).assignedEmployeesCount !== 1 ? 's' : ''}`"
              color="neutral"
              variant="subtle"
              size="sm"
            />
          </template>

          <template #status_col-cell="{ row }">
            <UBadge
              :label="bonusRow(row).active ? 'Ativo' : 'Inativo'"
              :color="bonusRow(row).active ? 'success' : 'neutral'"
              variant="subtle"
              size="sm"
            />
          </template>

          <template #actions-cell="{ row }">
            <div class="flex items-center justify-end gap-2">
              <UTooltip v-if="canUpdate" :text="generateActionLabel(bonusRow(row))">
                <UButton
                  icon="i-lucide-play"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :loading="generatingBonusId === bonusRow(row).id"
                  :disabled="!bonusRow(row).currentValue || bonusRow(row).assignedEmployeesCount === 0"
                  @click="generateBonus(bonusRow(row))"
                />
              </UTooltip>
              <UTooltip text="Ver detalhes">
                <UButton
                  icon="i-lucide-eye"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :to="`/app/financial/bonuses/${bonusRow(row).id}`"
                />
              </UTooltip>
              <UButton
                v-if="canDelete"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                @click="requestRemove(bonusRow(row))"
              />
            </div>
          </template>
        </AppDataTable>
      </div>
    </template>
  </UDashboardPanel>

  <FinancialBonusesFormModal
    v-model:open="showFormModal"
    @created="onCreated"
  />

  <AppConfirmModal
    v-model:open="showDeleteModal"
    title="Excluir bônus"
    confirm-label="Excluir bônus"
    confirm-color="error"
    :loading="isDeleting"
    @confirm="confirmRemove"
    @update:open="(value: boolean) => { showDeleteModal = value; if (!value && !isDeleting) bonusPendingDeletion = null }"
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir o bônus
        <strong class="text-highlighted">{{ bonusPendingDeletion?.name || 'este bônus' }}</strong>?
        O histórico de valores e de gerações já feitas é preservado, mas o bônus deixa de aparecer nesta lista.
      </p>
    </template>
  </AppConfirmModal>
</template>
