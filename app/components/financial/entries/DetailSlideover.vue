<script setup lang="ts">
import { formatCategoryName } from '~/utils/financial-category-options'

type Entry = Record<string, unknown>

type LinkedEntry = {
  id: string
  description: string
  amount: number | string
  due_date: string
  status: string
  current_installment?: number | null
  installment_count?: number | null
  parent_transaction_id?: string | null
  recurrence?: string | null
  parent_recurrence_id?: string | null
}

type DetailResponse = {
  entry: Entry
  installmentSiblings: LinkedEntry[]
  recurringSiblings: LinkedEntry[]
}

const props = defineProps<{
  open: boolean
  entryId: string | null
  bankAccountById: Map<string, string>
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'edit': [entry: Entry]
}>()

const toast = useToast()
const detail = ref<DetailResponse | null>(null)
const isLoading = ref(false)

watch(
  () => props.open,
  async (opened) => {
    if (!opened || !props.entryId) {
      detail.value = null
      return
    }
    detail.value = null
    isLoading.value = true
    try {
      detail.value = await $fetch<DetailResponse>(`/api/financial/${props.entryId}`)
    } catch {
      toast.add({ title: 'Erro ao carregar detalhes', color: 'error' })
      emit('update:open', false)
    } finally {
      isLoading.value = false
    }
  }
)

// ── Formatters ────────────────────────────────────────────────────────────────

function formatCurrency(value: number | string | null | undefined) {
  return Number.parseFloat(String(value || 0)).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const [y, m, d] = value.split('-')
  return `${d}/${m}/${y}`
}

function normalizeStatus(value: unknown) {
  const v = String(value || '').toLowerCase()
  if (v === 'pago') return 'paid'
  if (v === 'pendente') return 'pending'
  return v
}

function normalizeRecurrence(value: unknown) {
  const v = String(value || '').trim().toLowerCase()
  if (!v || ['null', 'none', 'non_recurring', 'nao_recorrente', 'sem recorrencia', 'sem recorrência'].includes(v)) return ''
  if (v === 'mensal') return 'monthly'
  if (v === 'anual') return 'yearly'
  if (v === 'semanal') return 'weekly'
  return v
}

// ── Badge maps ────────────────────────────────────────────────────────────────

type BadgeColor = 'success' | 'error' | 'warning' | 'info' | 'neutral'

const typeLabelMap: Record<string, string> = {
  income: 'Receita',
  expense: 'Despesa',
  transfer_in: 'Transferência Entrada',
  transfer_out: 'Transferência Saída'
}
const typeColorMap: Record<string, BadgeColor> = {
  income: 'success',
  expense: 'error',
  transfer_in: 'info',
  transfer_out: 'info'
}
const typeIconMap: Record<string, string> = {
  income: 'i-lucide-trending-up',
  expense: 'i-lucide-trending-down',
  transfer_in: 'i-lucide-arrow-left-right',
  transfer_out: 'i-lucide-arrow-left-right'
}

const statusLabelMap: Record<string, string> = {
  paid: 'Pago',
  pending: 'Pendente',
  cancelled: 'Cancelado'
}
const statusColorMap: Record<string, BadgeColor> = {
  paid: 'success',
  pending: 'warning',
  cancelled: 'neutral'
}
const statusIconMap: Record<string, string> = {
  paid: 'i-lucide-circle-check',
  pending: 'i-lucide-clock',
  cancelled: 'i-lucide-circle-x'
}

const recurrenceLabelMap: Record<string, string> = {
  monthly: 'Mensal',
  mensal: 'Mensal',
  yearly: 'Anual',
  anual: 'Anual',
  weekly: 'Semanal',
  non_recurring: 'Sem recorrência'
}

// ── Computed helpers ──────────────────────────────────────────────────────────

type CategoryRef = { id: string, name: string, icon: string, color: string } | null

const entry = computed(() => detail.value?.entry ?? null)

// category_ref comes from the financial_categories join (server/api/financial/[id].get.ts).
// Falls back to the legacy free-text category for any transaction that
// somehow still lacks a category_id -- see docs/financial-categories-crud.md.
const categoryRef = computed(() => (entry.value?.category_ref as CategoryRef) ?? null)
const categoryLabel = computed(() => {
  const raw = categoryRef.value?.name || String(entry.value?.category ?? '')
  return raw ? formatCategoryName(raw) : '—'
})
const categoryIcon = computed(() => categoryRef.value?.icon || 'i-lucide-tag')
const categoryIconStyle = computed(() => categoryRef.value?.color ? { color: categoryRef.value.color } : undefined)
const installmentSiblings = computed(() => detail.value?.installmentSiblings ?? [])
const recurringSiblings = computed(() => detail.value?.recurringSiblings ?? [])

const entryStatus = computed(() => normalizeStatus(entry.value?.status))
const entryType = computed(() => String(entry.value?.type ?? ''))
const entryRecurrence = computed(() => normalizeRecurrence(String(entry.value?.recurrence ?? '')))

const isInstallment = computed(() => Boolean(entry.value?.is_installment))
const hasRecurrence = computed(() =>
  Boolean(entryRecurrence.value)
)

const bankAccountLabel = computed(() => {
  const id = String(entry.value?.bank_account_id || '')
  if (!id) return null
  return props.bankAccountById.get(id) || null
})

const amountClass = computed(() =>
  entryType.value === 'income' || entryType.value === 'transfer_in' ? 'text-success' : 'text-error'
)

function linkedEntryStatus(status: string) {
  return normalizeStatus(status)
}
</script>

<template>
  <USlideover
    :open="open"
    side="right"
    :ui="{ content: 'max-w-xl z-40', overlay: 'z-30' }"
    @update:open="emit('update:open', $event)"
  >
    <!-- Header -->
    <template #header>
      <div v-if="entry && !isLoading">
        <h2 class="truncate text-base font-bold text-highlighted">
          {{ String(entry.description ?? '—') }}
        </h2>
        <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <UBadge
            :color="typeColorMap[entryType] ?? 'neutral'"
            :icon="typeIconMap[entryType]"
            :label="typeLabelMap[entryType] ?? entryType"
            variant="subtle"
            size="sm"
          />
          <UBadge
            :color="statusColorMap[entryStatus] ?? 'neutral'"
            :icon="statusIconMap[entryStatus]"
            :label="statusLabelMap[entryStatus] ?? entryStatus"
            variant="soft"
            size="sm"
          />
          <UBadge
            v-if="isInstallment && entry.current_installment && entry.installment_count"
            color="info"
            variant="outline"
            icon="i-lucide-layers"
            :label="`${entry.current_installment}/${entry.installment_count}x`"
            size="sm"
          />
          <UBadge
            v-if="hasRecurrence"
            color="primary"
            variant="outline"
            icon="i-lucide-repeat"
            :label="recurrenceLabelMap[entryRecurrence] ?? entryRecurrence"
            size="sm"
          />
        </div>
      </div>
      <div v-else-if="isLoading">
        <USkeleton class="h-5 w-48" />
        <div class="mt-1.5 flex gap-1.5">
          <USkeleton class="h-5 w-16 rounded-full" />
          <USkeleton class="h-5 w-16 rounded-full" />
        </div>
      </div>
    </template>

    <!-- Body -->
    <template #body>
      <!-- Loading -->
      <div v-if="isLoading" class="space-y-4 p-6">
        <USkeleton v-for="n in 5" :key="n" class="h-8 w-full" />
      </div>

      <div v-else-if="entry" class="divide-y divide-default">
        <!-- ── Valores ──────────────────────────────────────────────── -->
        <section class="px-6 py-4 space-y-3">
          <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <dt class="text-xs text-muted">
                Valor
              </dt>
              <dd class="mt-0.5 text-lg font-bold" :class="amountClass">
                {{ formatCurrency(entry.amount as number) }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                Status
              </dt>
              <dd class="mt-0.5">
                <UBadge
                  :color="statusColorMap[entryStatus] ?? 'neutral'"
                  :icon="statusIconMap[entryStatus]"
                  :label="statusLabelMap[entryStatus] ?? entryStatus"
                  variant="soft"
                  size="sm"
                />
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                Vencimento
              </dt>
              <dd class="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-highlighted">
                <UIcon name="i-lucide-calendar" class="size-3.5 text-muted" />
                {{ formatDate(String(entry.due_date ?? '')) }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                Categoria
              </dt>
              <dd class="mt-0.5 flex items-center gap-1.5 text-sm text-highlighted">
                <UIcon :name="categoryIcon" class="size-3.5" :class="!categoryIconStyle && 'text-muted'" :style="categoryIconStyle" />
                {{ categoryLabel }}
              </dd>
            </div>
            <div v-if="bankAccountLabel" class="col-span-2">
              <dt class="text-xs text-muted">
                Conta bancária
              </dt>
              <dd class="mt-0.5 flex items-center gap-1.5 text-sm text-highlighted">
                <UIcon name="i-lucide-landmark" class="size-3.5 text-muted" />
                {{ bankAccountLabel }}
              </dd>
            </div>
            <div v-if="hasRecurrence" class="col-span-2">
              <dt class="text-xs text-muted">
                Recorrência
              </dt>
              <dd class="mt-0.5 flex items-center gap-1.5 text-sm text-highlighted">
                <UIcon name="i-lucide-repeat" class="size-3.5 text-muted" />
                {{ recurrenceLabelMap[entryRecurrence] ?? entryRecurrence }}
                <span v-if="entry.recurrence_end_date" class="text-muted">
                  até {{ formatDate(String(entry.recurrence_end_date)) }}
                </span>
              </dd>
            </div>
          </dl>
        </section>

        <!-- ── Observações ─────────────────────────────────────────── -->
        <section v-if="entry.notes" class="px-6 py-4 space-y-2">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
            Observações
          </h3>
          <p class="text-sm text-highlighted whitespace-pre-line">
            {{ String(entry.notes) }}
          </p>
        </section>

        <!-- ── Parcelas vinculadas ─────────────────────────────────── -->
        <section v-if="isInstallment && installmentSiblings.length > 0" class="px-6 py-4 space-y-3">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-layers" class="size-4 text-info" />
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
              Outras parcelas ({{ installmentSiblings.length }})
            </h3>
          </div>
          <div class="divide-y divide-default rounded-lg border border-default overflow-hidden">
            <div
              v-for="sibling in installmentSiblings"
              :key="sibling.id"
              class="flex items-center justify-between px-3 py-2.5 hover:bg-elevated transition-colors"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <span class="shrink-0 flex size-5 items-center justify-center rounded-full bg-info/10 text-xs font-bold text-info">
                  {{ sibling.current_installment ?? '?' }}
                </span>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-highlighted truncate">
                    {{ formatDate(sibling.due_date) }}
                  </p>
                  <p class="text-xs text-muted">
                    parcela {{ sibling.current_installment }}/{{ sibling.installment_count ?? entry.installment_count }}
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="text-sm font-semibold tabular-nums" :class="amountClass">
                  {{ formatCurrency(sibling.amount) }}
                </span>
                <UBadge
                  :color="statusColorMap[linkedEntryStatus(sibling.status)] ?? 'neutral'"
                  :icon="statusIconMap[linkedEntryStatus(sibling.status)]"
                  :label="statusLabelMap[linkedEntryStatus(sibling.status)] ?? sibling.status"
                  variant="soft"
                  size="xs"
                />
              </div>
            </div>
          </div>
          <!-- Total das parcelas -->
          <div class="flex items-center justify-between rounded-lg bg-elevated px-3 py-2 text-sm">
            <span class="text-muted">
              Total do parcelamento
            </span>
            <span class="font-bold" :class="amountClass">
              {{ formatCurrency([...installmentSiblings, { amount: entry.amount }].reduce((s, i) => s + Number(i.amount || 0), 0)) }}
            </span>
          </div>
        </section>

        <!-- ── Série recorrente ────────────────────────────────────── -->
        <section v-if="hasRecurrence && recurringSiblings.length > 0" class="px-6 py-4 space-y-3">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-repeat" class="size-4 text-primary" />
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
              Série recorrente
            </h3>
          </div>
          <div class="divide-y divide-default rounded-lg border border-default overflow-hidden max-h-72 overflow-y-auto">
            <div
              v-for="sibling in recurringSiblings"
              :key="sibling.id"
              class="flex items-center justify-between px-3 py-2.5 hover:bg-elevated transition-colors"
            >
              <div class="flex items-center gap-2 min-w-0">
                <UIcon name="i-lucide-calendar" class="size-3.5 shrink-0 text-muted" />
                <span class="text-sm text-highlighted">
                  {{ formatDate(sibling.due_date) }}
                </span>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <UBadge
                  :color="statusColorMap[linkedEntryStatus(sibling.status)] ?? 'neutral'"
                  :icon="statusIconMap[linkedEntryStatus(sibling.status)]"
                  :label="statusLabelMap[linkedEntryStatus(sibling.status)] ?? sibling.status"
                  variant="soft"
                  size="xs"
                />
                <span class="text-sm font-semibold tabular-nums" :class="amountClass">
                  {{ formatCurrency(sibling.amount) }}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>

    <!-- Footer -->
    <template #footer>
      <div v-if="entry" class="flex justify-end gap-2">
        <UButton
          label="Fechar"
          color="neutral"
          variant="ghost"
          @click="emit('update:open', false)"
        />
        <UButton
          label="Editar lançamento"
          icon="i-lucide-pencil"
          color="neutral"
          @click="emit('edit', entry)"
        />
      </div>
    </template>
  </USlideover>
</template>
