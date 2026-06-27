<script setup lang="ts">
import type { RowSelectionState } from '@tanstack/table-core'

type BadgeColor = 'success' | 'error' | 'warning' | 'primary' | 'secondary' | 'info' | 'neutral'

interface Entry {
  id: string
  description: string
  amount: string | number
  due_date: string
  type: string
  status: string
  category_id?: string | null
  category_ref?: { id: string, name: string, icon: string, color: string } | null
  bank_account_id?: string | null
  notes?: string | null
  recurrence?: string | null
  is_installment?: boolean | null
  installment_count?: number | null
  current_installment?: number | null
  [key: string]: unknown
}

type BankAccountItem = {
  id: string
  account_name: string
  bank_name?: string | null
}

const props = defineProps<{
  open: boolean
  data: Entry[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  total: number
  search: string
  rowSelection: RowSelectionState
  dateFrom: string
  dateTo: string
  typeFilters: string[]
  statusFilters: string[]
  categoryFilter: string
  uniqueCategories: Array<{ id: string, name: string }>
  exportItems: object[][]
  exporting: string | null
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  pendingSelectedCount: number
  selectedCount: number
  bankAccountOptions: BankAccountItem[]
  isPaying: boolean
  payingEntryId: string | null
  isDuplicating: boolean
  duplicatingEntryId: string | null
  isDeleting: boolean
  entryPendingDeletionId: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:search': [value: string]
  'update:rowSelection': [value: RowSelectionState]
  'update:dateFrom': [value: string]
  'update:dateTo': [value: string]
  'update:typeFilters': [value: string[]]
  'update:statusFilters': [value: string[]]
  'update:categoryFilter': [value: string]
  'search-submit': [value: string]
  'load-more': []
  'bulk-pay': []
  'bulk-delete': []
  'open-create': []
  'open-detail': [entry: Entry]
  'pay': [entry: Entry]
  'duplicate': [entry: Entry]
  'open-edit': [entry: Entry]
  'remove': [entry: Entry]
}>()

// ── Formatters ────────────────────────────────────────────────────────────────

function formatCurrency(value: number | string) {
  const parsed = Number.parseFloat(String(value || 0))
  return Number.isFinite(parsed) ? parsed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00'
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const [year, month, day] = String(value).split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function normalizeStatusValue(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'pago') return 'paid'
  if (normalized === 'pendente') return 'pending'
  return normalized
}

function formatStatusLabel(value: unknown) {
  const normalized = normalizeStatusValue(value)
  if (normalized === 'paid') return 'Pago'
  if (normalized === 'pending') return 'Pendente'
  return String(value || '—')
}

function isPaidStatus(value: unknown) {
  return normalizeStatusValue(value) === 'paid'
}

function getBankAccountLabel(entry: Entry) {
  const accountId = String(entry.bank_account_id || '')
  if (!accountId) return null
  return props.bankAccountOptions.find(a => a.id === accountId)?.account_name ?? null
}

const typeBadgeLabel: Record<string, string> = { income: 'Receita', expense: 'Despesa' }
const statusBadgeColor: Record<string, BadgeColor> = { paid: 'success', pending: 'warning' }
const statusBadgeIcon: Record<string, string> = { paid: 'i-lucide-circle-check', pending: 'i-lucide-clock' }

function onDateFromUpdate(v: string | undefined) {
  emit('update:dateFrom', v ?? '')
}

function onDateToUpdate(v: string | undefined) {
  emit('update:dateTo', v ?? '')
}

const columns = [
  { accessorKey: 'description', header: 'Lançamento', enableSorting: false, meta: { class: { th: 'w-[56%]', td: 'w-[56%]' } } },
  { id: 'status_col', header: 'Status', enableSorting: false, meta: { class: { th: 'w-32', td: 'w-32' } } },
  { id: 'amount_col', header: 'Valor', enableSorting: false, meta: { class: { th: 'w-36 text-right', td: 'w-36 text-right whitespace-nowrap' } } },
  { id: 'actions', header: '', enableSorting: false, meta: { class: { th: 'w-40', td: 'w-40' } } }
]
</script>

<template>
  <UModal
    :open="open"
    :ui="{
      overlay: 'z-10 bg-default/92 backdrop-blur-sm',
      content: 'z-20 sm:max-h-[100dvh] max-h-[100dvh] m-0 max-w-none w-screen h-dvh rounded-none flex flex-col overflow-hidden',
      header: 'px-4 py-3 border-b border-default shrink-0',
      body: 'flex-1 min-h-0 overflow-hidden p-4'
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #header>
      <div class="flex items-center justify-between w-full">
        <p class="text-base font-semibold text-highlighted">
          Financeiro
        </p>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          square
          @click="emit('update:open', false)"
        />
      </div>
    </template>

    <template #body>
      <AppDataTableInfinite
        :search-term="search"
        :row-selection="rowSelection"
        :columns="columns"
        :data="data as Record<string, unknown>[]"
        :loading="loading"
        :loading-more="loadingMore"
        :has-more="hasMore"
        :total="total"
        :selectable="true"
        :get-row-id="(row) => String(row.id ?? '')"
        table-class="table-fixed min-w-[860px] w-full"
        max-height="calc(100dvh - 160px)"
        show-search
        search-placeholder="Buscar por descrição..."
        empty-icon="i-lucide-wallet-cards"
        empty-title="Nenhum lançamento encontrado"
        empty-description="Cadastre lançamentos ou ajuste os filtros para continuar."
        @update:search-term="emit('update:search', $event)"
        @update:row-selection="emit('update:rowSelection', $event)"
        @search-submit="emit('search-submit', $event)"
        @load-more="emit('load-more')"
      >
        <template #toolbar-right>
          <UTooltip
            v-if="canUpdate"
            :text="pendingSelectedCount > 0 ? `Pagar ${pendingSelectedCount} selecionado(s)` : 'Selecione lançamentos pendentes'"
          >
            <UButton
              icon="i-lucide-check-circle"
              color="success"
              variant="outline"
              size="sm"
              :disabled="pendingSelectedCount === 0"
              @click="emit('bulk-pay')"
            />
          </UTooltip>

          <UTooltip
            v-if="canDelete"
            :text="selectedCount > 0 ? `Excluir ${selectedCount} selecionado(s)` : 'Selecione lançamentos para excluir'"
          >
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="outline"
              size="sm"
              :disabled="selectedCount === 0"
              @click="emit('bulk-delete')"
            />
          </UTooltip>

          <UTooltip text="Exportar lançamentos">
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

          <UButton
            v-if="canCreate"
            label="Novo lançamento"
            icon="i-lucide-plus"
            size="sm"
            @click="emit('open-create')"
          />
        </template>

        <template #filters>
          <FinancialEntriesFilters
            :date-from="dateFrom"
            :date-to="dateTo"
            :type-filters="typeFilters"
            :status-filters="statusFilters"
            :category-filter="categoryFilter"
            :categories="uniqueCategories"
            @update:date-from="onDateFromUpdate"
            @update:date-to="onDateToUpdate"
            @update:type-filters="emit('update:typeFilters', $event)"
            @update:status-filters="emit('update:statusFilters', $event)"
            @update:category-filter="emit('update:categoryFilter', $event)"
          />
        </template>

        <template #description-cell="{ row }">
          <div class="flex items-center gap-3">
            <UTooltip :text="typeBadgeLabel[String(row.original.type)] ?? String(row.original.type || '—')">
              <div
                class="flex size-8 shrink-0 cursor-default items-center justify-center rounded-full"
                :class="row.original.type === 'income' ? 'bg-success/10' : 'bg-error/10'"
              >
                <UIcon
                  :name="row.original.type === 'income' ? 'i-lucide-trending-up' : 'i-lucide-trending-down'"
                  class="size-4"
                  :class="row.original.type === 'income' ? 'text-success' : 'text-error'"
                />
              </div>
            </UTooltip>
            <div class="min-w-0 space-y-0.5">
              <div class="flex items-center gap-1.5">
                <p class="truncate font-semibold text-highlighted">
                  {{ row.original.description }}
                </p>
                <UBadge
                  v-if="(row.original as Entry).is_installment && (row.original as Entry).current_installment && (row.original as Entry).installment_count"
                  variant="outline"
                  color="info"
                  size="xs"
                  :label="`${(row.original as Entry).current_installment}/${(row.original as Entry).installment_count}x`"
                />
              </div>
              <p class="truncate text-xs text-muted">
                {{ formatDate(String((row.original as Entry).due_date || '')) }}
                <span class="mx-1 opacity-40">·</span>
                {{ getBankAccountLabel(row.original as Entry) ?? '—' }}
              </p>
            </div>
          </div>
        </template>

        <template #status_col-cell="{ row }">
          <UBadge
            :color="statusBadgeColor[normalizeStatusValue((row.original as Entry).status)] ?? 'neutral'"
            variant="subtle"
            :icon="statusBadgeIcon[normalizeStatusValue((row.original as Entry).status)]"
            :label="formatStatusLabel((row.original as Entry).status)"
            size="sm"
          />
        </template>

        <template #amount_col-cell="{ row }">
          <span
            class="block w-full text-right text-sm font-semibold tabular-nums"
            :class="row.original.type === 'income' ? 'text-success' : 'text-error'"
          >
            {{ formatCurrency(row.original.amount as string | number) }}
          </span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex items-center justify-end gap-2">
            <UTooltip text="Ver detalhes">
              <UButton
                icon="i-lucide-eye"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="emit('open-detail', row.original as Entry)"
              />
            </UTooltip>

            <UTooltip
              v-if="canUpdate && !isPaidStatus((row.original as Entry).status)"
              text="Marcar como pago"
            >
              <UButton
                icon="i-lucide-check-circle"
                color="success"
                variant="ghost"
                size="xs"
                :loading="isPaying && payingEntryId === String((row.original as Entry).id)"
                @click="emit('pay', row.original as Entry)"
              />
            </UTooltip>

            <UTooltip v-if="canCreate" text="Duplicar lançamento">
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="ghost"
                size="xs"
                :loading="isDuplicating && duplicatingEntryId === String((row.original as Entry).id)"
                @click="emit('duplicate', row.original as Entry)"
              />
            </UTooltip>

            <UTooltip v-if="canUpdate" text="Editar lançamento">
              <UButton
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="emit('open-edit', row.original as Entry)"
              />
            </UTooltip>

            <UTooltip v-if="canDelete" text="Excluir lançamento">
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                :loading="isDeleting && entryPendingDeletionId === String((row.original as Entry).id)"
                @click="emit('remove', row.original as Entry)"
              />
            </UTooltip>
          </div>
        </template>

        <template #end-of-list>
          Todos os {{ total }} registro(s) foram carregados
        </template>
      </AppDataTableInfinite>
    </template>
  </UModal>
</template>
