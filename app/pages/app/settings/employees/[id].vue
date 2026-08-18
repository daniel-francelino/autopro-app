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

interface EmployeeCommissionResponse {
  data?: {
    employee: EmployeeCommissionProfile
  }
}

interface CommissionDetailResponse {
  data?: {
    detail?: CommissionDetailData
  }
}

// ─── OS trabalhadas / Comissões / Itens vendidos (mesmo endpoint e formato do
// Relatório de Funcionários — server/utils/employee-report.ts) ─────────────

type BadgeColor = 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'
type ViewMode = 'orders' | 'commissions' | 'items'

interface EmployeeOrderRow {
  id: string
  number: string
  entryDate: string | null
  clientName: string
  status: string | null
  paymentStatus: 'paid' | 'pending' | 'cancelled' | null
  totalAmount: number
  totalCostAmount: number
  employeeCommission: number
  netAmount: number
}

interface EmployeeCommissionRow {
  id: string
  referenceDate: string | null
  description: string | null
  orderId: string | null
  orderNumber: string | null
  orderStatus: string | null
  orderPaymentStatus: 'paid' | 'pending' | 'cancelled' | null
  amount: number
  status: 'paid' | 'pending' | 'cancelled'
  recordType: string | null
}

interface EmployeeItemRow {
  id: string
  orderId: string
  orderNumber: string
  date: string | null
  itemDescription: string
  categoryName: string
  quantity: number
  totalValue: number
  totalCost: number
  commissionCost: number
  profit: number
}

interface EmployeeReportSummary {
  grossSales: number
  osExpenses: number
  totalCommissions: number
  otherEmployeesCommissions: number
  netSales: number
  orderCount: number
}

interface EmployeeReportResponse {
  data?: {
    summary?: EmployeeReportSummary | null
    ordersView?: EmployeeOrderRow[]
    commissionsView?: EmployeeCommissionRow[]
    itemsView?: EmployeeItemRow[]
  }
}

interface EmployeeBonusItem {
  bonusId: string
  bonusName: string
  referenceMonth: string
  commissionBase: 'revenue' | 'profit' | null
  goalAmount: number | null
  bonusAmount: number | null
  achievedAmount: number
  goalMet: boolean
  generated: boolean
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
const activeTab = useReportQueryParam('tab', 'orders' as ViewMode)

const queryKey = computed(() => `employee-commission-detail-${employeeId.value}-${dateFrom.value}-${dateTo.value}`)

// Segunda busca: OS trabalhadas / Comissões / Itens vendidos, mesmo endpoint
// usado pelo Relatório de Funcionários (server/utils/employee-report.ts) —
// os dados de perfil (foto, telefone, endereço) só existem na busca de cima,
// por isso as duas convivem na mesma tela. Disparadas juntas via Promise.all
// (não uma depois da outra) para não dobrar o tempo de carregamento.
const reportQueryKey = computed(() => `employee-detail-report-${employeeId.value}-${dateFrom.value}-${dateTo.value}`)

const [
  { data, status, error, refresh },
  { data: reportData, status: reportStatus },
  { data: bonusesData }
] = await Promise.all([
  useAsyncData(
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
  ),
  useAsyncData(
    () => reportQueryKey.value,
    () => requestFetch<EmployeeReportResponse>('/api/reports/employees', {
      headers: requestHeaders,
      query: {
        employeeId: employeeId.value,
        dateFrom: dateFrom.value,
        dateTo: dateTo.value
      }
    }),
    { watch: [reportQueryKey] }
  ),
  // Bônus atribuídos — não depende do período do relatório (dateFrom/dateTo
  // acima), sempre mostra o progresso do mês corrente
  // (docs/employee-bonus-feature-design.md §6.3).
  useAsyncData(
    () => `employee-bonuses-${employeeId.value}`,
    () => requestFetch<{ items: EmployeeBonusItem[] }>(`/api/employees/${employeeId.value}/bonuses`, { headers: requestHeaders }),
    { default: () => ({ items: [] }) }
  )
])

const employee = computed(() => data.value?.data?.employee ?? null)
const assignedBonuses = computed(() => bonusesData.value?.items ?? [])

const reportSummary = computed(() => reportData.value?.data?.summary ?? null)
const ordersView = computed(() => reportData.value?.data?.ordersView ?? [])
const commissionsView = computed(() => reportData.value?.data?.commissionsView ?? [])
const itemsView = computed(() => reportData.value?.data?.itemsView ?? [])
const isTableLoading = computed(() => reportStatus.value === 'pending')
// Só mostra o skeleton dos cards de resumo na primeira carga (sem dados
// ainda) — trocar o período depois disso é uma atualização silenciosa, sem
// piscar skeleton por cima de números que o usuário já está vendo.
const isFirstReportLoad = computed(() => reportStatus.value === 'pending' && !reportData.value)

// Cards de resumo (Total/Pagas/Pendentes/Cobertura) — derivados da aba
// Comissões, para refletir exatamente o que está na tabela abaixo.
const summary = computed<EmployeeCommissionSummary>(() => {
  const rows = commissionsView.value
  const paidRows = rows.filter(row => row.status === 'paid')
  const pendingRows = rows.filter(row => row.status === 'pending')
  const totalPaid = paidRows.reduce((sum, row) => sum + row.amount, 0)
  const totalPending = pendingRows.reduce((sum, row) => sum + row.amount, 0)
  const totalCommissions = reportSummary.value?.totalCommissions ?? rows.reduce((sum, row) => sum + row.amount, 0)
  const orderIds = new Set(rows.map(row => row.orderId).filter((id): id is string => Boolean(id)))

  return {
    totalCommissions,
    totalPaid,
    totalPending,
    itemsCount: rows.length,
    paidItemsCount: paidRows.length,
    pendingItemsCount: pendingRows.length,
    orderCount: orderIds.size,
    averageCommission: rows.length > 0 ? totalCommissions / rows.length : 0
  }
})

const viewItems = [
  { label: 'OS trabalhadas', value: 'orders' as const, icon: 'i-lucide-clipboard-list' },
  { label: 'Comissões', value: 'commissions' as const, icon: 'i-lucide-hand-coins' },
  { label: 'Itens vendidos', value: 'items' as const, icon: 'i-lucide-package-search' }
]

// Cada coluna recebe um `id` prefixado por aba (o Vue não permite dois blocos
// <template #slot> com o mesmo nome no mesmo elemento, mesmo que só um esteja
// ativo por vez via aba, então as 3 abas não podem compartilhar nomes de slot
// como "orderNumber").
const columnsByView: Record<ViewMode, { accessorKey?: string, id: string, header: string }[]> = {
  orders: [
    { id: 'o_number', accessorKey: 'number', header: 'OS' },
    { id: 'o_entryDate', accessorKey: 'entryDate', header: 'Entrada' },
    { id: 'o_clientName', accessorKey: 'clientName', header: 'Cliente' },
    { id: 'o_status', header: 'Status' },
    { id: 'o_payment', header: 'Pagamento' },
    { id: 'o_totalAmount', accessorKey: 'totalAmount', header: 'Venda bruta' },
    { id: 'o_employeeCommission', accessorKey: 'employeeCommission', header: 'Comissão' }
  ],
  commissions: [
    { id: 'c_referenceDate', accessorKey: 'referenceDate', header: 'Referência' },
    { id: 'c_orderNumber', accessorKey: 'orderNumber', header: 'OS' },
    { id: 'c_description', accessorKey: 'description', header: 'Descrição' },
    { id: 'c_orderStatus', header: 'Status OS' },
    { id: 'c_orderPayment', header: 'Pagamento OS' },
    { id: 'c_amount', accessorKey: 'amount', header: 'Valor' },
    { id: 'c_status', header: 'Status comissão' },
    { id: 'c_actions', header: '' }
  ],
  items: [
    { id: 'i_orderNumber', accessorKey: 'orderNumber', header: 'OS' },
    { id: 'i_date', accessorKey: 'date', header: 'Data' },
    { id: 'i_itemDescription', accessorKey: 'itemDescription', header: 'Item' },
    { id: 'i_categoryName', accessorKey: 'categoryName', header: 'Categoria' },
    { id: 'i_quantity', accessorKey: 'quantity', header: 'Qtd' },
    { id: 'i_totalValue', accessorKey: 'totalValue', header: 'Valor' },
    { id: 'i_totalCost', accessorKey: 'totalCost', header: 'Custo' },
    { id: 'i_commissionCost', accessorKey: 'commissionCost', header: 'Comissão' },
    { id: 'i_profit', accessorKey: 'profit', header: 'Líquido' }
  ]
}

const columns = computed(() => columnsByView[activeTab.value as ViewMode])

const activeData = computed<Record<string, unknown>[]>(() => {
  if (activeTab.value === 'commissions') return commissionsView.value as unknown as Record<string, unknown>[]
  if (activeTab.value === 'items') return itemsView.value as unknown as Record<string, unknown>[]
  return ordersView.value as unknown as Record<string, unknown>[]
})

const emptyStateByView: Record<ViewMode, { icon: string, title: string, description: string }> = {
  orders: { icon: 'i-lucide-clipboard-list', title: 'Nenhuma OS encontrada', description: 'Não há ordens de serviço para esse funcionário no período selecionado.' },
  commissions: { icon: 'i-lucide-hand-coins', title: 'Nenhuma comissão encontrada', description: 'Não há comissões registradas para esse funcionário no período selecionado.' },
  items: { icon: 'i-lucide-package-search', title: 'Nenhum item encontrado', description: 'Não há itens vendidos por esse funcionário no período selecionado.' }
}
const emptyState = computed(() => emptyStateByView[activeTab.value as ViewMode])

// Status maps
const orderStatusColorMap: Record<string, BadgeColor> = {
  open: 'info', in_progress: 'warning', waiting_for_part: 'warning',
  completed: 'success', invoiced: 'primary', delivered: 'success', estimate: 'neutral'
}
const orderStatusLabelMap: Record<string, string> = {
  open: 'Aberta', in_progress: 'Em andamento', waiting_for_part: 'Aguard. peça',
  completed: 'Concluída', invoiced: 'Faturada', delivered: 'Entregue', estimate: 'Orçamento'
}
const paymentStatusColorMap: Record<string, BadgeColor> = { pending: 'warning', paid: 'success', partial: 'info' }
const paymentStatusLabelMap: Record<string, string> = { pending: 'Pendente', paid: 'Pago', partial: 'Parcial' }
const commissionStatusColorMap: Record<string, BadgeColor> = { pending: 'warning', paid: 'success', cancelled: 'error' }
const commissionStatusLabelMap: Record<string, string> = { pending: 'Pendente', paid: 'Pago', cancelled: 'Cancelado' }

function orderRow(row: { original: unknown }): EmployeeOrderRow {
  return row.original as EmployeeOrderRow
}
function commissionRow(row: { original: unknown }): EmployeeCommissionRow {
  return row.original as EmployeeCommissionRow
}
function itemRow(row: { original: unknown }): EmployeeItemRow {
  return row.original as EmployeeItemRow
}

const employeeStatus = computed<{ label: string, color: 'success' | 'warning' | 'neutral' }>(() => {
  if (!employee.value?.terminationDate)
    return { label: 'Ativo', color: 'success' }

  const today = new Date().toISOString().split('T')[0]!
  if (employee.value.terminationDate <= today)
    return { label: 'Demitido', color: 'neutral' }

  return { label: 'Demissão agendada', color: 'warning' }
})

const exportItems = computed(() => [[
  {
    label: 'Exportar CSV',
    icon: 'i-lucide-file-spreadsheet',
    disabled: exporting.value !== null || activeData.value.length === 0,
    onSelect: () => exportReport('csv')
  },
  {
    label: 'Exportar PDF',
    icon: 'i-lucide-file-text',
    disabled: exporting.value !== null || activeData.value.length === 0,
    onSelect: () => exportReport('pdf')
  }
]])

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
  if (value === 'revenue_minus_parts') return 'Faturamento - peças'
  if (value === 'employee_net_profit') return 'Lucro líquido do funcionário'
  return '—'
}

function bonusStatusLabel(item: EmployeeBonusItem): { label: string, color: 'success' | 'warning' | 'neutral' } {
  if (item.goalAmount == null) return { label: 'Sem valor configurado', color: 'neutral' }
  if (item.goalMet) return { label: item.achievedAmount > item.goalAmount ? 'Meta superada' : 'Meta atingida', color: 'success' }
  return { label: 'Abaixo da meta', color: 'warning' }
}

function retryLoad() {
  return refresh()
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

async function openCommissionDetail(row: EmployeeCommissionRow) {
  detailOpen.value = true
  detailLoading.value = true
  detailData.value = null

  try {
    const response = await $fetch<CommissionDetailResponse>(`/api/reports/commissions/${row.id}`)
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
      '/api/reports/export-employees',
      {
        method: 'POST',
        body: {
          format,
          view: activeTab.value,
          employeeId: employeeId.value,
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
    toast.add({ title: 'Erro ao exportar relatório do funcionário', color: 'error' })
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
              <UButton label="Tentar novamente" color="neutral" @click="retryLoad" />
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

                  <div class="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
                    <div class="min-w-0 rounded-2xl border border-default/70 bg-default/40 p-3">
                      <p class="text-xs uppercase tracking-widest text-muted">
                        Cargo
                      </p>
                      <p class="mt-1 truncate text-sm font-medium text-highlighted">
                        {{ employee.role || 'Não informado' }}
                      </p>
                    </div>
                    <div class="min-w-0 rounded-2xl border border-default/70 bg-default/40 p-3">
                      <p class="text-xs uppercase tracking-widest text-muted">
                        Telefone
                      </p>
                      <p class="mt-1 truncate text-sm font-medium text-highlighted">
                        {{ formatPhone(employee.phone) }}
                      </p>
                    </div>
                    <div class="min-w-0 rounded-2xl border border-default/70 bg-default/40 p-3">
                      <p class="text-xs uppercase tracking-widest text-muted">
                        Documento
                      </p>
                      <p class="mt-1 truncate text-sm font-medium text-highlighted">
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

                <div class="rounded-2xl border border-default/70 bg-default/50 p-4 sm:col-span-2">
                  <div class="flex items-start gap-3">
                    <UIcon name="i-lucide-gift" class="mt-0.5 size-5 shrink-0 text-success" />
                    <div class="min-w-0 flex-1 space-y-2">
                      <p class="text-xs uppercase tracking-widest text-muted">
                        Bônus atribuídos
                      </p>
                      <p v-if="assignedBonuses.length === 0" class="text-sm text-muted">
                        Nenhum bônus atribuído a este funcionário.
                      </p>
                      <ul v-else class="space-y-2">
                        <li
                          v-for="bonus in assignedBonuses"
                          :key="bonus.bonusId"
                          class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-default/60 bg-elevated/30 px-3 py-2"
                        >
                          <div class="min-w-0">
                            <NuxtLink
                              :to="`/app/financial/bonuses/${bonus.bonusId}`"
                              class="truncate text-sm font-medium text-highlighted hover:underline"
                            >
                              {{ bonus.bonusName }}
                            </NuxtLink>
                            <p class="text-xs text-muted">
                              {{ formatCurrency(bonus.achievedAmount) }} / {{ bonus.goalAmount != null ? formatCurrency(bonus.goalAmount) : '—' }}
                              <span v-if="bonus.commissionBase"> · {{ formatCommissionBase(bonus.commissionBase) }}</span>
                            </p>
                          </div>
                          <UBadge :color="bonusStatusLabel(bonus).color" variant="subtle" size="sm">
                            {{ bonusStatusLabel(bonus).label }}
                          </UBadge>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3">
            <UiDateRangePicker v-model:from="dateFrom" v-model:to="dateTo" class="w-auto" />
          </div>

          <div v-if="isFirstReportLoad" class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <USkeleton v-for="i in 4" :key="i" class="h-24 w-full rounded-2xl" />
          </div>

          <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

          <div class="flex flex-wrap items-center justify-between gap-3">
            <UTabs
              v-model="activeTab"
              :items="viewItems"
              variant="link"
              class="w-auto"
            />

            <UTooltip :text="`Exportar relatório de ${employee.name}`">
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
          </div>

          <AppDataTableInfinite
            :key="activeTab"
            :columns="columns"
            :data="activeData"
            :loading="isTableLoading"
            :has-more="false"
            :total="activeData.length"
            :empty-icon="emptyState.icon"
            :empty-title="emptyState.title"
            :empty-description="emptyState.description"
          >
            <!-- OS trabalhadas -->
            <template #o_number-cell="{ row }">
              <span class="font-mono text-sm text-muted">#{{ orderRow(row).number }}</span>
            </template>
            <template #o_entryDate-cell="{ row }">
              {{ formatDate(orderRow(row).entryDate) }}
            </template>
            <template #o_status-cell="{ row }">
              <UBadge
                v-if="orderRow(row).status"
                :color="orderStatusColorMap[orderRow(row).status || ''] ?? 'neutral'"
                variant="subtle"
                :label="orderStatusLabelMap[orderRow(row).status || ''] ?? String(orderRow(row).status)"
                size="sm"
              />
              <span v-else class="text-sm text-muted">—</span>
            </template>
            <template #o_payment-cell="{ row }">
              <UBadge
                v-if="orderRow(row).paymentStatus"
                :color="paymentStatusColorMap[orderRow(row).paymentStatus || ''] ?? 'neutral'"
                variant="subtle"
                :label="paymentStatusLabelMap[orderRow(row).paymentStatus || ''] ?? String(orderRow(row).paymentStatus)"
                size="sm"
              />
              <span v-else class="text-sm text-muted">—</span>
            </template>
            <template #o_totalAmount-cell="{ row }">
              {{ formatCurrency(orderRow(row).totalAmount) }}
            </template>
            <template #o_employeeCommission-cell="{ row }">
              <span class="text-warning">{{ formatCurrency(orderRow(row).employeeCommission) }}</span>
            </template>

            <!-- Comissões -->
            <template #c_referenceDate-cell="{ row }">
              {{ formatDate(commissionRow(row).referenceDate) }}
            </template>
            <template #c_orderNumber-cell="{ row }">
              <span v-if="commissionRow(row).orderNumber" class="font-mono text-sm text-muted">
                #{{ commissionRow(row).orderNumber }}
              </span>
              <span v-else class="text-muted">—</span>
            </template>
            <template #c_orderStatus-cell="{ row }">
              <UBadge
                v-if="commissionRow(row).orderStatus"
                :color="orderStatusColorMap[commissionRow(row).orderStatus || ''] ?? 'neutral'"
                variant="subtle"
                :label="orderStatusLabelMap[commissionRow(row).orderStatus || ''] ?? String(commissionRow(row).orderStatus)"
                size="sm"
              />
              <span v-else class="text-sm text-muted">—</span>
            </template>
            <template #c_orderPayment-cell="{ row }">
              <UBadge
                v-if="commissionRow(row).orderPaymentStatus"
                :color="paymentStatusColorMap[commissionRow(row).orderPaymentStatus || ''] ?? 'neutral'"
                variant="subtle"
                :label="paymentStatusLabelMap[commissionRow(row).orderPaymentStatus || ''] ?? String(commissionRow(row).orderPaymentStatus)"
                size="sm"
              />
              <span v-else class="text-sm text-muted">—</span>
            </template>
            <template #c_amount-cell="{ row }">
              <span class="font-bold text-success">{{ formatCurrency(commissionRow(row).amount) }}</span>
            </template>
            <template #c_status-cell="{ row }">
              <UBadge
                :color="commissionStatusColorMap[commissionRow(row).status] ?? 'neutral'"
                variant="subtle"
                :label="commissionStatusLabelMap[commissionRow(row).status] ?? String(commissionRow(row).status)"
                size="sm"
              />
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

            <!-- Itens vendidos -->
            <template #i_orderNumber-cell="{ row }">
              <span class="font-mono text-sm text-muted">#{{ itemRow(row).orderNumber }}</span>
            </template>
            <template #i_date-cell="{ row }">
              {{ formatDate(itemRow(row).date) }}
            </template>
            <template #i_totalValue-cell="{ row }">
              {{ formatCurrency(itemRow(row).totalValue) }}
            </template>
            <template #i_totalCost-cell="{ row }">
              <span class="text-error">{{ formatCurrency(itemRow(row).totalCost) }}</span>
            </template>
            <template #i_commissionCost-cell="{ row }">
              <span class="text-warning">{{ formatCurrency(itemRow(row).commissionCost) }}</span>
            </template>
            <template #i_profit-cell="{ row }">
              <span class="font-bold" :class="itemRow(row).profit >= 0 ? 'text-success' : 'text-error'">
                {{ formatCurrency(itemRow(row).profit) }}
              </span>
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
