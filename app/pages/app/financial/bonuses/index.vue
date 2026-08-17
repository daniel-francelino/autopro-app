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
  currentValue: {
    commissionBase: 'revenue' | 'profit'
    goalAmount: number
    bonusAmount: number
    effectiveFrom: string
  } | null
}

const toast = useToast()
const router = useRouter()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const canRead = computed(() => workshop.can(ActionCode.FINANCIAL_READ))
const canUpdate = computed(() => workshop.can(ActionCode.FINANCIAL_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.FINANCIAL_DELETE))

const search = ref('')

const { data, status, refresh } = await useAsyncData(
  'bonuses-list',
  () => requestFetch<{ items: BonusListItem[] }>('/api/bonuses', { headers: requestHeaders }),
  { default: () => ({ items: [] }) }
)

const bonuses = computed(() => data.value?.items ?? [])

function formatCurrency(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const commissionBaseLabel: Record<string, string> = { revenue: 'Faturamento', profit: 'Lucro' }

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
              :to="`/app/financial/bonuses/${(row.original as BonusListItem).id}`"
              class="font-medium text-highlighted hover:underline"
            >
              {{ (row.original as BonusListItem).name }}
            </NuxtLink>
            <p v-if="(row.original as BonusListItem).description" class="truncate text-xs text-muted">
              {{ (row.original as BonusListItem).description }}
            </p>
          </template>

          <template #value-cell="{ row }">
            <template v-if="(row.original as BonusListItem).currentValue">
              <p class="text-sm text-highlighted">
                Meta: {{ formatCurrency((row.original as BonusListItem).currentValue!.goalAmount) }}
                <span class="text-muted">({{ commissionBaseLabel[(row.original as BonusListItem).currentValue!.commissionBase] }})</span>
              </p>
              <p class="text-xs text-muted">
                Bônus: {{ formatCurrency((row.original as BonusListItem).currentValue!.bonusAmount) }}
              </p>
            </template>
            <span v-else class="text-sm text-muted">Sem valor configurado</span>
          </template>

          <template #assigned-cell="{ row }">
            <UBadge
              :label="`${(row.original as BonusListItem).assignedEmployeesCount} funcionário${(row.original as BonusListItem).assignedEmployeesCount !== 1 ? 's' : ''}`"
              color="neutral"
              variant="subtle"
              size="sm"
            />
          </template>

          <template #status_col-cell="{ row }">
            <UBadge
              :label="(row.original as BonusListItem).active ? 'Ativo' : 'Inativo'"
              :color="(row.original as BonusListItem).active ? 'success' : 'neutral'"
              variant="subtle"
              size="sm"
            />
          </template>

          <template #actions-cell="{ row }">
            <div class="flex items-center justify-end gap-2">
              <UTooltip text="Ver detalhes">
                <UButton
                  icon="i-lucide-eye"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :to="`/app/financial/bonuses/${(row.original as BonusListItem).id}`"
                />
              </UTooltip>
              <UButton
                v-if="canDelete"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                @click="requestRemove(row.original as BonusListItem)"
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
