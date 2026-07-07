<script setup lang="ts">
import {
  formatOrderStatusLabel,
  formatPaymentMethodLabel,
  orderStatusColor
} from '~/utils/report-debtors'

export interface CommissionCalculationBreakdownItem {
  itemKey: string
  itemName: string
  quantity: number
  unitPrice: number
  saleAmount: number
  costAmount: number
  profitAmount: number
  commissionAmount: number
  commissionType: string | null
  commissionBase: string | null
  commissionPercentage: number | null
  isCurrentRecord: boolean
}

export interface CommissionDetailData {
  id: string
  amount: number
  status: string
  referenceDate: string | null
  paymentDate: string | null
  description: string | null
  employee: {
    id: string | null
    name: string
    role: string | null
    commissionType: string | null
    commissionBase: string | null
    commissionValue: number | null
  }
  order: {
    id: string | null
    number: string | null
    status: string | null
    paymentStatus: string | null
    entryDate: string | null
    completionDate: string | null
    totalAmount: number
    discount: number
    paymentMethod: string | null
    clientName: string | null
    clientPhone: string | null
    clientEmail: string | null
    vehicleLabel: string | null
    reportedDefect: string | null
    diagnosis: string | null
    commissionReleaseMode: string | null
    responsibleNames: string[]
  }
  calculation: {
    source: 'order_items' | 'record_fields'
    note: string | null
    itemName: string | null
    itemAmount: number
    itemCost: number
    profitAmount: number
    baseAmount: number
    commissionType: string | null
    commissionBase: string | null
    commissionPercentage: number | null
    breakdown: CommissionCalculationBreakdownItem[]
    employeeOrderTotal: number
    orderCommissionTotal: number
  }
  relatedCommissions: Array<{
    id: string
    employeeId: string | null
    employeeName: string
    itemName: string
    amount: number
    status: string
    referenceDate: string | null
    paymentDate: string | null
    isCurrent: boolean
  }>
}

const props = defineProps<{
  open: boolean
  loading: boolean
  data: CommissionDetailData | null
}>()

defineEmits<{
  'update:open': [value: boolean]
}>()

function formatCurrency(value: number | string) {
  return parseFloat(String(value || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return '—'
  return `${day}/${month}/${year}`
}

function getInitials(name: string) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0]?.charAt(0) ?? '?').toUpperCase()
  return ((parts[0]?.charAt(0) ?? '') + (parts[parts.length - 1]?.charAt(0) ?? '')).toUpperCase()
}

function commissionStatusColor(status: string): 'warning' | 'success' | 'error' | 'neutral' {
  if (status === 'paid') return 'success'
  if (status === 'cancelled') return 'error'
  if (status === 'pending') return 'warning'
  return 'neutral'
}

function commissionStatusLabel(status: string) {
  if (status === 'paid') return 'Paga'
  if (status === 'cancelled') return 'Cancelada'
  if (status === 'pending') return 'Pendente'
  return status || '—'
}

function paymentStatusColor(status: string | null): 'warning' | 'success' | 'info' | 'neutral' {
  if (status === 'paid') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'partial') return 'info'
  return 'neutral'
}

function paymentStatusLabel(status: string | null) {
  if (status === 'paid') return 'Pago'
  if (status === 'partial') return 'Parcial'
  if (status === 'pending') return 'Pendente'
  return '—'
}

function commissionTypeLabel(type: string | null) {
  if (type === 'percentage') return 'Percentual'
  if (type === 'fixed') return 'Fixo'
  return '—'
}

function commissionBaseLabel(base: string | null) {
  if (base === 'profit') return 'Lucro'
  if (base === 'revenue') return 'Faturamento'
  return '—'
}

const currentBreakdown = computed(() =>
  props.data?.calculation.breakdown.find(item => item.isCurrentRecord) ?? props.data?.calculation.breakdown[0] ?? null
)
</script>

<template>
  <USlideover
    :open="props.open"
    side="right"
    :ui="{ content: 'max-w-3xl' }"
    @update:open="$emit('update:open', $event)"
  >
    <template #header>
      <div class="flex w-full items-center justify-between gap-3">
        <div v-if="props.loading" class="flex items-center gap-3">
          <USkeleton class="h-10 w-10 rounded-full shrink-0" />
          <div class="space-y-1.5">
            <USkeleton class="h-5 w-44" />
            <USkeleton class="h-3.5 w-28" />
          </div>
        </div>
        <div v-else-if="props.data" class="flex items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-sm font-bold text-white shadow-sm">
            {{ getInitials(props.data.employee.name) }}
          </div>
          <div>
            <h2 class="text-base font-bold leading-tight text-highlighted">
              {{ props.data.employee.name }}
            </h2>
            <p class="mt-0.5 text-xs text-muted">
              {{ props.data.order.number ? `#${props.data.order.number}` : 'Comissão sem OS vinculada' }}
            </p>
          </div>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          class="shrink-0"
          @click="$emit('update:open', false)"
        />
      </div>
    </template>

    <template #body>
      <div v-if="props.loading" class="space-y-4 p-4">
        <div class="grid grid-cols-2 gap-3">
          <USkeleton class="h-24 rounded-xl" />
          <USkeleton class="h-24 rounded-xl" />
          <USkeleton class="h-24 rounded-xl" />
          <USkeleton class="h-24 rounded-xl" />
        </div>
        <USkeleton class="h-44 rounded-xl" />
        <USkeleton class="h-64 rounded-xl" />
        <USkeleton class="h-40 rounded-xl" />
      </div>

      <div v-else-if="props.data" class="space-y-4 p-4">
        <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div class="rounded-xl border border-default bg-gradient-to-b from-success/10 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-success/10">
              <UIcon name="i-lucide-badge-dollar-sign" class="size-4 text-success" />
            </div>
            <p class="text-sm font-bold text-highlighted">
              {{ formatCurrency(props.data.amount) }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Comissão desta linha
            </p>
          </div>

          <div class="rounded-xl border border-default bg-gradient-to-b from-primary/10 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
              <UIcon name="i-lucide-calculator" class="size-4 text-primary" />
            </div>
            <p class="text-sm font-bold text-highlighted">
              {{ formatCurrency(props.data.calculation.baseAmount) }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Base do cálculo
            </p>
          </div>

          <div class="rounded-xl border border-default bg-gradient-to-b from-info/10 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-info/10">
              <UIcon name="i-lucide-users-round" class="size-4 text-info" />
            </div>
            <p class="text-sm font-bold text-highlighted">
              {{ formatCurrency(props.data.calculation.employeeOrderTotal) }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Total do funcionário na OS
            </p>
          </div>

          <div class="rounded-xl border border-default bg-gradient-to-b from-warning/10 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-warning/10">
              <UIcon name="i-lucide-receipt-text" class="size-4 text-warning" />
            </div>
            <p class="text-sm font-bold text-highlighted">
              {{ formatCurrency(props.data.calculation.orderCommissionTotal) }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Comissão total da OS
            </p>
            <UBadge
              v-if="props.data.order.commissionReleaseMode === 'full'"
              color="primary"
              variant="soft"
              size="xs"
              label="Liberada integralmente"
              class="mt-1"
            />
          </div>
        </div>

        <UCard :ui="{ body: 'p-4' }">
          <div class="mb-3 flex items-center gap-2">
            <UIcon name="i-lucide-badge-percent" class="size-4 text-primary" />
            <p class="text-sm font-semibold text-highlighted">
              Detalhes da comissão
            </p>
          </div>

          <div class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div class="flex items-center justify-between gap-3 sm:col-span-2">
              <span class="text-muted">Status</span>
              <UBadge
                :color="commissionStatusColor(props.data.status)"
                variant="subtle"
                :label="commissionStatusLabel(props.data.status)"
                size="xs"
              />
            </div>
            <div>
              <p class="text-xs text-muted">
                Referência
              </p>
              <p class="font-medium text-highlighted">
                {{ formatDate(props.data.referenceDate) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                Pagamento
              </p>
              <p class="font-medium text-highlighted">
                {{ formatDate(props.data.paymentDate) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                Tipo
              </p>
              <p class="font-medium text-highlighted">
                {{ commissionTypeLabel(props.data.employee.commissionType) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                Base
              </p>
              <p class="font-medium text-highlighted">
                {{ commissionBaseLabel(props.data.employee.commissionBase) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                Configuração do funcionário
              </p>
              <p class="font-medium text-highlighted">
                {{ props.data.employee.commissionType === 'percentage'
                  ? `${props.data.calculation.commissionPercentage ?? props.data.employee.commissionValue ?? 0}%`
                  : formatCurrency(props.data.employee.commissionValue ?? 0) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                Item desta linha
              </p>
              <p class="font-medium text-highlighted">
                {{ props.data.calculation.itemName || '—' }}
              </p>
            </div>
            <div v-if="props.data.employee.role">
              <p class="text-xs text-muted">
                Cargo
              </p>
              <p class="font-medium text-highlighted">
                {{ props.data.employee.role }}
              </p>
            </div>
            <div v-if="props.data.description" class="sm:col-span-2">
              <p class="text-xs text-muted">
                Descrição
              </p>
              <p class="font-medium text-highlighted">
                {{ props.data.description }}
              </p>
            </div>
          </div>
        </UCard>

        <UCard :ui="{ body: 'p-4' }">
          <div class="mb-3 flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="size-4 text-primary" />
            <p class="text-sm font-semibold text-highlighted">
              Ordem de serviço
            </p>
          </div>

          <div class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div class="flex items-center justify-between gap-3 sm:col-span-2">
              <span class="text-muted">OS</span>
              <div class="flex items-center gap-2">
                <UBadge
                  v-if="props.data.order.status"
                  :color="orderStatusColor(props.data.order.status)"
                  variant="subtle"
                  :label="formatOrderStatusLabel(props.data.order.status)"
                  size="xs"
                />
                <UBadge
                  v-if="props.data.order.paymentStatus"
                  :color="paymentStatusColor(props.data.order.paymentStatus)"
                  variant="soft"
                  :label="paymentStatusLabel(props.data.order.paymentStatus)"
                  size="xs"
                />
                <span class="font-mono font-medium text-highlighted">
                  {{ props.data.order.number ? `#${props.data.order.number}` : '—' }}
                </span>
              </div>
            </div>
            <div>
              <p class="text-xs text-muted">
                Cliente
              </p>
              <p class="font-medium text-highlighted">
                {{ props.data.order.clientName || '—' }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                Veículo
              </p>
              <p class="font-medium text-highlighted">
                {{ props.data.order.vehicleLabel || '—' }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                Entrada
              </p>
              <p class="font-medium text-highlighted">
                {{ formatDate(props.data.order.entryDate) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                Conclusão
              </p>
              <p class="font-medium text-highlighted">
                {{ formatDate(props.data.order.completionDate) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                Total da OS
              </p>
              <p class="font-medium text-highlighted">
                {{ formatCurrency(props.data.order.totalAmount) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted">
                Forma de pagamento
              </p>
              <p class="font-medium text-highlighted">
                {{ props.data.order.paymentMethod ? formatPaymentMethodLabel(props.data.order.paymentMethod) : '—' }}
              </p>
            </div>
            <div v-if="props.data.order.responsibleNames.length" class="sm:col-span-2">
              <p class="text-xs text-muted">
                Responsáveis
              </p>
              <p class="font-medium text-highlighted">
                {{ props.data.order.responsibleNames.join(', ') }}
              </p>
            </div>
            <div v-if="props.data.order.reportedDefect" class="sm:col-span-2">
              <p class="text-xs text-muted">
                Defeito relatado
              </p>
              <p class="font-medium text-highlighted">
                {{ props.data.order.reportedDefect }}
              </p>
            </div>
            <div v-if="props.data.order.diagnosis" class="sm:col-span-2">
              <p class="text-xs text-muted">
                Diagnóstico
              </p>
              <p class="font-medium text-highlighted">
                {{ props.data.order.diagnosis }}
              </p>
            </div>
          </div>

          <div v-if="props.data.order.id" class="mt-4 flex justify-end">
            <UButton
              label="Abrir OS"
              icon="i-lucide-external-link"
              color="neutral"
              variant="outline"
              size="sm"
              :to="`/app/service-orders?id=${props.data.order.id}`"
              target="_blank"
            />
          </div>
        </UCard>

        <UCard :ui="{ body: 'p-4' }">
          <div class="mb-3 flex items-center gap-2">
            <UIcon name="i-lucide-calculator" class="size-4 text-primary" />
            <p class="text-sm font-semibold text-highlighted">
              Cálculo
            </p>
          </div>

          <div class="rounded-xl border border-default bg-elevated/40 p-3 text-sm">
            <p class="font-medium text-highlighted">
              {{ currentBreakdown?.itemName || props.data.calculation.itemName || 'Item da comissão' }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ props.data.calculation.note }}
            </p>
            <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p class="text-xs text-muted">
                  Faturamento
                </p>
                <p class="font-semibold text-highlighted">
                  {{ formatCurrency(props.data.calculation.itemAmount) }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  Custo
                </p>
                <p class="font-semibold text-highlighted">
                  {{ formatCurrency(props.data.calculation.itemCost) }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  Lucro
                </p>
                <p class="font-semibold text-highlighted">
                  {{ formatCurrency(props.data.calculation.profitAmount) }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  Comissão
                </p>
                <p class="font-semibold text-success">
                  {{ formatCurrency(props.data.amount) }}
                </p>
              </div>
            </div>
          </div>

          <div class="mt-4 space-y-3">
            <div
              v-for="item in props.data.calculation.breakdown"
              :key="item.itemKey"
              class="rounded-xl border p-3"
              :class="item.isCurrentRecord ? 'border-primary/40 bg-primary/5' : 'border-default bg-elevated/20'"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="truncate text-sm font-semibold text-highlighted">
                      {{ item.itemName }}
                    </p>
                    <UBadge
                      v-if="item.isCurrentRecord"
                      color="primary"
                      variant="subtle"
                      label="Linha atual"
                      size="xs"
                    />
                  </div>
                  <p class="mt-1 text-xs text-muted">
                    {{ item.quantity }} un • {{ commissionTypeLabel(item.commissionType) }} • {{ commissionBaseLabel(item.commissionBase) }}
                    <span v-if="item.commissionType === 'percentage' && item.commissionPercentage !== null">• {{ item.commissionPercentage }}%</span>
                  </p>
                </div>
                <p class="text-sm font-bold text-success">
                  {{ formatCurrency(item.commissionAmount) }}
                </p>
              </div>

              <div class="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                <div>
                  <p class="text-xs text-muted">
                    Unitário
                  </p>
                  <p class="font-medium text-highlighted">
                    {{ formatCurrency(item.unitPrice) }}
                  </p>
                </div>
                <div>
                  <p class="text-xs text-muted">
                    Faturamento
                  </p>
                  <p class="font-medium text-highlighted">
                    {{ formatCurrency(item.saleAmount) }}
                  </p>
                </div>
                <div>
                  <p class="text-xs text-muted">
                    Custo
                  </p>
                  <p class="font-medium text-highlighted">
                    {{ formatCurrency(item.costAmount) }}
                  </p>
                </div>
                <div>
                  <p class="text-xs text-muted">
                    Lucro
                  </p>
                  <p class="font-medium text-highlighted">
                    {{ formatCurrency(item.profitAmount) }}
                  </p>
                </div>
                <div>
                  <p class="text-xs text-muted">
                    Valor da comissão
                  </p>
                  <p class="font-medium text-success">
                    {{ formatCurrency(item.commissionAmount) }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </UCard>

        <UCard :ui="{ body: 'p-0 sm:p-2' }">
          <div class="flex items-center gap-2 border-b border-default px-4 py-3">
            <UIcon name="i-lucide-history" class="size-4 text-primary" />
            <p class="text-sm font-semibold text-highlighted">
              Comissões da OS
            </p>
            <UBadge
              :label="String(props.data.relatedCommissions.length)"
              color="neutral"
              variant="subtle"
              size="xs"
              class="ml-auto"
            />
          </div>

          <div class="divide-y divide-default/70">
            <div
              v-for="item in props.data.relatedCommissions"
              :key="item.id"
              class="px-4 py-3 text-sm"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="font-semibold text-highlighted">
                      {{ item.employeeName }}
                    </p>
                    <UBadge
                      :color="commissionStatusColor(item.status)"
                      variant="subtle"
                      :label="commissionStatusLabel(item.status)"
                      size="xs"
                    />
                    <UBadge
                      v-if="item.isCurrent"
                      color="primary"
                      variant="soft"
                      label="Atual"
                      size="xs"
                    />
                  </div>
                  <p class="mt-1 text-xs text-muted">
                    {{ item.itemName }} • Ref. {{ formatDate(item.referenceDate) }} • Pagamento {{ formatDate(item.paymentDate) }}
                  </p>
                </div>
                <p class="font-bold text-highlighted">
                  {{ formatCurrency(item.amount) }}
                </p>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </USlideover>
</template>
