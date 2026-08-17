<script setup lang="ts">
import type { CommissionDetailData } from '~/components/reports/commissions/CommissionsDetailSlideover.vue'
import { ActionCode } from '~/constants/action-codes'

interface EmployeeCommissionProfile {
  id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  taxId: string | null
  personType: string | null
  photoUrl: string | null
  city: string | null
  state: string | null
  neighborhood: string | null
  street: string | null
  addressNumber: string | null
  addressComplement: string | null
  zipCode: string | null
  hasCommission: boolean
  commissionType: string | null
  commissionAmount: number | null
  commissionBase: string | null
  commissionCategoryIds: string[]
  commissionCategoryNames: string[]
  terminationDate: string | null
  terminationReason: string | null
}

interface EmployeeCommissionSummary {
  totalCommissions: number
  totalPaid: number
  totalPending: number
  itemsCount: number
  paidItemsCount: number
  pendingItemsCount: number
  orderCount: number
  averageCommission: number
}

interface EmployeeCommissionItem {
  id: string
  description: string | null
  amount: number
  status: 'paid' | 'pending' | 'cancelled'
  referenceDate: string | null
  paymentDate: string | null
  itemName: string | null
  itemAmount: number
  itemCost: number
  itemProfit: number
  commissionType: string | null
  commissionPercentage: number | null
  commissionBase: string | null
  baseAmount: number
  orderId: string | null
  orderNumber: string | null
  orderStatus: string | null
  orderPaymentStatus: 'paid' | 'pending' | 'cancelled' | null
  orderEntryDate: string | null
  orderClientName: string | null
}

interface EmployeeCommissionResponse {
  data?: {
    employee: EmployeeCommissionProfile
    summary: EmployeeCommissionSummary
    items: EmployeeCommissionItem[]
    period: {
      dateFrom: string | null
      dateTo: string | null
    }
  }
}

interface CommissionDetailResponse {
  data?: {
    detail?: CommissionDetailData
  }
}

function defaultFrom(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function defaultTo(): string {
  const now = new Date()
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Detalhes do funcionário' })

const route = useRoute()
const toast = useToast()
const workshop = useWorkshopPermissions()
const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const canRead = computed(() => workshop.can(ActionCode.EMPLOYEES_READ))
const employeeId = computed(() => String(route.params.id || ''))
const dateFrom = useReportQueryParam('from', defaultFrom())
const dateTo = useReportQueryParam('to', defaultTo())
const activeTab = useReportQueryParam('tab', 'commissions')
const searchTerm = ref('')

const tabItems = [
  { label: 'Comissões', value: 'commissions', icon: 'i-lucide-hand-coins' },
  { label: 'Itens', value: 'items', icon: 'i-lucide-package-search' }
]

const queryKey = computed(() => `employee-commission-detail-${employeeId.value}-${dateFrom.value}-${dateTo.value}`)

const { data, status, error, refresh } = await useAsyncData(
  () => queryKey.value,
  () => requestFetch<EmployeeCommissionResponse>(`/api/employees/${employeeId.value}/commissions`, {
    headers: requestHeaders,
    query: {
      dateFrom: dateFrom.value,
      dateTo: dateTo.value
    }
  }),
  {
    watch: [queryKey],
    server: true
  }
)

const employee = computed(() => data.value?.data?.employee ?? null)
const summary = computed<EmployeeCommissionSummary>(() => data.value?.data?.summary ?? {
  totalCommissions: 0,
  totalPaid: 0,
  totalPending: 0,
  itemsCount: 0,
  paidItemsCount: 0,
  pendingItemsCount: 0,
  orderCount: 0,
  averageCommission: 0
})
const items = computed<EmployeeCommissionItem[]>(() => data.value?.data?.items ?? [])

const normalizedSearch = computed(() => searchTerm.value.trim().toLowerCase())
const filteredItems = computed(() => {
  if (!normalizedSearch.value)
    return items.value

  return items.value.filter(item => [
    item.itemName,
    item.description,
    item.orderNumber,
    item.orderClientName,
    item.referenceDate
  ].some(value => String(value || '').toLowerCase().includes(normalizedSearch.value)))
})

const employeeStatus = computed<{ label: string, color: 'success' | 'warning' | 'neutral' }>(() => {
  if (!employee.value?.terminationDate)
    return { label: 'Ativo', color: 'success' }

  const today = new Date().toISOString().split('T')[0]!
  if (employee.value.terminationDate <= today)
    return { label: 'Demitido', color: 'neutral' }

  return { label: 'Demissão agendada', color: 'warning' }
})

const periodLabel = computed(() => `${formatDate(dateFrom.value)} a ${formatDate(dateTo.value)}`)

const exportItems = computed(() => [[
  {
    label: 'Exportar CSV',
    icon: 'i-lucide-file-spreadsheet',
    disabled: exporting.value !== null,
    onSelect: () => exportReport('csv')
  },
  {
    label: 'Exportar PDF',
    icon: 'i-lucide-file-text',
    disabled: exporting.value !== null,
    onSelect: () => exportReport('pdf')
  }
]])

const commissionColumns = [
  { id: 'c_referenceDate', accessorKey: 'referenceDate', header: 'Referência', enableSorting: false },
  { id: 'c_orderNumber', accessorKey: 'orderNumber', header: 'OS', enableSorting: false },
  { id: 'c_itemName', accessorKey: 'itemName', header: 'Item', enableSorting: false },
  { id: 'c_orderClientName', accessorKey: 'orderClientName', header: 'Cliente', enableSorting: false },
  { id: 'c_amount', accessorKey: 'amount', header: 'Comissão', enableSorting: false },
  { id: 'c_status', header: 'Status', enableSorting: false },
  { id: 'c_paymentDate', accessorKey: 'paymentDate', header: 'Pago em', enableSorting: false },
  { id: 'c_actions', header: '', enableSorting: false }
]

const itemColumns = [
  { id: 'i_itemName', accessorKey: 'itemName', header: 'Item', enableSorting: false },
  { id: 'i_orderNumber', accessorKey: 'orderNumber', header: 'OS', enableSorting: false },
  { id: 'i_baseAmount', accessorKey: 'baseAmount', header: 'Base', enableSorting: false },
  { id: 'i_commissionRule', accessorKey: 'commissionRule', header: 'Regra', enableSorting: false },
  { id: 'i_itemAmount', accessorKey: 'itemAmount', header: 'Receita', enableSorting: false },
  { id: 'i_itemProfit', accessorKey: 'itemProfit', header: 'Lucro', enableSorting: false },
  { id: 'i_amount', accessorKey: 'amount', header: 'Comissão', enableSorting: false },
  { id: 'i_actions', header: '', enableSorting: false }
]

const itemTableRows = computed(() => filteredItems.value.map(item => ({
  ...item,
  commissionRule: getCommissionRuleLabel(item)
})))

function commissionRow(row: { original: unknown }): EmployeeCommissionItem {
  return row.original as EmployeeCommissionItem
}
function itemRow(row: { original: unknown }): EmployeeCommissionItem & { commissionRule: string } {
  return row.original as EmployeeCommissionItem & { commissionRule: string }
}

const activeColumns = computed(() => activeTab.value === 'items' ? itemColumns : commissionColumns)
const activeTableData = computed<Record<string, unknown>[]>(() =>
  activeTab.value === 'items'
    ? (itemTableRows.value as unknown as Record<string, unknown>[])
    : (filteredItems.value as unknown as Record<string, unknown>[])
)
const activeActionsColumnKey = computed(() => activeTab.value === 'items' ? 'i_actions' : 'c_actions')

const emptyStateByTab: Record<'commissions' | 'items', { icon: string, title: string, description: string }> = {
  commissions: { icon: 'i-lucide-hand-coins', title: 'Nenhuma comissão encontrada', description: 'Não há comissões registradas para esse funcionário no período selecionado.' },
  items: { icon: 'i-lucide-package-search', title: 'Nenhum item encontrado', description: 'Não há itens vendidos por esse funcionário no período selecionado.' }
}
const activeEmptyState = computed(() => emptyStateByTab[activeTab.value === 'items' ? 'items' : 'commissions'])

const detailOpen = ref(false)
const detailLoading = ref(false)
const detailData = ref<CommissionDetailData | null>(null)
const exporting = ref<'csv' | 'pdf' | null>(null)

function getInitials(name: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return (parts[0]?.charAt(0) ?? '?').toUpperCase()
  return ((parts[0]?.charAt(0) ?? '') + (parts[parts.length - 1]?.charAt(0) ?? '')).toUpperCase()
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const [year, month, day] = String(value).split('-')
  if (!year || !month || !day) return String(value)
  return `${day}/${month}/${year}`
}

function formatCurrency(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatPhone(value: string | null | undefined) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 11)
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  if (digits.length === 10)
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  return value || '—'
}

function formatTaxId(value: string | null | undefined, personType: string | null | undefined) {
  const digits = String(value || '').replace(/\D/g, '')
  if (personType === 'pj') {
    if (digits.length !== 14) return value || '—'
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  }
  if (digits.length !== 11) return value || '—'
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

function formatCommissionType(value: string | null | undefined) {
  if (value === 'percentage') return 'Percentual'
  if (value === 'fixed_amount') return 'Valor fixo'
  return 'Sem comissão'
}

function formatCommissionBase(value: string | null | undefined) {
  if (value === 'profit') return 'Lucro'
  if (value === 'revenue') return 'Receita'
  return '—'
}

function getCommissionRuleLabel(item: EmployeeCommissionItem) {
  if (item.commissionType === 'percentage') {
    return `${item.commissionPercentage ?? 0}% sobre ${item.commissionBase === 'profit' ? 'lucro' : 'receita'}`
  }

  if (item.commissionType === 'fixed_amount') {
    return `${formatCurrency(item.commissionPercentage ?? employee.value?.commissionAmount ?? 0)} por item`
  }

  return 'Sem regra definida'
}

function commissionStatusLabel(statusValue: EmployeeCommissionItem['status']) {
  if (statusValue === 'paid') return 'Pago'
  if (statusValue === 'cancelled') return 'Cancelado'
  return 'Pendente'
}

function commissionStatusColor(statusValue: EmployeeCommissionItem['status']): 'success' | 'warning' | 'neutral' | 'error' {
  if (statusValue === 'paid') return 'success'
  if (statusValue === 'cancelled') return 'error'
  return 'warning'
}

function buildAddress(profile: EmployeeCommissionProfile | null) {
  if (!profile) return 'Endereço não informado'

  const line = [
    profile.street,
    profile.addressNumber,
    profile.neighborhood,
    profile.city,
    profile.state
  ].filter(Boolean).join(', ')

  return line || 'Endereço não informado'
}

async function openCommissionDetail(item: EmployeeCommissionItem) {
  detailOpen.value = true
  detailLoading.value = true
  detailData.value = null

  try {
    const response = await $fetch<CommissionDetailResponse>(`/api/reports/commissions/${item.id}`)
    if (!response.data?.detail)
      throw new Error('Commission detail not found')

    detailData.value = response.data.detail
  } catch {
    toast.add({ title: 'Erro ao carregar detalhes da comissão', color: 'error' })
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

async function exportReport(format: 'csv' | 'pdf') {
  exporting.value = format
  try {
    const response = await $fetch<{ success: boolean, data: { fileName: string, contentType: string, base64: string } }>(
      `/api/employees/${employeeId.value}/export-commissions`,
      {
        method: 'POST',
        body: {
          format,
          dateFrom: dateFrom.value,
          dateTo: dateTo.value
        }
      }
    )

    if (response.data?.base64) {
      const binary = atob(response.data.base64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
      const blob = new Blob([bytes], { type: response.data.contentType })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = response.data.fileName
      anchor.click()
      URL.revokeObjectURL(url)
    }
  } catch {
    toast.add({ title: 'Erro ao exportar comissões do funcionário', color: 'error' })
  } finally {
    exporting.value = null
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #body>
      <div v-if="!canRead" class="p-4">
        <div class="rounded-xl border border-default/60 bg-elevated/30 p-6">
          <p class="text-sm text-muted">
            Você não tem permissão para visualizar funcionários.
          </p>
        </div>
      </div>

      <div v-else class="space-y-4 p-4">
        <template v-if="status === 'pending' && !employee">
          <USkeleton class="h-40 w-full rounded-2xl" />
          <div class="grid gap-4 lg:grid-cols-4">
            <USkeleton v-for="i in 4" :key="i" class="h-28 w-full rounded-2xl" />
          </div>
          <USkeleton class="h-20 w-full rounded-2xl" />
          <USkeleton class="h-96 w-full rounded-2xl" />
        </template>

        <template v-else-if="error || !employee">
          <div class="rounded-2xl border border-error/30 bg-error/10 p-6">
            <p class="text-sm font-medium text-error">
              Não foi possível carregar os detalhes do funcionário.
            </p>
            <p class="mt-1 text-sm text-muted">
              Verifique se o cadastro ainda existe e tente novamente.
            </p>
            <div class="mt-4 flex gap-2">
              <UButton label="Tentar novamente" color="neutral" @click="refresh" />
              <UButton
                label="Voltar para funcionários"
                color="neutral"
                variant="ghost"
                to="/app/settings/employees"
              />
            </div>
          </div>
        </template>

        <template v-else>
          <div class="overflow-hidden rounded-3xl border border-default bg-linear-to-br from-primary/10 via-elevated to-warning/10">
            <div class="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
              <div class="flex gap-4">
                <img
                  v-if="employee.photoUrl"
                  :src="employee.photoUrl"
                  :alt="employee.name"
                  class="size-20 shrink-0 rounded-2xl object-cover shadow-sm"
                >
                <div
                  v-else
                  class="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-primary/15 shadow-sm"
                >
                  <span class="text-2xl font-semibold text-primary">
                    {{ getInitials(employee.name) }}
                  </span>
                </div>

                <div class="min-w-0 space-y-3">
                  <div class="space-y-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <h1 class="text-2xl font-semibold text-highlighted sm:text-3xl">
                        {{ employee.name }}
                      </h1>
                      <UBadge :color="employeeStatus.color" variant="subtle" size="sm">
                        {{ employeeStatus.label }}
                      </UBadge>
                      <UBadge :color="employee.hasCommission ? 'success' : 'neutral'" variant="subtle" size="sm">
                        {{ employee.hasCommission ? 'Comissionado' : 'Sem comissão' }}
                      </UBadge>
                    </div>

                    <p class="max-w-2xl text-sm text-muted">
                      Acompanhe as comissões, itens vinculados ao funcionário e exporte o extrato do período selecionado.
                    </p>
                  </div>

                  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div class="rounded-2xl border border-default/70 bg-default/40 p-3">
                      <p class="text-xs uppercase tracking-widest text-muted">
                        Cargo
                      </p>
                      <p class="mt-1 text-sm font-medium text-highlighted">
                        {{ employee.role || 'Não informado' }}
                      </p>
                    </div>
                    <div class="rounded-2xl border border-default/70 bg-default/40 p-3">
                      <p class="text-xs uppercase tracking-widest text-muted">
                        Telefone
                      </p>
                      <p class="mt-1 text-sm font-medium text-highlighted">
                        {{ formatPhone(employee.phone) }}
                      </p>
                    </div>
                    <div class="rounded-2xl border border-default/70 bg-default/40 p-3">
                      <p class="text-xs uppercase tracking-widest text-muted">
                        Documento
                      </p>
                      <p class="mt-1 text-sm font-medium text-highlighted">
                        {{ formatTaxId(employee.taxId, employee.personType) }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <div class="rounded-2xl border border-default/70 bg-default/50 p-4 sm:col-span-2">
                  <div class="flex items-start gap-3">
                    <UIcon name="i-lucide-badge-percent" class="mt-0.5 size-5 shrink-0 text-warning" />
                    <div class="space-y-1">
                      <p class="text-xs uppercase tracking-widest text-muted">
                        Regra de comissão
                      </p>
                      <p class="text-sm font-medium text-highlighted">
                        {{ formatCommissionType(employee.commissionType) }}
                        <span v-if="employee.commissionType !== null"> · {{ formatCommissionBase(employee.commissionBase) }}</span>
                      </p>
                      <p class="text-sm text-muted">
                        <template v-if="employee.commissionType === 'percentage'">
                          {{ employee.commissionAmount ?? 0 }}% configurado para o cadastro.
                        </template>
                        <template v-else-if="employee.commissionType === 'fixed_amount'">
                          {{ formatCurrency(employee.commissionAmount ?? 0) }} por item configurado para o cadastro.
                        </template>
                        <template v-else>
                          O funcionário não possui regra de comissão ativa no cadastro.
                        </template>
                      </p>
                    </div>
                  </div>
                </div>

                <div class="rounded-2xl border border-default/70 bg-default/50 p-4 sm:col-span-2">
                  <div class="flex items-start gap-3">
                    <UIcon name="i-lucide-map-pinned" class="mt-0.5 size-5 shrink-0 text-primary" />
                    <div class="space-y-1">
                      <p class="text-xs uppercase tracking-widest text-muted">
                        Endereço e contato
                      </p>
                      <p class="text-sm font-medium text-highlighted">
                        {{ employee.email || '-' }}
                      </p>
                      <p class="text-sm text-muted">
                        {{ buildAddress(employee) }}
                      </p>
                    </div>
                  </div>
                </div>

                <div class="rounded-2xl border border-default/70 bg-default/50 p-4 sm:col-span-2">
                  <p class="text-xs uppercase tracking-widest text-muted">
                    Categorias elegíveis
                  </p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <UBadge
                      v-for="categoryName in employee.commissionCategoryNames"
                      :key="categoryName"
                      color="warning"
                      variant="subtle"
                      size="sm"
                    >
                      {{ categoryName }}
                    </UBadge>
                    <span v-if="employee.commissionCategoryNames.length === 0" class="text-sm text-muted">
                      Todas as categorias contam para a comissão.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div class="rounded-2xl border border-default bg-elevated/50 p-4">
              <div class="flex items-start gap-3">
                <div class="rounded-xl bg-primary/10 p-2 shrink-0">
                  <UIcon name="i-lucide-hand-coins" class="size-5 text-primary" />
                </div>
                <div class="min-w-0">
                  <p class="text-sm text-muted">
                    Total de comissões
                  </p>
                  <p class="mt-2 text-2xl font-semibold text-highlighted">
                    {{ formatCurrency(summary.totalCommissions) }}
                  </p>
                  <p class="mt-1 text-xs text-muted">
                    Período {{ periodLabel }}
                  </p>
                </div>
              </div>
            </div>
            <div class="rounded-2xl border border-success/20 bg-success/5 p-4">
              <div class="flex items-start gap-3">
                <div class="rounded-xl bg-success/10 p-2 shrink-0">
                  <UIcon name="i-lucide-circle-check-big" class="size-5 text-success" />
                </div>
                <div class="min-w-0">
                  <p class="text-sm text-muted">
                    Pagas
                  </p>
                  <p class="mt-2 text-2xl font-semibold text-success">
                    {{ formatCurrency(summary.totalPaid) }}
                  </p>
                  <p class="mt-1 text-xs text-muted">
                    {{ summary.paidItemsCount }} item(ns) quitados
                  </p>
                </div>
              </div>
            </div>
            <div class="rounded-2xl border border-warning/20 bg-warning/5 p-4">
              <div class="flex items-start gap-3">
                <div class="rounded-xl bg-warning/10 p-2 shrink-0">
                  <UIcon name="i-lucide-clock" class="size-5 text-warning" />
                </div>
                <div class="min-w-0">
                  <p class="text-sm text-muted">
                    Pendentes
                  </p>
                  <p class="mt-2 text-2xl font-semibold text-warning">
                    {{ formatCurrency(summary.totalPending) }}
                  </p>
                  <p class="mt-1 text-xs text-muted">
                    {{ summary.pendingItemsCount }} item(ns) aguardando pagamento
                  </p>
                </div>
              </div>
            </div>
            <div class="rounded-2xl border border-default bg-elevated/30 p-4">
              <div class="flex items-start gap-3">
                <div class="rounded-xl bg-info/10 p-2 shrink-0">
                  <UIcon name="i-lucide-clipboard-list" class="size-5 text-info" />
                </div>
                <div class="min-w-0">
                  <p class="text-sm text-muted">
                    Cobertura
                  </p>
                  <p class="mt-2 text-2xl font-semibold text-highlighted">
                    {{ summary.orderCount }}
                  </p>
                  <p class="mt-1 text-xs text-muted">
                    OS com {{ summary.itemsCount }} item(ns) comissionados
                  </p>
                </div>
              </div>
            </div>
          </div>

          <AppDataTableInfinite
            :key="activeTab"
            v-model:search-term="searchTerm"
            :columns="activeColumns"
            :data="activeTableData"
            :loading="status === 'pending'"
            :has-more="false"
            :total="activeTableData.length"
            :actions-column-key="activeActionsColumnKey"
            show-search
            search-placeholder="Buscar por item, cliente ou OS..."
            :empty-icon="activeEmptyState.icon"
            :empty-title="activeEmptyState.title"
            :empty-description="activeEmptyState.description"
          >
            <template #filters>
              <UTabs
                v-model="activeTab"
                :items="tabItems"
                variant="link"
                class="w-auto"
              />
            </template>

            <template #toolbar-right>
              <UTooltip :text="`Exportar comissões de ${employee.name}`">
                <UDropdownMenu
                  :items="exportItems"
                  :content="{ align: 'end' }"
                  :ui="{ content: 'min-w-44' }"
                >
                  <UButton
                    icon="i-lucide-download"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    square
                    :loading="exporting !== null"
                  />
                </UDropdownMenu>
              </UTooltip>
            </template>

            <!-- Comissões -->
            <template #c_referenceDate-cell="{ row }">
              {{ formatDate(commissionRow(row).referenceDate) }}
            </template>
            <template #c_orderNumber-cell="{ row }">
              <span v-if="commissionRow(row).orderNumber" class="font-mono text-sm text-muted">#{{ commissionRow(row).orderNumber }}</span>
              <span v-else class="text-muted">—</span>
            </template>
            <template #c_itemName-cell="{ row }">
              {{ commissionRow(row).itemName || '—' }}
            </template>
            <template #c_orderClientName-cell="{ row }">
              {{ commissionRow(row).orderClientName || '—' }}
            </template>
            <template #c_amount-cell="{ row }">
              <span class="font-bold text-success">{{ formatCurrency(commissionRow(row).amount) }}</span>
            </template>
            <template #c_status-cell="{ row }">
              <UBadge
                :color="commissionStatusColor(commissionRow(row).status)"
                variant="subtle"
                :label="commissionStatusLabel(commissionRow(row).status)"
                size="sm"
              />
            </template>
            <template #c_paymentDate-cell="{ row }">
              {{ formatDate(commissionRow(row).paymentDate) }}
            </template>
            <template #c_actions-cell="{ row }">
              <div class="flex items-center justify-end">
                <UTooltip text="Ver detalhes">
                  <UButton
                    icon="i-lucide-eye"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="openCommissionDetail(commissionRow(row))"
                  />
                </UTooltip>
              </div>
            </template>

            <!-- Itens -->
            <template #i_itemName-cell="{ row }">
              {{ itemRow(row).itemName || '—' }}
            </template>
            <template #i_orderNumber-cell="{ row }">
              <span v-if="itemRow(row).orderNumber" class="font-mono text-sm text-muted">#{{ itemRow(row).orderNumber }}</span>
              <span v-else class="text-muted">—</span>
            </template>
            <template #i_baseAmount-cell="{ row }">
              {{ formatCurrency(itemRow(row).baseAmount) }}
            </template>
            <template #i_commissionRule-cell="{ row }">
              <span class="text-sm text-muted">{{ itemRow(row).commissionRule }}</span>
            </template>
            <template #i_itemAmount-cell="{ row }">
              {{ formatCurrency(itemRow(row).itemAmount) }}
            </template>
            <template #i_itemProfit-cell="{ row }">
              <span class="font-bold" :class="itemRow(row).itemProfit >= 0 ? 'text-success' : 'text-error'">
                {{ formatCurrency(itemRow(row).itemProfit) }}
              </span>
            </template>
            <template #i_amount-cell="{ row }">
              <span class="font-bold text-success">{{ formatCurrency(itemRow(row).amount) }}</span>
            </template>
            <template #i_actions-cell="{ row }">
              <div class="flex items-center justify-end">
                <UTooltip text="Ver detalhes">
                  <UButton
                    icon="i-lucide-eye"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="openCommissionDetail(itemRow(row))"
                  />
                </UTooltip>
              </div>
            </template>
          </AppDataTableInfinite>
        </template>
      </div>
    </template>
  </UDashboardPanel>

  <ReportsCommissionsDetailSlideover
    :open="detailOpen"
    :loading="detailLoading"
    :data="detailData"
    @update:open="value => { detailOpen = value; if (!value) detailData = null }"
  />
</template>
