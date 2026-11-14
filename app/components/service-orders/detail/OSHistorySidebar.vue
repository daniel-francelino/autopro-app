<script setup lang="ts">
import { createReusableTemplate, useMediaQuery } from '@vueuse/core'
import type { OsHistoryCategory } from '~/types/service-order-history'
import { groupEventsByDay } from '~/utils/os-history-ui'

const props = defineProps<{
  open: boolean
  orderId: string | null
  /** Incrementa quando o detalhe da OS é recarregado; o histórico acompanha. */
  refreshKey: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const TOGGLE_BUTTON_ID = 'os-history-toggle'

// Corte do painel fixo: xl (1280px). Abaixo disso vira USlideover.
const isDesktop = useMediaQuery('(min-width: 1280px)')

const [DefineContent, ReuseContent] = createReusableTemplate()

const orderIdRef = computed(() => props.orderId)
const category = ref<OsHistoryCategory | 'all'>('all')
const history = useServiceOrderHistory(orderIdRef, category)

const groups = computed(() => groupEventsByDay(history.items.value))
const filtered = computed(() => category.value !== 'all')

let loadedKey: number | null = null

function ensureLoaded() {
  if (!props.open || !props.orderId) return
  if (history.status.value === 'idle') {
    loadedKey = props.refreshKey
    history.load()
  } else if (loadedKey !== props.refreshKey) {
    loadedKey = props.refreshKey
    history.refresh()
  }
}

watch(() => props.open, (open, wasOpen) => {
  if (open) {
    ensureLoaded()
    if (isDesktop.value) nextTick(() => document.getElementById('os-history-heading')?.focus())
  } else if (wasOpen) {
    nextTick(() => document.getElementById(TOGGLE_BUTTON_ID)?.focus())
  }
}, { immediate: true })

watch(() => props.refreshKey, ensureLoaded)

watch(() => props.orderId, () => {
  history.reset()
  category.value = 'all'
  loadedKey = null
  ensureLoaded()
})

watch(category, () => {
  history.reset()
  loadedKey = null
  ensureLoaded()
})

const announcement = computed(() => {
  if (history.status.value === 'error' || history.loadMoreError.value) return 'Não foi possível carregar o histórico.'
  if (history.status.value !== 'ready') return ''
  const n = history.items.value.length
  if (n === 0) return 'Nenhum evento.'
  return `${n} ${n === 1 ? 'evento carregado' : 'eventos carregados'}.${history.hasMore.value ? '' : ' Fim do histórico.'}`
})

function close() {
  emit('update:open', false)
}
</script>

<template>
  <DefineContent>
    <div :aria-busy="history.status.value === 'loading'">
      <ServiceOrdersDetailOSHistoryList
        :groups="groups"
        :status="history.status.value"
        :loading-more="history.loadingMore.value"
        :load-more-error="history.loadMoreError.value"
        :has-more="history.hasMore.value"
        :filtered="filtered"
        :total="history.items.value.length"
        @load-more="history.loadMore()"
        @retry="history.load()"
        @clear-filter="category = 'all'"
      />
    </div>
    <div class="sr-only" aria-live="polite" role="status">
      {{ announcement }}
    </div>
  </DefineContent>

  <!-- >= xl: painel fixo ao lado do conteúdo -->
  <aside
    v-if="open && isDesktop"
    id="os-history-panel"
    aria-labelledby="os-history-heading"
    class="relative z-10 w-96 shrink-0 overflow-y-auto border-l border-default bg-default shadow-[-12px_0_28px_-10px_rgb(0_0_0/0.18)] dark:shadow-[-12px_0_28px_-10px_rgb(0_0_0/0.6)]"
  >
    <div class="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-default bg-default px-4 py-3">
      <h2
        id="os-history-heading"
        tabindex="-1"
        class="text-base font-semibold text-highlighted outline-none"
      >
        Histórico
      </h2>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Fechar histórico"
        @click="close"
      />
    </div>
    <ReuseContent />
  </aside>

  <!-- < xl: slideover por cima do detalhe -->
  <USlideover
    v-else-if="!isDesktop"
    :open="open"
    side="right"
    title="Histórico"
    description="Linha do tempo das alterações desta ordem de serviço."
    :ui="{ content: 'w-full max-w-md', description: 'sr-only', body: 'p-0 sm:p-0' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div id="os-history-panel">
        <ReuseContent />
      </div>
    </template>
  </USlideover>
</template>
