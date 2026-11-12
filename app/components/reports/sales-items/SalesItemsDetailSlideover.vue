<script setup lang="ts">
import {
  formatSalesCostSourceLabel,
  formatSalesOrderStatusLabel,
  formatSalesPaymentMethodLabel,
  formatSalesPaymentStatusLabel,
  salesCostSourceColor,
  salesOrderStatusColor,
  salesPaymentMethodColor,
  salesPaymentStatusColor
} from '~/utils/report-sales-items'
import type { BadgeColor } from '~/types/ui'

export interface SalesItemsDetailRow {
  id: string
  orderId: string
  orderNumber: string
  itemDescription: string
  categoryName: string
  costSource: string
  quantity: number
  unitCost: number
  totalCost: number
  commissionCost: number
  totalValue: number
  profit: number
  responsible: string
}

export interface SalesItemsDetailData {
  mode: 'item' | 'os'
  id: string
  orderId: string
  currentItemId: string | null
  orderNumber: string
  client: string
  responsible: string
  status: string
  paymentStatus: string
  paymentMethod: string
  date: string
  categoryName: string
  costSource: string
  itemDescription: string
  quantity: number
  unitCost: number
  totalCost: number
  commissionCost: number
  totalCostWithCommission: number
  totalValue: number
  profit: number
  itemCount: number
  items: SalesItemsDetailRow[]
}

const props = defineProps<{
  open: boolean
  loading: boolean
  data: SalesItemsDetailData | null
}>()

defineEmits<{
  'update:open': [value: boolean]
}>()

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(v: string | null) {
  if (!v) return '—'
  const [year, month, day] = v.split('-')
  if (!year || !month || !day) return '—'
  return `${day}/${month}/${year}`
}

function formatPercent(value: number) {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

function getInitials(name: string) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0]?.charAt(0) ?? '?').toUpperCase()
  return ((parts[0]?.charAt(0) ?? '') + (parts[parts.length - 1]?.charAt(0) ?? '')).toUpperCase()
}

function getResponsibleNames(value: string | null | undefined) {
  if (!value) return []

  return Array.from(
    new Set(
      value
        .split(',')
        .map(name => name.trim())
        .filter(Boolean)
    )
  )
}

function getCostSourceValues(value: string | null | undefined) {
  if (!value) return []

  return Array.from(
    new Set(
      value
        .split(',')
        .map(source => source.trim())
        .filter(Boolean)
    )
  )
}

function formatCostSourceSummary(value: string | null | undefined) {
  const sources = getCostSourceValues(value)
  if (sources.length === 0) return '—'
  if (sources.length === 1) return formatSalesCostSourceLabel(sources[0] || '')
  return 'Múltiplas origens'
}

function costSourceSummaryColor(value: string | null | undefined): BadgeColor {
  const sources = getCostSourceValues(value)
  if (sources.length === 0) return 'neutral'
  if (sources.length === 1) return salesCostSourceColor(sources[0] || '') as BadgeColor
  return 'warning'
}
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
        <div v-if="props.loading" class="space-y-2">
          <USkeleton class="h-5 w-40" />
          <USkeleton class="h-4 w-28" />
        </div>
        <div v-else-if="props.data">
          <h2 class="text-base font-bold text-highlighted">
            {{ props.data.mode === 'os' ? `OS #${props.data.orderNumber}` : props.data.itemDescription }}
          </h2>
          <p class="mt-0.5 text-xs text-muted">
            {{ props.data.client }}
          </p>
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
        <div class="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <USkeleton
            v-for="index in 5"
            :key="index"
            class="h-24 rounded-xl"
          />
        </div>
        <USkeleton class="h-48 rounded-xl" />
        <USkeleton class="h-48 rounded-xl" />
        <USkeleton class="h-72 rounded-xl" />
      </div>

      <div v-else-if="props.data" class="space-y-4 p-4">
        <div class="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <div class="rounded-xl border border-default bg-gradient-to-b from-success/10 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-success/10">
              <UIcon name="i-lucide-badge-dollar-sign" class="size-4 text-success" />
            </div>
            <p class="text-sm font-bold text-highlighted">
              {{ formatCurrency(props.data.totalValue) }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Valor vendido
            </p>
          </div>

          <div class="rounded-xl border border-default bg-gradient-to-b from-error/10 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-error/10">
              <UIcon name="i-lucide-wallet-cards" class="size-4 text-error" />
            </div>
            <p class="text-sm font-bold text-highlighted">
              {{ formatCurrency(props.data.totalCostWithCommission) }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Custo total
            </p>
          </div>

          <div class="rounded-xl border border-default bg-gradient-to-b from-warning/10 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-warning/10">
              <UIcon name="i-lucide-receipt-text" class="size-4 text-warning" />
            </div>
            <p class="text-sm font-bold text-highlighted">
              {{ formatCurrency(props.data.commissionCost) }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Comissão
            </p>
          </div>

          <div class="rounded-xl border border-default bg-gradient-to-b from-primary/10 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
              <UIcon name="i-lucide-chart-no-axes-combined" class="size-4 text-primary" />
            </div>
            <p class="text-sm font-bold text-highlighted">
              {{ formatCurrency(props.data.profit) }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Lucro
            </p>
          </div>

          <div class="rounded-xl border border-default bg-gradient-to-b from-info/10 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-info/10">
              <UIcon name="i-lucide-scale" class="size-4 text-info" />
            </div>
            <p class="text-sm font-bold text-highlighted">
              {{ formatPercent(props.data.totalValue > 0 ? (props.data.profit / props.data.totalValue) * 100 : 0) }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Margem
            </p>
          </div>
        </div>

        <UCard :ui="{ body: 'p-4' }">
          <div class="mb-3 flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="size-4 text-primary" />
            <p class="text-sm font-semibold text-highlighted">
              Contexto da venda
            </p>
          </div>

          <div class="grid grid-cols-1 gap-4 text-sm lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p class="text-xs text-muted">
                  OS
                </p>
                <p class="font-medium text-highlighted">
                  #{{ props.data.orderNumber }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  Data
                </p>
                <p class="font-medium text-highlighted">
                  {{ formatDate(props.data.date) }}
                </p>
              </div>
              <div class="sm:col-span-2">
                <p class="text-xs text-muted">
                  Cliente
                </p>
                <p class="font-medium text-highlighted">
                  {{ props.data.client }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  {{ props.data.mode === 'os' ? 'Itens na OS' : 'Item selecionado' }}
                </p>
                <p class="font-medium text-highlighted">
                  {{ props.data.mode === 'os' ? `${props.data.itemCount} item(ns)` : props.data.itemDescription }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  {{ props.data.mode === 'os' ? 'Quantidade total' : 'Quantidade' }}
                </p>
                <p class="font-medium text-highlighted">
                  {{ props.data.quantity }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  Categoria
                </p>
                <p class="font-medium text-highlighted">
                  {{ props.data.categoryName || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted">
                  Origem do custo
                </p>
                <UBadge
                  :color="costSourceSummaryColor(props.data.costSource)"
                  variant="soft"
                  size="xs"
                >
                  {{ formatCostSourceSummary(props.data.costSource) }}
                </UBadge>
              </div>
            </div>

            <div class="rounded-xl border border-default/70 bg-elevated/30 p-3">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Responsáveis
              </p>

              <div
                v-if="getResponsibleNames(props.data.responsible).length"
                class="mt-3 flex flex-wrap items-center gap-2"
              >
                <UTooltip
                  v-for="name in getResponsibleNames(props.data.responsible)"
                  :key="name"
                  :text="name"
                >
                  <span class="flex size-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {{ getInitials(name) }}
                  </span>
                </UTooltip>
              </div>
              <p v-else class="mt-3 text-sm text-muted">
                —
              </p>

              <div class="mt-4 flex flex-wrap gap-2">
                <UBadge
                  :color="salesOrderStatusColor(props.data.status) as BadgeColor"
                  variant="subtle"
                  size="xs"
                >
                  {{ formatSalesOrderStatusLabel(props.data.status) }}
                </UBadge>
                <UBadge
                  :color="salesPaymentStatusColor(props.data.paymentStatus) as BadgeColor"
                  variant="subtle"
                  size="xs"
                >
                  {{ formatSalesPaymentStatusLabel(props.data.paymentStatus) }}
                </UBadge>
                <UBadge
                  :color="salesPaymentMethodColor(props.data.paymentMethod) as BadgeColor"
                  variant="soft"
                  size="xs"
                >
                  {{ formatSalesPaymentMethodLabel(props.data.paymentMethod) }}
                </UBadge>
              </div>
            </div>
          </div>
        </UCard>

        <UCard :ui="{ body: 'p-4' }">
          <div class="mb-3 flex items-center gap-2">
            <UIcon name="i-lucide-calculator" class="size-4 text-primary" />
            <p class="text-sm font-semibold text-highlighted">
              Composição financeira
            </p>
          </div>

          <div class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <div class="rounded-lg border border-default/70 bg-elevated/20 p-3">
              <p class="text-xs text-muted">
                Valor unitário médio
              </p>
              <p class="mt-1 font-semibold text-highlighted">
                {{ formatCurrency(props.data.quantity > 0 ? props.data.totalValue / props.data.quantity : 0) }}
              </p>
            </div>
            <div class="rounded-lg border border-default/70 bg-elevated/20 p-3">
              <p class="text-xs text-muted">
                Custo unitário
              </p>
              <p class="mt-1 font-semibold text-highlighted">
                {{ formatCurrency(props.data.unitCost) }}
              </p>
            </div>
            <div class="rounded-lg border border-default/70 bg-elevated/20 p-3">
              <p class="text-xs text-muted">
                Custo sem comissão
              </p>
              <p class="mt-1 font-semibold text-highlighted">
                {{ formatCurrency(props.data.totalCost) }}
              </p>
            </div>
            <div class="rounded-lg border border-default/70 bg-elevated/20 p-3">
              <p class="text-xs text-muted">
                Comissão
              </p>
              <p class="mt-1 font-semibold text-highlighted">
                {{ formatCurrency(props.data.commissionCost) }}
              </p>
            </div>
            <div class="rounded-lg border border-default/70 bg-elevated/20 p-3">
              <p class="text-xs text-muted">
                Custo com comissão
              </p>
              <p class="mt-1 font-semibold text-highlighted">
                {{ formatCurrency(props.data.totalCostWithCommission) }}
              </p>
            </div>
            <div class="rounded-lg border border-default/70 bg-elevated/20 p-3">
              <p class="text-xs text-muted">
                Lucro líquido
              </p>
              <p class="mt-1 font-semibold text-highlighted">
                {{ formatCurrency(props.data.profit) }}
              </p>
            </div>
          </div>
        </UCard>

        <UCard v-if="props.data.items.length" :ui="{ body: 'p-0' }">
          <div class="flex items-center gap-2 border-b border-default px-4 py-3">
            <UIcon name="i-lucide-list" class="size-4 text-primary" />
            <p class="text-sm font-semibold text-highlighted">
              {{ props.data.mode === 'os' ? 'Itens da OS' : 'Contexto da OS' }}
            </p>
          </div>

          <div class="divide-y divide-default/70">
            <div
              v-for="item in props.data.items"
              :key="item.id"
              class="px-4 py-4"
              :class="props.data.currentItemId === item.id ? 'bg-primary/5' : ''"
            >
              <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="font-medium text-highlighted">
                      {{ item.itemDescription }}
                    </p>
                    <UBadge
                      v-if="props.data.currentItemId === item.id"
                      color="primary"
                      variant="soft"
                      size="xs"
                    >
                      Item atual
                    </UBadge>
                  </div>

                  <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{{ item.categoryName || 'Sem categoria' }}</span>
                    <span>{{ item.quantity }} un</span>
                    <span>custo unit. {{ formatCurrency(item.unitCost) }}</span>
                    <UBadge
                      :color="salesCostSourceColor(item.costSource) as BadgeColor"
                      variant="soft"
                      size="xs"
                    >
                      {{ formatSalesCostSourceLabel(item.costSource) }}
                    </UBadge>
                  </div>

                  <div
                    v-if="getResponsibleNames(item.responsible).length"
                    class="mt-3 flex flex-wrap items-center gap-1.5"
                  >
                    <UTooltip
                      v-for="name in getResponsibleNames(item.responsible)"
                      :key="`${item.id}-${name}`"
                      :text="name"
                    >
                      <span class="flex size-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                        {{ getInitials(name) }}
                      </span>
                    </UTooltip>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2 text-sm xl:min-w-[17rem]">
                  <div class="rounded-lg border border-default/70 bg-elevated/20 p-2.5">
                    <p class="text-[11px] text-muted">
                      Valor
                    </p>
                    <p class="mt-1 font-medium text-highlighted">
                      {{ formatCurrency(item.totalValue) }}
                    </p>
                  </div>
                  <div class="rounded-lg border border-default/70 bg-elevated/20 p-2.5">
                    <p class="text-[11px] text-muted">
                      Custo
                    </p>
                    <p class="mt-1 font-medium text-highlighted">
                      {{ formatCurrency(item.totalCost) }}
                    </p>
                  </div>
                  <div class="rounded-lg border border-default/70 bg-elevated/20 p-2.5">
                    <p class="text-[11px] text-muted">
                      Comissão
                    </p>
                    <p class="mt-1 font-medium text-highlighted">
                      {{ formatCurrency(item.commissionCost) }}
                    </p>
                  </div>
                  <div class="rounded-lg border border-default/70 bg-elevated/20 p-2.5">
                    <p class="text-[11px] text-muted">
                      Lucro
                    </p>
                    <p class="mt-1 font-medium text-highlighted">
                      {{ formatCurrency(item.profit) }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </USlideover>
</template>
