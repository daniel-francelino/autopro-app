<script setup lang="ts">
interface EvolutionPoint {
  name: string
  revenue: number
  costs: number
  profit: number
}

interface PeriodData {
  revenue: number
  costs: number
  profit: number
  profitMargin: number
  partsCost?: number
  commissionCost?: number
}

interface VariationValue {
  variation: number | null
  type: 'increase' | 'decrease' | 'equal'
  fromZeroBase?: boolean
}

interface Variations {
  revenue: VariationValue
  costs: VariationValue
  profit: VariationValue
  margin: VariationValue
}

interface TopOrder {
  number: string
  revenue: number
  cost: number
  profit: number
  margin: number
}

interface ComparisonMeta {
  mode: string
  modeLabel: string
  currentPeriodLabel: string
  previousPeriodLabel: string
}

interface ProfitReportResponse {
  data?: {
    profitReport?: {
      currentData?: PeriodData | null
      previousData?: PeriodData | null
      variations?: Variations | null
      evolutionData?: EvolutionPoint[]
      topProfitableOrders?: TopOrder[]
      comparisonMeta?: ComparisonMeta | null
    }
  }
}

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Relatório de Lucro' })

const requestFetch = useRequestFetch()
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { dateFrom, dateTo } = useReportDateRange()
const statusFilters = useReportQueryParam('status', ['paid'] as string[])
const compareMode = useReportQueryParam('compare', 'no_compare')
const mode = useReportQueryParam('mode', 'cash_flow' as 'cash_flow' | 'by_order')
const orderStatusFilters = useReportQueryParam('orderStatus', ['completed', 'invoiced', 'delivered'] as string[])
const orderPaymentStatusFilters = useReportQueryParam('orderPaymentStatus', [] as string[])

const compareWithPreviousPeriod = computed(() => compareMode.value !== 'no_compare')

const endpointPath = computed(() => {
  if (mode.value === 'by_order') return '/api/reports/profit-by-order'
  return '/api/reports/profit-cash-flow'
})

const { data, status } = await useAsyncData(
  () => `report-profit-${mode.value}-${dateFrom.value}-${dateTo.value}-${statusFilters.value.join(',')}-${orderStatusFilters.value.join(',')}-${orderPaymentStatusFilters.value.join(',')}-${compareMode.value}`,
  () => requestFetch<ProfitReportResponse>(endpointPath.value, {
    headers: requestHeaders,
    query: {
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      status: mode.value === 'cash_flow' && statusFilters.value.length ? statusFilters.value : undefined,
      orderStatus: mode.value === 'by_order' && orderStatusFilters.value.length ? orderStatusFilters.value : undefined,
      orderPaymentStatus: mode.value === 'by_order' && orderPaymentStatusFilters.value.length ? orderPaymentStatusFilters.value : undefined,
      compareWithPreviousPeriod: compareWithPreviousPeriod.value ? 'true' : 'false',
      compareMode: compareWithPreviousPeriod.value ? compareMode.value : undefined
    }
  }),
  { watch: [dateFrom, dateTo, statusFilters, orderStatusFilters, orderPaymentStatusFilters, compareMode, mode] }
)

const profitReport = computed(() => data.value?.data?.profitReport)
const current = computed(() => profitReport.value?.currentData ?? null)
const previous = computed(() => profitReport.value?.previousData ?? null)
const variations = computed(() => profitReport.value?.variations ?? null)
const evolution = computed(() => profitReport.value?.evolutionData ?? [])
const topOrders = computed(() => profitReport.value?.topProfitableOrders ?? [])
const comparisonMeta = computed(() => profitReport.value?.comparisonMeta ?? null)

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatPercent(v: number | string) {
  return `${parseFloat(String(v || 0)).toFixed(1)}%`
}

function variationText(value?: VariationValue | null, suffix = '') {
  if (!value) return '—'
  if (value.fromZeroBase) return 'Sem base anterior'
  if (!Number.isFinite(Number(value.variation))) return `Novo${suffix ? ` ${suffix}` : ''}`
  return `${Number(value.variation || 0).toFixed(1)}%${suffix}`
}

function variationIcon(value?: VariationValue | null) {
  if (value?.type === 'increase') return 'i-lucide-trending-up'
  if (value?.type === 'decrease') return 'i-lucide-trending-down'
  return 'i-lucide-minus'
}

function variationColor(value?: VariationValue | null, invert = false) {
  if (!value || value.type === 'equal') return 'text-muted'
  if (invert) return value.type === 'increase' ? 'text-error' : 'text-success'
  return value.type === 'increase' ? 'text-success' : 'text-error'
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppPageHeader title="Relatório de Lucro" />
    </template>

    <template #body>
      <div v-if="status === 'pending'" class="space-y-4 p-4">
        <USkeleton class="h-32 rounded-xl" />
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <USkeleton
            v-for="index in 4"
            :key="index"
            class="h-28 rounded-xl"
          />
        </div>
        <USkeleton class="h-80 rounded-xl" />
        <USkeleton class="h-72 rounded-xl" />
      </div>

      <div v-else class="space-y-4 p-4">
        <ReportsProfitFilters
          v-model:date-from="dateFrom"
          v-model:date-to="dateTo"
          v-model:status-filters="statusFilters"
          v-model:compare-mode="compareMode"
          v-model:mode="mode"
          v-model:order-status-filters="orderStatusFilters"
          v-model:order-payment-status-filters="orderPaymentStatusFilters"
        />

        <UCard :ui="{ body: 'p-3' }">
          <div class="flex items-start gap-3">
            <div class="rounded-xl bg-primary/10 p-2">
              <UIcon name="i-lucide-git-compare-arrows" class="size-5 text-primary" />
            </div>

            <div v-if="comparisonMeta" class="min-w-0 flex-1 space-y-3">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-semibold text-highlighted">
                  Comparação ativa
                </p>
                <UBadge color="primary" variant="soft" size="xs">
                  {{ comparisonMeta.modeLabel }}
                </UBadge>
              </div>

              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div class="rounded-xl border border-default bg-elevated/30 px-3 py-2.5">
                  <p class="text-[11px] font-medium uppercase tracking-wide text-muted">
                    Período atual
                  </p>
                  <p class="mt-1 text-sm font-medium text-highlighted">
                    {{ comparisonMeta.currentPeriodLabel }}
                  </p>
                </div>

                <div class="rounded-xl border border-default bg-elevated/30 px-3 py-2.5">
                  <p class="text-[11px] font-medium uppercase tracking-wide text-muted">
                    Comparado com
                  </p>
                  <p class="mt-1 text-sm font-medium text-highlighted">
                    {{ comparisonMeta.previousPeriodLabel }}
                  </p>
                </div>
              </div>

              <p class="text-sm text-muted">
                Os indicadores abaixo mostram a variação do período atual em relação ao período comparado.
              </p>
            </div>

            <div v-else>
              <p class="text-sm font-semibold text-highlighted">
                Sem comparação
              </p>
              <p class="text-sm text-muted">
                Selecione um modo de comparação para ver a variação entre períodos.
              </p>
            </div>
          </div>
        </UCard>

        <ReportsProfitSummary
          :current-data="current"
          :variations="variations"
        />

        <ReportsProfitCharts :evolution="evolution" />

        <UCard
          v-if="comparisonMeta && current && previous"
          :ui="{ body: 'p-4' }"
        >
          <div class="mb-4 flex items-center gap-2">
            <UIcon name="i-lucide-scale" class="size-4 text-primary" />
            <p class="text-sm font-semibold text-highlighted">
              Comparação de períodos
            </p>
          </div>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div class="rounded-xl border border-default bg-elevated/40 p-3">
              <div class="flex items-center gap-1.5">
                <UIcon name="i-lucide-banknote" class="size-3.5 text-primary" />
                <p class="text-xs text-muted">
                  Faturamento
                </p>
              </div>
              <p class="mt-1 text-sm font-bold text-primary">
                Atual: {{ formatCurrency(current.revenue) }}
              </p>
              <p class="mt-1 text-xs text-muted">
                Anterior: {{ formatCurrency(previous.revenue) }}
              </p>
              <div class="mt-2 flex items-center gap-1 text-xs">
                <UIcon
                  :name="variationIcon(variations?.revenue)"
                  :class="[variationColor(variations?.revenue), 'size-3.5']"
                />
                <span :class="variationColor(variations?.revenue)">
                  {{ variationText(variations?.revenue) }}
                </span>
              </div>
            </div>

            <div class="rounded-xl border border-default bg-elevated/40 p-3">
              <div class="flex items-center gap-1.5">
                <UIcon name="i-lucide-receipt" class="size-3.5 text-error" />
                <p class="text-xs text-muted">
                  Custos
                </p>
              </div>
              <p class="mt-1 text-sm font-bold text-error">
                Atual: {{ formatCurrency(current.costs) }}
              </p>
              <p class="mt-1 text-xs text-muted">
                Anterior: {{ formatCurrency(previous.costs) }}
              </p>
              <div class="mt-2 flex items-center gap-1 text-xs">
                <UIcon
                  :name="variationIcon(variations?.costs)"
                  :class="[variationColor(variations?.costs, true), 'size-3.5']"
                />
                <span :class="variationColor(variations?.costs, true)">
                  {{ variationText(variations?.costs) }}
                </span>
              </div>
            </div>

            <div class="rounded-xl border border-default bg-elevated/40 p-3">
              <div class="flex items-center gap-1.5">
                <UIcon name="i-lucide-coins" :class="['size-3.5', current.profit >= 0 ? 'text-success' : 'text-error']" />
                <p class="text-xs text-muted">
                  Lucro
                </p>
              </div>
              <p class="mt-1 text-sm font-bold" :class="current.profit >= 0 ? 'text-success' : 'text-error'">
                Atual: {{ formatCurrency(current.profit) }}
              </p>
              <p class="mt-1 text-xs text-muted">
                Anterior: {{ formatCurrency(previous.profit) }}
              </p>
              <div class="mt-2 flex items-center gap-1 text-xs">
                <UIcon
                  :name="variationIcon(variations?.profit)"
                  :class="[variationColor(variations?.profit), 'size-3.5']"
                />
                <span :class="variationColor(variations?.profit)">
                  {{ variationText(variations?.profit) }}
                </span>
              </div>
            </div>

            <div class="rounded-xl border border-default bg-elevated/40 p-3">
              <div class="flex items-center gap-1.5">
                <UIcon name="i-lucide-percent" class="size-3.5 text-info" />
                <p class="text-xs text-muted">
                  Margem
                </p>
              </div>
              <p class="mt-1 text-sm font-bold text-info">
                Atual: {{ formatPercent(current.profitMargin) }}
              </p>
              <p class="mt-1 text-xs text-muted">
                Anterior: {{ formatPercent(previous.profitMargin) }}
              </p>
              <div class="mt-2 flex items-center gap-1 text-xs">
                <UIcon
                  :name="variationIcon(variations?.margin)"
                  :class="[variationColor(variations?.margin), 'size-3.5']"
                />
                <span :class="variationColor(variations?.margin)">
                  {{ variationText(variations?.margin, ' pp') }}
                </span>
              </div>
            </div>
          </div>
        </UCard>

        <UCard v-if="mode === 'by_order'" :ui="{ body: 'p-0' }">
          <div class="flex items-center gap-2 border-b border-default px-4 py-3">
            <UIcon name="i-lucide-trophy" class="size-4 text-primary" />
            <p class="text-sm font-semibold text-highlighted">
              Ordens mais lucrativas
            </p>
            <UBadge
              v-if="topOrders.length"
              color="neutral"
              variant="soft"
              size="xs"
              class="ml-auto"
            >
              Top {{ topOrders.length }}
            </UBadge>
          </div>

          <div v-if="topOrders.length" class="space-y-2 p-4">
            <div
              v-for="(order, index) in topOrders"
              :key="order.number"
              class="flex flex-wrap items-center gap-3 rounded-xl border border-default bg-elevated/30 px-4 py-3 transition-colors hover:bg-elevated/60"
            >
              <span
                class="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                :class="index === 0 ? 'bg-yellow-500/15 text-yellow-500' : index === 1 ? 'bg-zinc-400/15 text-zinc-400' : index === 2 ? 'bg-amber-700/15 text-amber-700' : 'bg-elevated text-muted'"
              >
                {{ index + 1 }}
              </span>

              <span class="w-36 shrink-0 font-mono text-sm font-semibold text-highlighted">
                #{{ order.number }}
              </span>

              <div class="flex flex-1 flex-wrap items-center gap-x-6 gap-y-2">
                <div class="flex items-center gap-1.5">
                  <UIcon name="i-lucide-banknote" class="size-3.5 text-muted" />
                  <div>
                    <p class="text-[10px] uppercase tracking-wide text-muted">
                      Receita
                    </p>
                    <p class="text-xs font-medium text-highlighted">
                      {{ formatCurrency(order.revenue) }}
                    </p>
                  </div>
                </div>

                <div class="flex items-center gap-1.5">
                  <UIcon name="i-lucide-receipt" class="size-3.5 text-error/70" />
                  <div>
                    <p class="text-[10px] uppercase tracking-wide text-muted">
                      Custo
                    </p>
                    <p class="text-xs font-medium text-error">
                      {{ formatCurrency(order.cost) }}
                    </p>
                  </div>
                </div>

                <div class="flex items-center gap-1.5">
                  <UIcon
                    :name="order.profit >= 0 ? 'i-lucide-trending-up' : 'i-lucide-trending-down'"
                    :class="['size-3.5', order.profit >= 0 ? 'text-success/70' : 'text-error/70']"
                  />
                  <div>
                    <p class="text-[10px] uppercase tracking-wide text-muted">
                      Lucro
                    </p>
                    <p class="text-xs font-semibold" :class="order.profit >= 0 ? 'text-success' : 'text-error'">
                      {{ formatCurrency(order.profit) }}
                    </p>
                  </div>
                </div>

                <div class="ml-auto flex items-center gap-1.5">
                  <UIcon name="i-lucide-percent" class="size-3.5 text-muted" />
                  <UBadge
                    :color="order.margin >= 40 ? 'success' : order.margin >= 20 ? 'warning' : 'error'"
                    variant="soft"
                    size="sm"
                  >
                    {{ formatPercent(order.margin) }}
                  </UBadge>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <UIcon name="i-lucide-trophy" class="size-8 text-muted" />
            <p class="text-sm font-medium text-highlighted">
              Nenhuma OS encontrada
            </p>
            <p class="text-xs text-muted">
              Não há ordens lucrativas para exibir no período.
            </p>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
