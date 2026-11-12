<script setup lang="ts">
import type { MasterProductItem } from '~/types/service-orders'

defineProps<{
  modelValue: string
  selectedProduct: { name: string, description?: string | null } | null
}>()

const emit = defineEmits<{
  select: [product: MasterProductItem]
  clear: []
}>()

const PAGE_SIZE = 30

const search = ref('')
const open = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

const items = ref<MasterProductItem[]>([])
const currentPage = ref(1)
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)

const hasMore = computed(() => items.value.length < total.value)

async function fetchPage(reset = false) {
  if (reset) {
    currentPage.value = 1
    items.value = []
    loading.value = true
  } else {
    loadingMore.value = true
  }
  try {
    const res = await $fetch<{ items: MasterProductItem[], total: number }>('/api/master-products', {
      query: {
        search: search.value.trim() || undefined,
        page: currentPage.value,
        page_size: PAGE_SIZE
      }
    })
    if (reset) {
      items.value = res.items ?? []
    } else {
      items.value.push(...(res.items ?? []))
    }
    total.value = res.total ?? 0
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => fetchPage(true), 300)
})

watch(open, async (isOpen) => {
  if (isOpen) {
    await fetchPage(true)
    await nextTick()
    inputRef.value?.focus()
  } else {
    search.value = ''
    items.value = []
    total.value = 0
    currentPage.value = 1
  }
})

function onListScroll(e: Event) {
  if (!hasMore.value || loadingMore.value || loading.value) return
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
    currentPage.value++
    fetchPage(false)
  }
}

function selectProduct(product: MasterProductItem) {
  emit('select', product)
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
      class="min-w-0 flex-1"
    >
      <button
        type="button"
        class="flex h-9 w-full items-center gap-2 rounded-md border border-default bg-default px-3 text-left text-sm transition hover:bg-elevated/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <UIcon name="i-lucide-search" class="size-4 shrink-0 text-dimmed" />
        <span class="flex-1 truncate" :class="selectedProduct ? 'text-highlighted' : 'text-dimmed'">
          {{ selectedProduct ? selectedProduct.name : 'Buscar produto master...' }}
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
                placeholder="Buscar por nome ou descrição..."
                class="min-w-0 flex-1 bg-transparent text-sm text-highlighted outline-none placeholder:text-dimmed"
              >
              <UIcon v-if="loading" name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin text-dimmed" />
            </div>
          </div>

          <div class="max-h-72 overflow-y-auto" @scroll="onListScroll">
            <div v-if="loading && !items.length" class="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted">
              <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
              Carregando produtos...
            </div>

            <div
              v-else-if="!loading && !items.length"
              class="px-4 py-8 text-center text-sm text-muted"
            >
              Nenhum produto master encontrado
            </div>

            <template v-else>
              <button
                v-for="product in items"
                :key="product.id"
                type="button"
                class="flex w-full items-center gap-3 border-b border-default/60 px-4 py-3 text-left transition last:border-b-0 hover:bg-elevated/60"
                :class="product.id === modelValue ? 'bg-primary/5' : ''"
                @click="selectProduct(product)"
              >
                <div class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <UIcon name="i-lucide-box" class="size-4 text-primary" />
                </div>

                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-highlighted">
                    {{ product.name }}
                  </p>
                  <p v-if="product.description" class="mt-0.5 truncate text-xs text-muted">
                    {{ product.description }}
                  </p>
                </div>

                <UIcon
                  v-if="product.id === modelValue"
                  name="i-lucide-check"
                  class="size-4 shrink-0 text-primary"
                />
              </button>

              <div v-if="loadingMore" class="flex items-center justify-center gap-2 py-3 text-xs text-muted">
                <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
                Carregando mais...
              </div>

              <div v-else-if="!hasMore && items.length" class="py-2 text-center text-xs text-muted">
                {{ items.length }} de {{ total }} produto{{ total !== 1 ? 's' : '' }}
              </div>
            </template>
          </div>
        </div>
      </template>
    </UPopover>

    <UTooltip v-if="modelValue" text="Remover produto master">
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        @click="emit('clear')"
      />
    </UTooltip>
  </div>
</template>
