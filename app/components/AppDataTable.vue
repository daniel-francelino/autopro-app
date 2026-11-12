<script setup lang="ts">
import { computed, h, onMounted, ref, resolveComponent, useSlots, watch } from 'vue'
import type { Cell, ColumnDef, Header, HeaderContext, Row, RowSelectionState, SortingState } from '@tanstack/vue-table'

type TableRowData = Record<string, unknown>
type DataTableColumn = ColumnDef<TableRowData, unknown>
// ColumnDef e uma uniao: accessorKey/accessorFn so existem em parte das variantes
type AccessorFields = {
  accessorKey?: string
  accessorFn?: (row: TableRowData, index: number) => unknown
}
const withAccessors = (column: DataTableColumn) => column as unknown as AccessorFields
type DisplayMode = 'table' | 'card'

const props = withDefaults(defineProps<{
  columns: DataTableColumn[]
  data: TableRowData[]
  displayMode?: DisplayMode
  searchTerm?: string
  loading?: boolean
  loadingRows?: number
  loadingVariant?: 'row' | 'card'
  page?: number
  pageSize?: number
  pageSizeOptions?: number[]
  total?: number
  emptyIcon?: string
  emptyTitle?: string
  emptyDescription?: string
  tableClass?: string
  selectable?: boolean
  stickyHeader?: boolean
  showFooter?: boolean
  showPageSizeSelector?: boolean
  actionsColumnKey?: string
  sorting?: SortingState
  rowSelection?: RowSelectionState
  getRowId?: (originalRow: TableRowData, index: number, parent?: Row<TableRowData>) => string
  rowSkeletonClass?: string
  cardSkeletonCount?: number
  cardSkeletonClass?: string
  cardSkeletonGridClass?: string
  cardGridClass?: string
  searchPlaceholder?: string
  showSearch?: boolean
  showViewModeToggle?: boolean
}>(), {
  displayMode: 'table',
  searchTerm: '',
  loading: false,
  loadingRows: 8,
  loadingVariant: 'row',
  page: 1,
  pageSize: 20,
  pageSizeOptions: () => [10, 20, 50, 100],
  total: 0,
  emptyIcon: 'i-lucide-inbox',
  emptyTitle: 'Nada por aqui ainda',
  emptyDescription: 'Quando houver registros para exibir, eles aparecerao nesta tabela.',
  tableClass: 'min-h-0 flex-1',
  selectable: false,
  stickyHeader: true,
  showFooter: true,
  showPageSizeSelector: true,
  actionsColumnKey: 'actions',
  sorting: () => [],
  rowSelection: () => ({}),
  rowSkeletonClass: 'h-12 w-full rounded-xl',
  cardSkeletonCount: 6,
  cardSkeletonClass: 'h-44 w-full rounded-2xl',
  cardSkeletonGridClass: 'grid grid-cols-1 gap-4 p-4 xl:grid-cols-2',
  cardGridClass: 'grid grid-cols-1 gap-4 p-4 xl:grid-cols-2',
  searchPlaceholder: 'Buscar...',
  showSearch: false,
  showViewModeToggle: false
})

const emit = defineEmits<{
  'update:displayMode': [value: DisplayMode]
  'update:searchTerm': [value: string]
  'update:page': [value: number]
  'update:pageSize': [value: number]
  'update:sorting': [value: SortingState]
  'update:rowSelection': [value: RowSelectionState]
  'display-mode-change': [value: DisplayMode]
  'search-change': [value: string]
  'search-submit': [value: string]
  'page-change': [value: number]
  'page-size-change': [value: number]
  'sorting-change': [value: SortingState]
  'row-selection-change': [value: RowSelectionState]
}>()

const slots = useSlots()
const UCheckbox = resolveComponent('UCheckbox')
const UIcon = resolveComponent('UIcon')

const route = useRoute()
const viewModeStorageKey = computed(() => `datatable-view:${route.path}`)

const internalSorting = ref<SortingState>(props.sorting)
const internalRowSelection = ref<RowSelectionState>(props.rowSelection)
const internalDisplayMode = ref<DisplayMode>(props.displayMode)
const internalSearchTerm = ref(props.searchTerm)

onMounted(() => {
  if (!props.showViewModeToggle) return
  const saved = localStorage.getItem(viewModeStorageKey.value)
  if (saved === 'table' || saved === 'card') {
    internalDisplayMode.value = saved
    emit('update:displayMode', saved)
  }
})

const currentDisplayMode = computed({
  get: () => props.displayMode ?? internalDisplayMode.value,
  set: (value) => {
    internalDisplayMode.value = value
    emit('update:displayMode', value)
    emit('display-mode-change', value)
    if (props.showViewModeToggle) {
      localStorage.setItem(viewModeStorageKey.value, value)
    }
  }
})

const currentSearchTerm = computed({
  get: () => props.searchTerm ?? internalSearchTerm.value,
  set: (value) => {
    internalSearchTerm.value = value
    emit('update:searchTerm', value)
    emit('search-change', value)
  }
})

function submitSearch() {
  const value = currentSearchTerm.value
  internalSearchTerm.value = value
  emit('update:searchTerm', value)
  emit('search-change', value)
  emit('search-submit', value)
}

const currentPage = computed({
  get: () => props.page,
  set: (value) => {
    emit('update:page', value)
    emit('page-change', value)
  }
})

const currentPageSizeOption = computed({
  get: () => String(props.pageSize),
  set: (value: string) => {
    const nextPageSize = Number.parseInt(value, 10)
    if (!Number.isFinite(nextPageSize) || nextPageSize <= 0 || nextPageSize === props.pageSize)
      return

    emit('update:pageSize', nextPageSize)
    emit('page-size-change', nextPageSize)

    if (props.page !== 1) {
      emit('update:page', 1)
      emit('page-change', 1)
    }
  }
})

const currentSorting = computed({
  get: () => props.sorting ?? internalSorting.value,
  set: (value) => {
    internalSorting.value = value
    emit('update:sorting', value)
    emit('sorting-change', value)
  }
})

const currentRowSelection = computed({
  get: () => props.rowSelection ?? internalRowSelection.value,
  set: (value) => {
    internalRowSelection.value = value
    emit('update:rowSelection', value)
    emit('update:row-selection' as never, value)
    emit('row-selection-change', value)
  }
})

watch(() => props.sorting, (value) => {
  internalSorting.value = value
}, { deep: true })

watch(() => props.rowSelection, (value) => {
  internalRowSelection.value = value
}, { deep: true })

watch(() => props.displayMode, (value) => {
  internalDisplayMode.value = value
})

watch(() => props.searchTerm, (value) => {
  internalSearchTerm.value = value
})

const forwardedSlotNames = computed(() =>
  Object.keys(slots).filter(name => ![
    'card',
    'empty',
    'filters',
    'loading',
    'loading-card',
    'loading-row'
  ].includes(name))
)

const totalItems = computed(() => props.total > 0 ? props.total : props.data.length)
const hasItems = computed(() => props.data.length > 0)
const showPagination = computed(() => totalItems.value > props.pageSize)
const isCardMode = computed(() => currentDisplayMode.value === 'card')
const effectiveLoadingVariant = computed(() =>
  props.loadingVariant === 'card' || isCardMode.value ? 'card' : 'row'
)
const showCardLoading = computed(() => props.loading && effectiveLoadingVariant.value === 'card')
const hasToolbar = computed(() =>
  props.showSearch || props.showViewModeToggle || Boolean(slots.filters) || Boolean(slots['toolbar-right'])
)
const cardColumns = computed(() =>
  props.columns.filter(column => !isActionsColumn(column) && getColumnKey(column) !== '__select')
)
const primaryCardColumn = computed(() => cardColumns.value[0])
const secondaryCardColumn = computed(() => cardColumns.value[1])
const additionalCardColumns = computed(() => cardColumns.value.slice(2))
const pageSizeSelectItems = computed(() =>
  props.pageSizeOptions.map(option => ({
    label: `${option} por página`,
    value: String(option)
  }))
)
const pageStart = computed(() => {
  if (!totalItems.value || !hasItems.value)
    return 0

  return (props.page - 1) * props.pageSize + 1
})
const pageEnd = computed(() => {
  if (!totalItems.value || !hasItems.value)
    return 0

  return Math.min(props.page * props.pageSize, totalItems.value)
})

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

function getColumnKey(column: DataTableColumn) {
  if (typeof column.id === 'string')
    return column.id

  const { accessorKey } = withAccessors(column)
  if (typeof accessorKey === 'string')
    return accessorKey

  return undefined
}

function getColumnLabel(column: DataTableColumn) {
  if (typeof column.header === 'string')
    return column.header

  return formatColumnLabel(getColumnKey(column) ?? 'Campo')
}

function isActionsColumn(column: DataTableColumn) {
  return getColumnKey(column) === props.actionsColumnKey
}

function getColumnValue(column: DataTableColumn, item: TableRowData, index: number) {
  const { accessorFn, accessorKey } = withAccessors(column)
  if (typeof accessorFn === 'function')
    return accessorFn(item, index)

  if (typeof accessorKey === 'string')
    return item[accessorKey]

  return undefined
}

function formatCardValue(value: unknown) {
  if (value === null || value === undefined || value === '')
    return '-'

  if (Array.isArray(value))
    return value.filter(Boolean).join(', ') || '-'

  if (typeof value === 'boolean')
    return value ? 'Sim' : 'Nao'

  return String(value)
}

function mergeMetaClass<TContext>(
  existing: string | ((context: TContext) => string) | undefined,
  extra: string
) {
  if (typeof existing === 'function')
    return (context: TContext) => joinClasses(existing(context), extra)

  return joinClasses(existing, extra)
}

function resolveHeaderContent(
  header: DataTableColumn['header'],
  context: HeaderContext<TableRowData, unknown>,
  fallbackLabel: string
) {
  if (typeof header === 'function')
    return header(context)

  if (typeof header === 'string')
    return header

  return fallbackLabel
}

function createSortableHeader(
  header: DataTableColumn['header'],
  fallbackLabel: string
) {
  return (context: HeaderContext<TableRowData, unknown>) => {
    const sorted = context.column.getIsSorted()
    const icon = sorted === 'asc'
      ? 'i-lucide-arrow-up'
      : sorted === 'desc'
        ? 'i-lucide-arrow-down'
        : 'i-lucide-arrow-up-down'

    return h(
      'button',
      {
        type: 'button',
        class: 'group inline-flex w-full items-center gap-2 rounded-md text-left font-semibold text-highlighted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        onClick: context.column.getToggleSortingHandler()
      },
      [
        h('span', { class: 'truncate' }, resolveHeaderContent(header, context, fallbackLabel) as never),
        h(UIcon as never, {
          name: icon,
          class: joinClasses(
            'h-4 w-4 shrink-0 transition-all duration-150',
            sorted
              ? 'text-primary opacity-100'
              : 'text-muted opacity-35 group-hover:text-highlighted group-hover:opacity-70'
          )
        })
      ]
    )
  }
}

function createSelectionColumn(): DataTableColumn {
  return {
    id: '__select',
    enableSorting: false,
    enableHiding: false,
    header: ({ table }) =>
      h('div', { class: 'flex items-center justify-center' }, [
        h(UCheckbox as never, {
          'modelValue': table.getIsAllPageRowsSelected()
            ? true
            : table.getIsSomePageRowsSelected()
              ? 'indeterminate'
              : false,
          'onUpdate:modelValue': (value: boolean | 'indeterminate') => table.toggleAllPageRowsSelected(value === true),
          'aria-label': 'Selecionar todas as linhas',
          'color': 'neutral',
          'size': 'sm'
        })
      ]),
    cell: ({ row }) =>
      h('div', { class: 'flex items-center justify-center' }, [
        h(UCheckbox as never, {
          'modelValue': row.getIsSelected(),
          'onUpdate:modelValue': (value: boolean | 'indeterminate') => row.toggleSelected(value === true),
          'aria-label': `Selecionar linha ${row.id}`,
          'color': 'neutral',
          'size': 'sm'
        })
      ]),
    meta: {
      class: {
        th: 'w-12 min-w-12 text-center',
        td: 'w-12 min-w-12 text-center'
      }
    }
  }
}

function normalizeColumn(column: DataTableColumn): DataTableColumn {
  const fallbackLabel = formatColumnLabel(getColumnKey(column) ?? 'Coluna')
  const sortable = typeof column.enableSorting === 'boolean'
    ? column.enableSorting
    : Boolean(typeof withAccessors(column).accessorKey === 'string' && !isActionsColumn(column))
  const actionsColumn = isActionsColumn(column)
  const meta = (column.meta ?? {}) as unknown as {
    class?: {
      th?: string | ((context: Header<TableRowData, unknown>) => string)
      td?: string | ((context: Cell<TableRowData, unknown>) => string)
    }
  }

  return {
    ...column,
    enableSorting: sortable,
    header: sortable ? createSortableHeader(column.header, fallbackLabel) : (column.header ?? fallbackLabel),
    meta: {
      ...meta,
      class: {
        ...meta.class,
        th: mergeMetaClass(
          meta.class?.th,
          joinClasses(actionsColumn && 'text-right', sortable && 'cursor-pointer')
        ),
        td: mergeMetaClass(
          meta.class?.td,
          joinClasses(actionsColumn && 'text-right whitespace-nowrap')
        )
      }
    }
  } as DataTableColumn
}

const normalizedColumns = computed<DataTableColumn[]>(() => {
  const normalized = props.columns.map(normalizeColumn)
  const actionColumns = normalized.filter(isActionsColumn)
  const regularColumns = normalized.filter(column => !isActionsColumn(column))

  return [
    ...(props.selectable ? [createSelectionColumn()] : []),
    ...regularColumns,
    ...actionColumns
  ]
})

const tableUi = {
  root: 'relative min-h-0',
  base: 'min-w-full border-separate border-spacing-0',
  thead: 'sticky top-0 inset-x-0 z-10 bg-default/96 backdrop-blur supports-[backdrop-filter]:bg-default/90',
  tbody: 'divide-y divide-default/70',
  tr: 'transition-colors duration-150 hover:bg-elevated/40',
  th: 'border-b border-default/70 bg-default/96 px-4 py-3 text-xs font-semibold tracking-[0.02em] text-highlighted align-middle',
  td: 'border-b border-default/60 px-4 py-3.5 text-sm text-muted align-middle',
  empty: 'py-0',
  loading: 'py-0'
} as const

const paginationUi = {
  root: 'w-full md:w-auto',
  list: 'flex items-center gap-1.5',
  item: '',
  prev: '',
  next: '',
  first: '',
  last: ''
} as const

const emptyHeaderTableClass = 'shrink-0'
</script>

<template>
  <div class="flex flex-col overflow-hidden rounded-[1.25rem] border border-default/90 bg-default shadow-sm">
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
          v-if="showViewModeToggle || $slots['toolbar-right']"
          class="ml-auto flex items-center gap-2"
        >
          <div v-if="showViewModeToggle" class="inline-flex">
            <UTooltip text="Visualização em lista">
              <UButton
                icon="i-lucide-list"
                color="neutral"
                class="rounded-r-none"
                :variant="currentDisplayMode === 'table' ? 'solid' : 'outline'"
                @click="currentDisplayMode = 'table'"
              />
            </UTooltip>
            <UTooltip text="Visualização em cards">
              <UButton
                icon="i-lucide-layout-grid"
                color="neutral"
                class="-ml-px rounded-l-none"
                :variant="currentDisplayMode === 'card' ? 'solid' : 'outline'"
                @click="currentDisplayMode = 'card'"
              />
            </UTooltip>
          </div>
          <template v-if="showViewModeToggle && $slots['toolbar-right']">
            <USeparator orientation="vertical" class="h-5" />
          </template>
          <slot name="toolbar-right" />
        </div>
      </div>
    </div>

    <div
      v-if="showCardLoading"
      class="overflow-auto max-h-[65vh]"
    >
      <slot name="loading-card">
        <div :class="cardSkeletonGridClass">
          <USkeleton
            v-for="index in cardSkeletonCount"
            :key="index"
            :class="cardSkeletonClass"
          />
        </div>
      </slot>
    </div>

    <div
      v-else
      class="flex flex-col overflow-hidden"
    >
      <div
        v-if="!loading && !hasItems"
        class="flex flex-col"
      >
        <UTable
          v-if="!isCardMode"
          :columns="normalizedColumns"
          :data="[]"
          :class="emptyHeaderTableClass"
          :sticky="stickyHeader ? 'header' : false"
          :get-row-id="getRowId"
          :ui="tableUi"
        >
          <template #empty>
            <div class="hidden" />
          </template>
        </UTable>

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

      <div
        v-else-if="isCardMode"
        class="overflow-auto max-h-[65vh]"
      >
        <div :class="cardGridClass">
          <template
            v-for="(item, index) in data"
            :key="getRowId ? getRowId(item, index) : index"
          >
            <slot
              name="card"
              :item="item"
              :index="index"
            >
              <UCard class="border border-default/80 shadow-sm">
                <div class="space-y-4">
                  <div class="space-y-1">
                    <p class="truncate text-base font-semibold text-highlighted">
                      {{ primaryCardColumn ? formatCardValue(getColumnValue(primaryCardColumn, item, index)) : `Registro ${index + 1}` }}
                    </p>
                    <p
                      v-if="secondaryCardColumn"
                      class="truncate text-sm text-muted"
                    >
                      {{ formatCardValue(getColumnValue(secondaryCardColumn, item, index)) }}
                    </p>
                  </div>

                  <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div
                      v-for="column in additionalCardColumns"
                      :key="getColumnKey(column) ?? getColumnLabel(column)"
                      class="space-y-1"
                    >
                      <dt class="text-xs font-medium uppercase tracking-[0.08em] text-muted">
                        {{ getColumnLabel(column) }}
                      </dt>
                      <dd class="text-sm text-toned">
                        {{ formatCardValue(getColumnValue(column, item, index)) }}
                      </dd>
                    </div>
                  </dl>
                </div>
              </UCard>
            </slot>
          </template>
        </div>
      </div>

      <div
        v-else
        class="overflow-auto max-h-[65vh]"
      >
        <div v-if="loading" class="space-y-3 p-4 md:p-5">
          <slot name="loading-row">
            <slot name="loading">
              <USkeleton
                v-for="index in loadingRows"
                :key="index"
                :class="rowSkeletonClass"
              />
            </slot>
          </slot>
        </div>
        <UTable
          v-else
          v-model:sorting="currentSorting"
          v-model:row-selection="currentRowSelection"
          :columns="normalizedColumns"
          :data="data"
          :class="tableClass"
          :sticky="stickyHeader ? 'header' : false"
          :get-row-id="getRowId"
          :row-selection-options="selectable ? { enableRowSelection: true } : undefined"
          :ui="tableUi"
        >
          <template
            v-for="slotName in forwardedSlotNames"
            :key="slotName"
            #[slotName]="slotProps"
          >
            <slot :name="slotName" v-bind="slotProps ?? {}" />
          </template>
        </UTable>
      </div>
    </div>

    <div
      v-if="showFooter && !showCardLoading"
      class="flex flex-col gap-3 border-t border-default/70 bg-elevated/15 px-4 py-3 md:flex-row md:items-center md:justify-between"
    >
      <div class="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span class="font-medium text-toned">
          {{ pageStart }}-{{ pageEnd }}
        </span>
        <span>de {{ totalItems }} registro(s)</span>
        <span class="hidden h-1 w-1 rounded-full bg-default md:block" />
        <USelectMenu
          v-if="showPageSizeSelector && pageSizeOptions.length > 1"
          v-model="currentPageSizeOption"
          :items="pageSizeSelectItems"
          value-key="value"
          class="w-[148px]"
          size="sm"
          color="neutral"
          variant="ghost"
          :search-input="false"
        />
        <span
          v-else
          class="text-xs uppercase tracking-[0.08em] text-muted"
        >
          {{ pageSize }} por página
        </span>
      </div>

      <UPagination
        v-if="showPagination"
        v-model:page="currentPage"
        :items-per-page="pageSize"
        :total="totalItems"
        :show-edges="false"
        :sibling-count="1"
        color="neutral"
        variant="ghost"
        active-color="neutral"
        active-variant="outline"
        size="sm"
        :ui="paginationUi"
      />
    </div>
  </div>
</template>
