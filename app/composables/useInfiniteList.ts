export interface InfiniteListFetchParams {
  cursor: number
  limit: number
  signal?: AbortSignal
}

export interface InfiniteListFetchResult<T> {
  items: T[]
  total: number
}

/**
 * Manages an infinite-scroll list with scroll-position-safe refresh.
 *
 * - `load()`: first page (used on mount or after hard reset)
 * - `loadMore()`: appends next page (infinite scroll trigger)
 * - `softRefresh()`: re-fetches all currently loaded pages in parallel and
 *   replaces the list in-place — the scroll position is preserved because
 *   the data container is updated without ever being cleared first.
 *   Use this after edit / delete / status-change operations.
 * - `reset()`: clears the list and calls load() (use when filters change)
 */
export function useInfiniteList<T>(
  fetcher: (params: InfiniteListFetchParams) => Promise<InfiniteListFetchResult<T>>,
  options?: { pageSize?: number }
) {
  const PAGE_SIZE = options?.pageSize ?? 20

  const items = ref<T[]>([]) as Ref<T[]>
  const total = ref(0)
  const isLoading = ref(false)
  const isLoadingMore = ref(false)
  const isSoftRefreshing = ref(false)

  const hasMore = computed(() => items.value.length < total.value)

  let loadController: AbortController | null = null

  function isAbortError(err: unknown): boolean {
    if (err instanceof DOMException && err.name === 'AbortError') return true
    if (err instanceof Error && err.name === 'AbortError') return true
    const cause = (err as { cause?: { name?: string } })?.cause
    return cause?.name === 'AbortError'
  }

  async function load() {
    loadController?.abort()
    loadController = new AbortController()
    const { signal } = loadController
    isLoading.value = true
    try {
      const result = await fetcher({ cursor: 0, limit: PAGE_SIZE, signal })
      if (signal.aborted) return
      items.value = result.items
      total.value = result.total
    } catch (err: unknown) {
      if (!isAbortError(err)) throw err
    } finally {
      if (!signal.aborted) isLoading.value = false
    }
  }

  async function loadMore() {
    if (!hasMore.value || isLoading.value || isLoadingMore.value || isSoftRefreshing.value) return
    isLoadingMore.value = true
    try {
      const result = await fetcher({ cursor: items.value.length, limit: PAGE_SIZE })
      items.value = [...items.value, ...result.items]
      total.value = result.total
    } finally {
      isLoadingMore.value = false
    }
  }

  /**
   * Re-fetches every page that is currently loaded, running requests in parallel.
   * The list is replaced atomically — not cleared first — so the browser scroll
   * position stays exactly where it was.
   *
   * Example: 3 pages loaded (60 items, PAGE_SIZE=20)
   *   → fires 3 requests: cursor 0/20/40, limit 20 each
   *   → merges results and writes items.value once
   */
  async function softRefresh() {
    if (isSoftRefreshing.value || isLoading.value || isLoadingMore.value) return
    isSoftRefreshing.value = true
    const pagesLoaded = Math.max(Math.ceil(items.value.length / PAGE_SIZE), 1)
    try {
      const results = await Promise.all(
        Array.from({ length: pagesLoaded }, (_, i) =>
          fetcher({ cursor: i * PAGE_SIZE, limit: PAGE_SIZE })
        )
      )
      items.value = results.flatMap(r => r.items)
      total.value = results[results.length - 1]?.total ?? total.value
    } finally {
      isSoftRefreshing.value = false
    }
  }

  async function reset() {
    items.value = []
    total.value = 0
    await load()
  }

  return {
    items,
    total,
    hasMore,
    isLoading,
    isLoadingMore,
    isSoftRefreshing,
    load,
    loadMore,
    softRefresh,
    reset
  }
}
