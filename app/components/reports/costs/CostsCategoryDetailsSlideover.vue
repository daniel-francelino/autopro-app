<script setup lang="ts">
import { DEFAULT_CATEGORY_COLOR } from '~/utils/financial-category-options'

export interface CostCategoryDetailItem {
  id: string
  description: string
  category: string
  amount: number
  status: string
  type: string
  due_date: string | null
  recurrence: string | null
  is_installment: boolean
  current_installment: number | null
  installment_count: number | null
  notes: string | null
}

export interface CostCategoryDetailData {
  categoryKey: string
  category: string
  icon: string
  color: string
  totalItems: number
  totalValue: number
  items: CostCategoryDetailItem[]
}

const props = defineProps<{
  open: boolean
  loading: boolean
  data: CostCategoryDetailData | null
}>()

type BadgeColor = 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'

defineEmits<{
  'update:open': [value: boolean]
}>()

const statusColorMap: Record<string, BadgeColor> = {
  paid: 'success',
  pending: 'warning'
}

const statusLabelMap: Record<string, string> = {
  paid: 'Pago',
  pending: 'Pendente'
}

function formatCurrency(v: number | string) {
  return parseFloat(String(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(v: string | null) {
  if (!v) return '—'
  const [year, month, day] = v.split('-')
  if (!year || !month || !day) return '—'
  return `${day}/${month}/${year}`
}

function formatRecurrence(value: string | null) {
  if (!value) return 'Não recorrente'
  const recurrenceLabelMap: Record<string, string> = {
    daily: 'Diária',
    weekly: 'Semanal',
    biweekly: 'Quinzenal',
    monthly: 'Mensal',
    bimonthly: 'Bimestral',
    quarterly: 'Trimestral',
    semiannual: 'Semestral',
    yearly: 'Anual',
    annually: 'Anual',
    nao_recorrente: 'Não recorrente',
    non_recurring: 'Não recorrente'
  }

  const normalizedValue = String(value).trim().toLowerCase()
  if (recurrenceLabelMap[normalizedValue]) return recurrenceLabelMap[normalizedValue]
  return normalizedValue.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

const headerColor = computed(() => props.data?.color ?? DEFAULT_CATEGORY_COLOR)
</script>

<template>
  <USlideover
    :open="props.open"
    side="right"
    :ui="{ content: 'max-w-2xl' }"
    @update:open="$emit('update:open', $event)"
  >
    <template #header>
      <div class="flex items-center justify-between gap-3 w-full">
        <div v-if="props.loading" class="flex items-center gap-3">
          <USkeleton class="h-10 w-10 rounded-xl shrink-0" />
          <div class="space-y-1.5">
            <USkeleton class="h-5 w-40" />
            <USkeleton class="h-3.5 w-28" />
          </div>
        </div>
        <div v-else-if="props.data" class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
            :style="{ backgroundColor: headerColor }"
          >
            <UIcon :name="props.data.icon" class="size-4" />
          </div>
          <div>
            <h2 class="text-base font-bold leading-tight text-highlighted">
              {{ props.data.category }}
            </h2>
            <p class="mt-0.5 text-xs text-muted">
              {{ props.data.totalItems }} lançamento{{ props.data.totalItems !== 1 ? 's' : '' }} nos filtros atuais
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
        </div>
        <USkeleton
          v-for="index in 4"
          :key="index"
          class="h-28 rounded-xl"
        />
      </div>

      <div v-else-if="props.data" class="space-y-4 p-4">
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-xl border border-default bg-gradient-to-b from-elevated/50 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-neutral/10">
              <UIcon name="i-lucide-wallet-cards" class="size-4 text-highlighted" />
            </div>
            <p class="text-sm font-bold leading-tight text-highlighted">
              {{ formatCurrency(props.data.totalValue) }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Total da categoria
            </p>
          </div>
          <div class="rounded-xl border border-default bg-gradient-to-b from-elevated/50 to-default p-3 text-center">
            <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-info/10">
              <UIcon name="i-lucide-receipt-text" class="size-4 text-info" />
            </div>
            <p class="text-sm font-bold leading-tight text-highlighted">
              {{ props.data.totalItems }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Lançamentos
            </p>
          </div>
        </div>

        <div v-if="props.data.items.length" class="space-y-3">
          <UCard
            v-for="item in props.data.items"
            :key="item.id"
            :ui="{ body: 'p-4' }"
            class="border border-default/80 shadow-sm"
          >
            <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div class="min-w-0 space-y-3">
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge
                    :color="statusColorMap[item.status] ?? 'neutral'"
                    variant="subtle"
                    :label="statusLabelMap[item.status] ?? item.status"
                    size="xs"
                  />
                  <UBadge
                    v-if="item.is_installment && item.current_installment && item.installment_count"
                    color="info"
                    variant="soft"
                    size="xs"
                  >
                    {{ item.current_installment }}/{{ item.installment_count }}x
                  </UBadge>
                  <UBadge
                    v-if="item.recurrence && item.recurrence !== 'nao_recorrente'"
                    color="neutral"
                    variant="outline"
                    size="xs"
                  >
                    {{ formatRecurrence(item.recurrence) }}
                  </UBadge>
                </div>

                <div>
                  <p class="text-base font-semibold break-words text-highlighted">
                    {{ item.description || 'Sem descrição' }}
                  </p>
                  <div class="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
                    <span class="inline-flex items-center gap-1.5">
                      <UIcon name="i-lucide-calendar-days" class="size-4" />
                      {{ formatDate(item.due_date) }}
                    </span>
                    <span class="inline-flex items-center gap-1.5">
                      <UIcon :name="props.data?.icon ?? 'i-lucide-tag'" class="size-4" />
                      {{ item.category }}
                    </span>
                  </div>
                </div>

                <p v-if="item.notes" class="text-sm break-words text-muted">
                  {{ item.notes }}
                </p>
              </div>

              <div class="shrink-0">
                <p class="text-sm text-muted lg:text-right">
                  Valor
                </p>
                <p class="text-xl font-bold text-highlighted lg:text-right">
                  {{ formatCurrency(item.amount) }}
                </p>
              </div>
            </div>
          </UCard>
        </div>

        <div v-else class="py-12 text-center text-muted">
          <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-default/80 bg-elevated/60 text-primary">
            <UIcon name="i-lucide-receipt" class="size-5" />
          </div>
          <p class="text-sm font-semibold text-highlighted">
            Nenhum lançamento encontrado
          </p>
          <p class="mt-1 text-sm">
            A categoria selecionada não possui lançamentos com os filtros atuais.
          </p>
        </div>
      </div>
    </template>
  </USlideover>
</template>
