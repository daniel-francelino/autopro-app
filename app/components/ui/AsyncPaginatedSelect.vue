<script setup lang="ts" generic="T extends Record<string, any>">
/**
 * Searchable select with infinite scroll.
 *
 * Two modes:
 * - Remote: pass `fetch-url` (+ optional `query-params`) to page results from
 *   an API that returns `{ items, total }`. Search/pagination happen server-side.
 * - Local: pass `items` with the full list already loaded. Search and
 *   "infinite scroll" happen client-side (accent-insensitive).
 */

interface Props {
  modelValue: string
  items?: T[]
  fetchUrl?: string
  queryParams?: Record<string, unknown>
  pageSize?: number
  getId?: (item: T) => string
  getLabel: (item: T) => string
  getSublabel?: (item: T) => string | null | undefined
  selectedLabel?: string | null
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  icon?: string
  itemIcon?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  items: undefined,
  fetchUrl: undefined,
  queryParams: undefined,
  pageSize: 30,
  getId: undefined,
  getSublabel: undefined,
  selectedLabel: null,
  placeholder: 'Selecionar...',
  searchPlaceholder: 'Buscar...',
  emptyMessage: 'Nenhum resultado encontrado',
  icon: 'i-lucide-search',
  itemIcon: 'i-lucide-circle',
  disabled: false
})

const emit = defineEmits<{
  'update:modelValue': [v: string]
  'select': [item: T]
  'clear': []
}>()

const isRemote = computed(() => !!props.fetchUrl)

function normalizeText(value: unknown) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function resolveId(item: T): string {
  return props.getId ? props.getId(item) : String(item?.id ?? '')
}

const search = ref('')
const open = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

// ─── Remote mode state ─────────────────────────────────────────────────────

const remoteItems = ref<T[]>([])
const currentPage = ref(1)
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)

const remoteHasMore = computed(() => remoteItems.value.length < total.value)

async function fetchPage(reset = false) {
  if (!props.fetchUrl) return
  if (reset) {
    currentPage.value = 1
    remoteItems.value = []
    loading.value = true
  } else {
    loadingMore.value = true
  }
  try {
    const res = await $fetch<{ items: T[], total: number }>(props.fetchUrl, {
      query: {
        search: search.value.trim() || undefined,
        page: currentPage.value,
        page_size: props.pageSize,
        ...(props.queryParams || {})
      }
    })
    if (reset) {
      remoteItems.value = res.items ?? []
    } else {
      remoteItems.value.push(...(res.items ?? []))
    }
    total.value = res.total ?? 0
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

// ─── Local mode state ──────────────────────────────────────────────────────

const visibleCount = ref(props.pageSize)

const localFilteredItems = computed(() => {
  const list = props.items ?? []
  const term = normalizeText(search.value)
  if (!term) return list
  return list.filter((item) => {
    const label = normalizeText(props.getLabel(item))
    if (label.includes(term)) return true
    const sublabel = props.getSublabel ? normalizeText(props.getSublabel(item)) : ''
    return !!sublabel && sublabel.includes(term)
  })
})

const localVisibleItems = computed(() => localFilteredItems.value.slice(0, visibleCount.value))
const localHasMore = computed(() => visibleCount.value < localFilteredItems.value.length)

// ─── Shared view ────────────────────────────────────────────────────────────

const displayItems = computed(() => (isRemote.value ? remoteItems.value : localVisibleItems.value))
const displayTotal = computed(() => (isRemote.value ? total.value : localFilteredItems.value.length))
const hasMore = computed(() => (isRemote.value ? remoteHasMore.value : localHasMore.value))
const isLoading = computed(() => (isRemote.value ? loading.value : false))
const isLoadingMore = computed(() => (isRemote.value ? loadingMore.value : false))

const currentItem = computed(() => {
  if (!props.modelValue) return null
  const pool = isRemote.value ? remoteItems.value : (props.items ?? [])
  return pool.find(item => resolveId(item) === props.modelValue) ?? null
})

const currentLabel = computed(() => {
  if (currentItem.value) return props.getLabel(currentItem.value)
  return props.selectedLabel ?? null
})

let searchTimer: ReturnType<typeof setTimeout> | null = null

watch(search, () => {
  if (!isRemote.value) return
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => fetchPage(true), 300)
})

watch(open, async (isOpen) => {
  if (isOpen) {
    if (isRemote.value) {
      await fetchPage(true)
    } else {
      visibleCount.value = props.pageSize
    }
    await nextTick()
    inputRef.value?.focus()
  } else {
    search.value = ''
    if (isRemote.value) {
      remoteItems.value = []
      total.value = 0
      currentPage.value = 1
    } else {
      visibleCount.value = props.pageSize
    }
  }
})

watch(
  () => JSON.stringify(props.queryParams ?? {}),
  () => {
    if (!isRemote.value) return
    remoteItems.value = []
    total.value = 0
    currentPage.value = 1
    if (open.value) fetchPage(true)
  }
)

function onListScroll(e: Event) {
  if (!hasMore.value || isLoadingMore.value || isLoading.value) return
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
    if (isRemote.value) {
      currentPage.value++
      fetchPage(false)
    } else {
      visibleCount.value += props.pageSize
    }
  }
}

function selectItem(item: T) {
  const id = resolveId(item)
  if (id === props.modelValue) {
    emit('update:modelValue', '')
    emit('clear')
  } else {
    emit('update:modelValue', id)
    emit('select', item)
  }
  open.value = false
  search.value = ''
}
</script>

<template>
  <div class="flex items-center gap-2">
    <UPopover
      v-model:open="open"
      :content="{ align: 'start', side: 'bottom', sideOffset: 4 }"
      :ui="{
        content: 'z-[260] w-[var(--reka-popover-trigger-width)] min-w-72 rounded-xl border border-default bg-default p-0 shadow-xl overflow-hidden'
      }"
      :modal="true"
      :disabled="disabled"
      class="min-w-0 flex-1"
    >
      <button
        type="button"
        :disabled="disabled"
        class="flex h-9 w-full items-center gap-2 rounded-md border border-default bg-default px-3 text-left text-sm transition hover:bg-elevated/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <UIcon :name="icon" class="size-4 shrink-0 text-dimmed" />
        <span class="flex-1 truncate" :class="currentLabel ? 'text-highlighted' : 'text-dimmed'">
          {{ currentLabel || placeholder }}
        </span>
        <UIcon
          name="i-lucide-chevron-down"
          class="size-4 shrink-0 text-dimmed transition-transform"
          :class="open ? 'rotate-180' : ''"
        />
      </button>

      <template #content>
        <div class="flex flex-col">
          <div class="border-b border-default p-2">
            <div class="flex items-center gap-2 rounded-lg border border-primary bg-default px-3 py-2">
              <UIcon name="i-lucide-search" class="size-4 shrink-0 text-primary" />
              <input
                ref="inputRef"
                v-model="search"
                type="text"
                :placeholder="searchPlaceholder"
                class="min-w-0 flex-1 bg-transparent text-sm text-highlighted outline-none placeholder:text-dimmed"
              >
              <UIcon v-if="isLoading" name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin text-dimmed" />
            </div>
          </div>

          <div class="max-h-72 overflow-y-auto" @scroll="onListScroll">
            <div v-if="isLoading && !displayItems.length" class="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted">
              <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
              Carregando...
            </div>

            <div
              v-else-if="!isLoading && !displayItems.length"
              class="px-4 py-8 text-center text-sm text-muted"
            >
              {{ emptyMessage }}
            </div>

            <template v-else>
              <button
                v-for="item in displayItems"
                :key="resolveId(item)"
                type="button"
                class="flex w-full items-center gap-3 border-b border-default/60 px-4 py-3 text-left transition last:border-b-0 hover:bg-elevated/60"
                :class="resolveId(item) === modelValue ? 'bg-primary/5' : ''"
                @click="selectItem(item)"
              >
                <div class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <UIcon :name="itemIcon" class="size-4 text-primary" />
                </div>

                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-highlighted">
                    {{ getLabel(item) }}
                  </p>
                  <p v-if="getSublabel?.(item)" class="mt-0.5 truncate text-xs text-muted">
                    {{ getSublabel(item) }}
                  </p>
                </div>

                <UIcon
                  v-if="resolveId(item) === modelValue"
                  name="i-lucide-check"
                  class="size-4 shrink-0 text-primary"
                />
              </button>

              <div v-if="isLoadingMore" class="flex items-center justify-center gap-2 py-3 text-xs text-muted">
                <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
                Carregando mais...
              </div>

              <div v-else-if="!hasMore && displayItems.length" class="py-2 text-center text-xs text-muted">
                {{ displayItems.length }} de {{ displayTotal }}
              </div>
            </template>
          </div>
        </div>
      </template>
    </UPopover>
  </div>
</template>
