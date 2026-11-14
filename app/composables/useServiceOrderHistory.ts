import type { OsHistoryCategory, OsHistoryEvent, OsHistoryPage, OsHistoryStatus } from '~/types/service-order-history'

const PAGE_SIZE = 30

function isNotFound(error: unknown): boolean {
  const e = error as { statusCode?: number, status?: number, response?: { status?: number } } | null
  return (e?.statusCode ?? e?.status ?? e?.response?.status) === 404
}

/**
 * Dados do painel de histórico da OS. Só busca quando `load()` é chamado (o container o chama com o painel aberto).
 * Respostas de OS/filtro/geração anteriores são descartadas. O cursor é opaco e apenas repassado.
 */
export function useServiceOrderHistory(
  orderId: Ref<string | null>,
  category: Ref<OsHistoryCategory | 'all'>
) {
  const items = ref<OsHistoryEvent[]>([])
  const nextCursor = ref<string | null>(null)
  const status = ref<OsHistoryStatus>('idle')
  const loadingMore = ref(false)
  const loadMoreError = ref(false)
  const refreshing = ref(false)
  const hasMore = computed(() => !!nextCursor.value)

  let generation = 0

  function buildQuery(cursor?: string | null) {
    return {
      limit: PAGE_SIZE,
      ...(category.value !== 'all' ? { category: category.value } : {}),
      ...(cursor ? { cursor } : {})
    }
  }

  function reset() {
    generation++
    items.value = []
    nextCursor.value = null
    status.value = 'idle'
    loadingMore.value = false
    loadMoreError.value = false
    refreshing.value = false
  }

  async function fetchFirstPage(keepItems: boolean) {
    const id = orderId.value
    if (!id) return
    const gen = ++generation
    loadMoreError.value = false
    loadingMore.value = false
    if (keepItems) {
      refreshing.value = true
    } else {
      items.value = []
      nextCursor.value = null
      status.value = 'loading'
    }
    try {
      const page = await $fetch<OsHistoryPage>(`/api/service-orders/${id}/history`, { query: buildQuery() })
      if (gen !== generation) return
      items.value = page.items
      nextCursor.value = page.nextCursor
      status.value = 'ready'
    } catch (error) {
      if (gen !== generation) return
      if (isNotFound(error)) {
        items.value = []
        nextCursor.value = null
        status.value = 'not-found'
      } else if (!keepItems) {
        status.value = 'error'
      }
      // refresh com falha: mantém a lista visível como estava.
    } finally {
      if (gen === generation) refreshing.value = false
    }
  }

  const load = () => fetchFirstPage(false)
  const refresh = () => fetchFirstPage(items.value.length > 0)

  async function loadMore() {
    const id = orderId.value
    const cursor = nextCursor.value
    if (!id || !cursor || loadingMore.value || status.value !== 'ready') return
    const gen = generation
    loadingMore.value = true
    loadMoreError.value = false
    try {
      const page = await $fetch<OsHistoryPage>(`/api/service-orders/${id}/history`, { query: buildQuery(cursor) })
      if (gen !== generation) return
      const known = new Set(items.value.map(i => i.id))
      items.value = [...items.value, ...page.items.filter(i => !known.has(i.id))]
      nextCursor.value = page.nextCursor
    } catch {
      if (gen !== generation) return
      loadMoreError.value = true
    } finally {
      if (gen === generation) loadingMore.value = false
    }
  }

  return { items, nextCursor, status, loadingMore, loadMoreError, refreshing, hasMore, load, loadMore, refresh, reset }
}
