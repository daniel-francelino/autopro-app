<script setup lang="ts">
import { ActionCode } from '~/constants/action-codes'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Comissões' })

interface CommissionPlanListItem {
  id: string
  name: string
  description: string | null
  active: boolean
  updatedAt: string | null
  assignedEmployeeCount: number
  currentVersion: {
    id: string
    effectiveFrom: string
    ruleCount: number
    categoryCount: number
    hasDefault: boolean
  } | null
}

const toast = useToast()
const router = useRouter()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const canRead = computed(() => workshop.can(ActionCode.COMMISSIONS_READ))
const canUpdate = computed(() => workshop.can(ActionCode.COMMISSIONS_UPDATE))
const canDelete = computed(() => workshop.can(ActionCode.COMMISSIONS_DELETE))

const search = ref('')

const { data, status, refresh } = await useAsyncData(
  'commissions-list',
  () => requestFetch<{ items: CommissionPlanListItem[] }>('/api/commissions', { headers: requestHeaders }),
  { default: () => ({ items: [] }) }
)

const plans = computed(() => data.value?.items ?? [])

function planRow(row: { original: unknown }): CommissionPlanListItem {
  return row.original as CommissionPlanListItem
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('pt-BR')
}

const columns = [
  { accessorKey: 'name', header: 'Comissão', enableSorting: false },
  { id: 'rules', header: 'Regras vigentes', enableSorting: false },
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
  router.push(`/app/financial/commissions/${id}`)
}

// ─── Delete ──────────────────────────────────────────────────────────────
const isDeleting = ref(false)
const showDeleteModal = ref(false)
const planPendingDeletion = ref<CommissionPlanListItem | null>(null)

function requestRemove(plan: CommissionPlanListItem) {
  if (isDeleting.value) return
  planPendingDeletion.value = plan
  showDeleteModal.value = true
}

async function confirmRemove() {
  if (!planPendingDeletion.value || isDeleting.value) return
  isDeleting.value = true
  try {
    await $fetch(`/api/commissions/${planPendingDeletion.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Configuração de comissão removida', color: 'success' })
    showDeleteModal.value = false
    planPendingDeletion.value = null
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
      <AppPageHeader title="Comissões" />
    </template>

    <template #body>
      <div v-if="!canRead" class="p-6">
        <p class="text-sm text-muted">
          Você não tem permissão para visualizar comissões.
        </p>
      </div>

      <div v-else class="space-y-4 p-4">
        <AppDataTable
          v-model:search-term="search"
          :columns="columns"
          :data="plans as unknown as Record<string, unknown>[]"
          :loading="status === 'pending'"
          :show-footer="false"
          show-search
          search-placeholder="Buscar comissão..."
          empty-icon="i-lucide-badge-percent"
          empty-title="Nenhuma comissão cadastrada"
          empty-description="Crie uma configuração de comissão com uma ou mais regras e atribua a funcionários."
        >
          <template #toolbar-right>
            <UButton
              v-if="canUpdate"
              label="Nova comissão"
              icon="i-lucide-plus"
              size="sm"
              @click="openCreate"
            />
          </template>

          <template #name-cell="{ row }">
            <NuxtLink
              :to="`/app/financial/commissions/${planRow(row).id}`"
              class="font-medium text-highlighted hover:underline"
            >
              {{ planRow(row).name }}
            </NuxtLink>
          </template>

          <template #rules-cell="{ row }">
            <template v-if="planRow(row).currentVersion">
              <p class="text-sm text-highlighted">
                {{ planRow(row).currentVersion!.ruleCount }} regra{{ planRow(row).currentVersion!.ruleCount !== 1 ? 's' : '' }}
                <span class="text-muted">({{ planRow(row).currentVersion!.categoryCount }} categoria{{ planRow(row).currentVersion!.categoryCount !== 1 ? 's' : '' }})</span>
              </p>
              <p class="text-xs text-muted">
                Vigente desde {{ formatDate(planRow(row).currentVersion!.effectiveFrom) }}
                <UBadge
                  v-if="!planRow(row).currentVersion!.hasDefault"
                  label="Sem regra padrão"
                  color="warning"
                  variant="subtle"
                  size="sm"
                  class="ml-1"
                />
              </p>
            </template>
            <span v-else class="text-sm text-muted">Sem versão vigente</span>
          </template>

          <template #assigned-cell="{ row }">
            <UBadge
              :label="`${planRow(row).assignedEmployeeCount} funcionário${planRow(row).assignedEmployeeCount !== 1 ? 's' : ''}`"
              :color="planRow(row).assignedEmployeeCount > 0 ? 'info' : 'neutral'"
              variant="subtle"
              size="sm"
            />
          </template>

          <template #status_col-cell="{ row }">
            <UBadge
              :label="planRow(row).active ? 'Ativo' : 'Inativo'"
              :color="planRow(row).active ? 'success' : 'neutral'"
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
                  :to="`/app/financial/commissions/${planRow(row).id}`"
                />
              </UTooltip>
              <UButton
                v-if="canDelete"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                @click="requestRemove(planRow(row))"
              />
            </div>
          </template>
        </AppDataTable>
      </div>
    </template>
  </UDashboardPanel>

  <FinancialCommissionsFormModal
    v-model:open="showFormModal"
    @created="onCreated"
  />

  <AppConfirmModal
    v-model:open="showDeleteModal"
    title="Excluir comissão"
    confirm-label="Excluir comissão"
    confirm-color="error"
    :loading="isDeleting"
    @confirm="confirmRemove"
    @update:open="(value: boolean) => { showDeleteModal = value; if (!value && !isDeleting) planPendingDeletion = null }"
  >
    <template #description>
      <p class="text-sm text-muted">
        Tem certeza que deseja excluir a comissão
        <strong class="text-highlighted">{{ planPendingDeletion?.name || 'esta configuração' }}</strong>?
        O histórico de versões e as comissões já geradas a partir dela são preservados, mas ela deixa de aparecer nesta lista.
      </p>
    </template>
  </AppConfirmModal>
</template>
