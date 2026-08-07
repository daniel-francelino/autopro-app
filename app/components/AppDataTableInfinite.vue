<script setup lang="ts">
import { computed, ref, h, resolveComponent, useSlots, watch } from 'vue'
import {
  FlexRender,
  getCoreRowModel,
  getSortedRowModel,
  useVueTable,
  type ColumnDef,
  type HeaderContext,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Updater
} from '@tanstack/vue-table'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useIntersectionObserver } from '@vueuse/core'

type TableRowData = Record<string, unknown>
type DataTableColumn = ColumnDef<TableRowData, unknown>

const props = withDefaults(defineProps<{
  columns: DataTableColumn[]
  data: TableRowData[]
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  total?: number
  estimatedRowHeight?: number
  overscan?: number
  manualSorting?: boolean
  sorting?: SortingState
  rowSelection?: RowSelectionState
  selectable?: boolean
  getRowId?: (originalRow: TableRowData, index: number, parent?: Row<TableRowData>) => string
  searchTerm?: string
  searchPlaceholder?: string
  showSearch?: boolean
  emptyIcon?: string
  emptyTitle?: string
  emptyDescription?: string
  loadingRows?: number
  rowSkeletonClass?: string
  actionsColumnKey?: string
  maxHeight?: string
  tableClass?: string
}>(), {
  loading: false,
  loadingMore: false,
  hasMore: false,
  total: 0,
  estimatedRowHeight: 52,
  overscan: 5,
  manualSorting: true,
  sorting: () => [],
  rowSelection: () => ({}),
  selectable: false,
  searchTerm: '',
  searchPlaceholder: 'Buscar...',
  showSearch: false,
  emptyIcon: 'i-lucide-inbox',
  emptyTitle: 'Nada por aqui ainda',
  emptyDescription: 'Quando houver registros para exibir, eles aparecerao nesta tabela.',
  loadingRows: 8,
  rowSkeletonClass: 'h-12 w-full rounded-xl',
  actionsColumnKey: 'actions',
  maxHeight: '65vh',
  tableClass: ''
})

const emit = defineEmits<{
  'load-more': []
  'update:searchTerm': [value: string]
  'update:sorting': [value: SortingState]
  'update:rowSelection': [value: RowSelectionState]
  'search-change': [value: string]
  'search-submit': [value: string]
  'sorting-change': [value: SortingState]
  'row-selection-change': [value: RowSelectionState]
}>()

const slots = useSlots()
const UIcon = resolveComponent('UIcon')
const UCheckbox = resolveComponent('UCheckbox')

// Internal table state (synced from props via watchers)
const tableSorting = ref<SortingState>(props.sorting)
const tableRowSelection = ref<RowSelectionState>(props.rowSelection)
const internalSearchTerm = ref(props.searchTerm)

watch(() => props.sorting, (v) => { tableSorting.value = v }, { deep: true })
watch(() => props.rowSelection, (v) => { tableRowSelection.value = v }, { deep: true })
watch(() => props.searchTerm, (v) => { internalSearchTerm.value = v })

const currentSearchTerm = computed({
  get: () => props.searchTerm ?? internalSearchTerm.value,
  set: (value) => {
    internalSearchTerm.value = value
    emit('update:searchTerm', value)
    emit('search-change', value)
  }
})

// ─── Column utilities ─────────────────────────────────────────────────────────

function submitSearch() {
  const value = currentSearchTerm.value
  internalSearchTerm.value = value
  emit('update:searchTerm', value)
  emit('search-change', value)
  emit('search-submit', value)
}

function joinClasses(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(' ')
}

function formatColumnLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase())
}

function getColumnKey(column: DataTableColumn): string | undefined {
  if (typeof column.id === 'string') return column.id
  if (typeof (column as any).accessorKey === 'string') return (column as any).accessorKey
  return undefined
}

function isActionsColumn(column: DataTableColumn) {
  return getColumnKey(column) === props.actionsColumnKey
}

function resolveHeaderContent(
  header: DataTableColumn['header'],
  context: HeaderContext<TableRowData, unknown>,
  fallback: string
) {
  if (typeof header === 'function') return header(context)
  if (typeof header === 'string') return header
  return fallback
}

function createSortableHeader(header: DataTableColumn['header'], fallback: string) {
  return (ctx: HeaderContext<TableRowData, unknown>) => {
    const sorted = ctx.column.getIsSorted()
    const icon = sorted === 'asc'
      ? 'i-lucide-arrow-up'
      : sorted === 'desc'
        ? 'i-lucide-arrow-down'
        : 'i-lucide-arrow-up-down'

    return h('button', {
      type: 'button',
      class: 'group inline-flex w-full items-center gap-2 rounded-md text-left font-semibold text-highlighted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
      onClick: ctx.column.getToggleSortingHandler()
    }, [
      h('span', { class: 'truncate' }, resolveHeaderContent(header, ctx, fallback) as never),
      h(UIcon as never, {
        name: icon,
        class: joinClasses(
          'h-4 w-4 shrink-0 transition-all duration-150',
          sorted
            ? 'text-primary opacity-100'
            : 'text-muted opacity-35 group-hover:text-highlighted group-hover:opacity-70'
        )
      })
    ])
  }
}

function createSelectionColumn(): DataTableColumn {
  return {
    id: '__select',
    enableSorting: false,
    enableHiding: false,
    header: ({ table: t }) =>
      h('div', { class: 'flex items-center justify-center' }, [
        h(UCheckbox as never, {
          'modelValue': t.getIsAllPageRowsSelected()
            ? true
            : t.getIsSomePageRowsSelected()
              ? 'indeterminate'
              : false,
          'onUpdate:modelValue': (v: boolean | 'indeterminate') => t.toggleAllPageRowsSelected(v === true),
          'aria-label': 'Selecionar todas as linhas',
          'color': 'neutral',
          'size': 'sm'
        })
      ]),
    cell: ({ row }) =>
      h('div', { class: 'flex items-center justify-center' }, [
        h(UCheckbox as never, {
          'modelValue': row.getIsSelected(),
          'onUpdate:modelValue': (v: boolean | 'indeterminate') => row.toggleSelected(v === true),
          'aria-label': `Selecionar linha ${row.id}`,
          'color': 'neutral',
          'size': 'sm'
        })
      ]),
    meta: {
      class: { th: 'w-12 min-w-12 text-center', td: 'w-12 min-w-12 text-center' }
    }
  }
}

function normalizeColumn(column: DataTableColumn): DataTableColumn {
  const key = getColumnKey(column)
  const fallback = formatColumnLabel(key ?? 'Coluna')
  const actionsCol = isActionsColumn(column)
  const sortable = typeof column.enableSorting === 'boolean'
    ? column.enableSorting
    : Boolean(typeof (column as any).accessorKey === 'string' && !actionsCol)

  const meta = (column.meta ?? {}) as { class?: { th?: string, td?: string } }

  return {
    ...column,
    enableSorting: sortable,
    header: sortable ? createSortableHeader(column.header, fallback) : (column.header ?? fallback),
    cell: column.cell ?? ((ctx: { getValue: () => unknown }) => {
      const v = ctx.getValue()
      return v === null || v === undefined ? '' : String(v)
    }),
    meta: {
      ...meta,
      class: {
        th: joinClasses(meta.class?.th, actionsCol && 'text-right', sortable && 'cursor-pointer') || undefined,
        td: joinClasses(meta.class?.td, actionsCol && 'text-right whitespace-nowrap') || undefined
      }
    }
  } as DataTableColumn
}

const normalizedColumns = computed<DataTableColumn[]>(() => {
  const normalized = props.columns.map(normalizeColumn)
  const actionColumns = normalized.filter(isActionsColumn)
  const regularColumns = normalized.filter(c => !isActionsColumn(c))
  return [
    ...(props.selectable ? [createSelectionColumn()] : []),
    ...regularColumns,
    ...actionColumns
  ]
})

// ─── TanStack Table instance ──────────────────────────────────────────────────

function applyUpdater<T>(updater: Updater<T>, current: T): T {
  return typeof updater === 'function' ? (updater as (prev: T) => T)(current) : updater
}

const table = useVueTable({
  get data() { return props.data },
  get columns() { return normalizedColumns.value },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  get manualSorting() { return props.manualSorting },
  get enableRowSelection() { return props.selectable },
  state: {
    get sorting() { return tableSorting.value },
    get rowSelection() { return tableRowSelection.value }
  },
  onSortingChange(updater) {
    const next = applyUpdater(updater, tableSorting.value)
    tableSorting.value = next
    emit('update:sorting', next)
    emit('sorting-change', next)
  },
  onRowSelectionChange(updater) {
    const next = applyUpdater(updater, tableRowSelection.value)
    tableRowSelection.value = next
    emit('update:rowSelection', next)
    emit('row-selection-change', next)
  },
  get getRowId() {
    return props.getRowId
      ? (row: TableRowData, index: number, parent?: Row<TableRowData>) => props.getRowId!(row, index, parent)
      : undefined
  }
})

// ─── Virtualizer ─────────────────────────────────────────────────────────────

const scrollContainerRef = ref<HTMLDivElement | null>(null)
const rows = computed(() => table.getRowModel().rows)

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scrollContainerRef.value,
    estimateSize: () => props.estimatedRowHeight,
    overscan: props.overscan,
    getItemKey: (index: number) => rows.value[index]?.id ?? index
  }))
)

// Reports each row's real rendered height back to the virtualizer (via
// ResizeObserver) instead of trusting the fixed estimateSize — table rows
// vary in height (badges, wrapped text), and without this the spacer rows
// misjudge the offsets and rows visibly jump/shake while scrolling.
function measureRow(el: unknown) {
  if (el instanceof HTMLElement) virtualizer.value.measureElement(el)
}

const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalVirtualSize = computed(() => virtualizer.value.getTotalSize())

const paddingTop = computed(() =>
  virtualRows.value.length > 0 ? virtualRows.value[0]!.start : 0
)
const paddingBottom = computed(() =>
  virtualRows.value.length > 0
    ? totalVirtualSize.value - virtualRows.value[virtualRows.value.length - 1]!.end
    : 0
)

// ─── Infinite scroll sentinel ─────────────────────────────────────────────────

const sentinelRef = ref<HTMLDivElement | null>(null)

useIntersectionObserver(
  sentinelRef,
  ([entry]) => {
    if (entry?.isIntersecting && props.hasMore && !props.loading && !props.loadingMore) {
      emit('load-more')
    }
  },
  { threshold: 0.1 }
)

// ─── Helpers ─────────────────────────────────────────────────────────────────

const hasItems = computed(() => props.data.length > 0)
const totalItems = computed(() => props.total > 0 ? props.total : props.data.length)
const hasToolbar = computed(() =>
  props.showSearch || Boolean(slots.filters) || Boolean(slots['toolbar-right'])
)
const colSpan = computed(() => normalizedColumns.value.length)

function getThClass(header: ReturnType<typeof table.getHeaderGroups>[0]['headers'][0]) {
  const meta = (header.column.columnDef.meta as any)?.class?.th
  return typeof meta === 'function' ? meta(header.getContext()) : (meta ?? '')
}

function getTdClass(cell: ReturnType<typeof rows.value[0]['getVisibleCells']>[0]) {
  const meta = (cell.column.columnDef.meta as any)?.class?.td
  return typeof meta === 'function' ? meta(cell.getContext()) : (meta ?? '')
}
</script>

<template>
  <div class="flex flex-col overflow-hidden rounded-[1.25rem] border border-default/90 bg-default shadow-sm">
    <!-- Toolbar -->
    <div
      v-if="hasToolbar"
      class="shrink-0 border-b border-default/90 bg-elevated/25 px-4 py-3"
    >
      <div class="flex flex-wrap items-center gap-3">
        <UInput
          v-if="showSearch"
          v-model="currentSearchTerm"
          :placeholder="searchPlaceholder"
          icon="i-lucide-search"
          class="w-full sm:w-80"
          @keydown.enter.prevent="submitSearch"
        />
        <slot name="filters" />
        <div
          v-if="$slots['toolbar-right']"
          class="ml-auto flex items-center gap-2"
        >
          <slot name="toolbar-right" />
        </div>
      </div>
    </div>

    <!-- Initial loading skeleton -->
    <div
      v-if="loading && !hasItems"
      class="space-y-3 p-4 md:p-5"
    >
      <slot name="loading">
        <USkeleton
          v-for="i in loadingRows"
          :key="i"
          :class="rowSkeletonClass"
        />
      </slot>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!loading && !hasItems"
      class="flex flex-col"
    >
      <slot name="empty">
        <div class="flex min-h-48 items-center justify-center bg-gradient-to-b from-default to-elevated/20 p-10 text-center">
          <div class="max-w-sm space-y-3">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-default/80 bg-elevated/60 text-primary">
              <UIcon :name="emptyIcon" class="h-5 w-5" />
            </div>
            <div class="space-y-1.5">
              <p class="text-sm font-semibold text-highlighted">
                {{ emptyTitle }}
              </p>
              <p class="text-sm text-muted">
                {{ emptyDescription }}
              </p>
            </div>
          </div>
        </div>
      </slot>
    </div>

    <!-- Card list mode -->
    <div
      v-else-if="$slots['card-list']"
      class="overflow-auto"
      :style="{ maxHeight }"
    >
      <slot name="card-list" />

      <!-- Infinite scroll sentinel + load-more feedback -->
      <div ref="sentinelRef" class="px-4 py-3">
        <div
          v-if="loadingMore"
          class="space-y-3"
        >
          <slot name="loading-more">
            <USkeleton
              v-for="i in 3"
              :key="i"
              :class="rowSkeletonClass"
            />
          </slot>
        </div>
        <div
          v-else-if="!hasMore && hasItems"
          class="py-2 text-center text-xs text-muted"
        >
          <slot name="end-of-list">
            Todos os {{ totalItems }} registro(s) foram carregados
          </slot>
        </div>
      </div>
    </div>

    <!-- Virtualized table -->
    <div
      v-else
      ref="scrollContainerRef"
      class="overflow-auto"
      :style="{ maxHeight }"
    >
      <table
        class="min-w-full border-separate border-spacing-0"
        :class="tableClass"
      >
        <!-- Sticky header -->
        <thead class="sticky top-0 inset-x-0 z-10 bg-default/96 backdrop-blur supports-[backdrop-filter]:bg-default/90">
          <tr
            v-for="headerGroup in table.getHeaderGroups()"
            :key="headerGroup.id"
          >
            <th
              v-for="header in headerGroup.headers"
              :key="header.id"
              :colspan="header.colSpan"
              class="border-b border-default/70 bg-default/96 px-4 py-3 text-xs font-semibold tracking-[0.02em] text-highlighted align-middle"
              :class="getThClass(header)"
            >
              <template v-if="$slots[`${header.column.id}-header`]">
                <slot :name="`${header.column.id}-header`" :header="header" :column="header.column" />
              </template>
              <FlexRender
                v-else-if="!header.isPlaceholder"
                :render="header.column.columnDef.header"
                :props="header.getContext()"
              />
            </th>
          </tr>
        </thead>

        <!-- Virtualized rows -->
        <tbody class="divide-y divide-default/70">
          <!-- Top spacer -->
          <tr
            v-if="paddingTop > 0"
            aria-hidden="true"
          >
            <td
              :colspan="colSpan"
              :style="{ height: `${paddingTop}px` }"
              class="p-0 border-none"
            />
          </tr>

          <tr
            v-for="virtualRow in virtualRows"
            :key="String(virtualRow.key)"
            :ref="measureRow"
            :data-index="virtualRow.index"
            class="transition-colors duration-150 hover:bg-elevated/40"
          >
            <td
              v-for="cell in rows[virtualRow.index]!.getVisibleCells()"
              :key="cell.id"
              class="border-b border-default/60 px-4 py-3.5 text-sm text-muted align-middle"
              :class="getTdClass(cell)"
            >
              <template v-if="$slots[`${cell.column.id}-cell`]">
                <slot :name="`${cell.column.id}-cell`" :row="rows[virtualRow.index]!" :cell="cell" />
              </template>
              <FlexRender
                v-else
                :render="cell.column.columnDef.cell"
                :props="cell.getContext()"
              />
            </td>
          </tr>

          <!-- Bottom spacer -->
          <tr
            v-if="paddingBottom > 0"
            aria-hidden="true"
          >
            <td
              :colspan="colSpan"
              :style="{ height: `${paddingBottom}px` }"
              class="p-0 border-none"
            />
          </tr>
        </tbody>
      </table>

      <!-- Infinite scroll sentinel + load-more feedback -->
      <div ref="sentinelRef" class="px-4 py-3">
        <div
          v-if="loadingMore"
          class="space-y-3"
        >
          <slot name="loading-more">
            <USkeleton
              v-for="i in 3"
              :key="i"
              :class="rowSkeletonClass"
            />
          </slot>
        </div>
        <div
          v-else-if="!hasMore && hasItems"
          class="py-2 text-center text-xs text-muted"
        >
          <slot name="end-of-list">
            Todos os {{ totalItems }} registro(s) foram carregados
          </slot>
        </div>
      </div>
    </div>
  </div>
</template>
