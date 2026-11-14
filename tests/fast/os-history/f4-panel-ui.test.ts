// F4: painel de histórico da OS (front). Utils puros, composable (com $fetch mockado) e guardas estáticas de sigilo.
// Fuso dos testes: America/Sao_Paulo (vitest.config.ts); o painel usa o fuso do navegador.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OS_HISTORY_CATEGORY_OPTIONS, formatDayLabel, formatRelativeTime, formatTime, getCategoryUi, groupEventsByAction, groupEventsByDay, isExternalSource
} from '../../../app/utils/os-history-ui'
import type { OsHistoryEvent } from '../../../app/types/service-order-history'

const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const ev = (id: string, occurredAt: string, over: Partial<OsHistoryEvent> = {}): OsHistoryEvent => ({
  id, occurredAt, category: 'status', title: 't', description: 'd', details: [], actorName: null,
  source: { code: 'os_form', label: 'x' }, groupId: 'g', ...over
})

describe('os-history-ui', () => {
  const now = new Date(2026, 10, 14, 10, 0, 0) // 14/11/2026 10:00 local

  it('rótulos do filtro: decisão do responsável, sem filtro por origem', () => {
    expect(OS_HISTORY_CATEGORY_OPTIONS.map(o => o.label)).toEqual(['Todas', 'Status', 'Dados da OS', 'Itens', 'Pagamentos', 'Comissões'])
    expect(OS_HISTORY_CATEGORY_OPTIONS.map(o => o.value)).toEqual(['all', 'status', 'order', 'items', 'payment', 'commission'])
    expect(getCategoryUi('payment').label).toBe('Pagamentos')
    expect(getCategoryUi('desconhecida').label).toBe('Outros')
  })

  it('Hoje / Ontem / dd/MM/yyyy no fuso local', () => {
    expect(formatDayLabel(new Date(2026, 10, 14, 0, 5), now)).toBe('Hoje')
    expect(formatDayLabel(new Date(2026, 10, 13, 23, 59), now)).toBe('Ontem')
    expect(formatDayLabel(new Date(2026, 10, 12, 12, 0), now)).toBe('12/11/2026')
    expect(formatDayLabel(new Date(2025, 0, 2, 12, 0), now)).toBe('02/01/2025')
  })

  it('Ontem funciona na virada de mês', () => {
    expect(formatDayLabel(new Date(2026, 9, 31, 12), new Date(2026, 10, 1, 9))).toBe('Ontem')
  })

  it('formatTime HH:mm local; inválida -> vazio', () => {
    expect(formatTime(new Date(2026, 10, 14, 9, 5).toISOString())).toBe('09:05')
    expect(formatTime('lixo')).toBe('')
  })

  it('tempo relativo: agora / há N min / há N h no mesmo dia; dias anteriores HH:mm', () => {
    const iso = (d: Date) => d.toISOString()
    expect(formatRelativeTime(iso(new Date(2026, 10, 14, 9, 59, 40)), now)).toBe('agora')
    expect(formatRelativeTime(iso(new Date(2026, 10, 14, 9, 59)), now)).toBe('há 1 minuto')
    expect(formatRelativeTime(iso(new Date(2026, 10, 14, 9, 55)), now)).toBe('há 5 minutos')
    expect(formatRelativeTime(iso(new Date(2026, 10, 14, 8, 30)), now)).toBe('há 1 hora')
    expect(formatRelativeTime(iso(new Date(2026, 10, 14, 7, 30)), now)).toBe('há 2 horas')
    expect(formatRelativeTime(iso(new Date(2026, 10, 13, 17, 56)), now)).toBe('17:56')
    expect(formatRelativeTime(iso(new Date(2026, 10, 14, 10, 5)), now)).toBe('10:05') // futuro (relógio dessincronizado)
    expect(formatRelativeTime('lixo', now)).toBe('')
  })

  it('groupEventsByAction junta só eventos consecutivos com o mesmo groupId', () => {
    const a = ev('1', '2026-11-14T13:00:00Z', { groupId: 'x' })
    const b = ev('2', '2026-11-14T13:00:00Z', { groupId: 'x' })
    const c = ev('3', '2026-11-14T12:00:00Z', { groupId: 'y' })
    const d = ev('4', '2026-11-14T11:00:00Z', { groupId: 'x' })
    expect(groupEventsByAction([a, b, c, d]).map(g => g.map(e => e.id))).toEqual([['1', '2'], ['3'], ['4']])
  })

  it('agrupa por dia local preservando a ordem recebida, sem reordenar', () => {
    const items = [
      ev('a', new Date(2026, 10, 14, 9).toISOString()),
      ev('b', new Date(2026, 10, 14, 8).toISOString()),
      ev('c', new Date(2026, 10, 13, 23, 30).toISOString()),
      ev('d', new Date(2026, 10, 12, 1).toISOString())
    ]
    const groups = groupEventsByDay(items, now)
    expect(groups.map(g => g.label)).toEqual(['Hoje', 'Ontem', '12/11/2026'])
    expect(groups.map(g => g.items.map(i => i.id))).toEqual([['a', 'b'], ['c'], ['d']])
  })

  it('evento perto da meia-noite cai no dia do navegador, não no do UTC', () => {
    // 14/11 01:30 em São Paulo = 04:30Z; 13/11 22:30 SP = 01:30Z do dia 14.
    const groups = groupEventsByDay([
      ev('x', new Date(2026, 10, 14, 1, 30).toISOString()),
      ev('y', new Date(2026, 10, 13, 22, 30).toISOString())
    ], now)
    expect(groups.map(g => g.items.map(i => i.id))).toEqual([['x'], ['y']])
  })

  it('data inválida não quebra', () => {
    expect(groupEventsByDay([ev('z', 'nope')], now)[0]!.label).toBe('Data indisponível')
    expect(groupEventsByDay([], now)).toEqual([])
  })

  it('origem externa: não os_* e diferente de unknown', () => {
    expect(isExternalSource('os_form')).toBe(false)
    expect(isExternalSource('unknown')).toBe(false)
    expect(isExternalSource('financial_entries')).toBe(true)
  })
})

describe('useServiceOrderHistory', () => {
  const fetchMock = vi.fn()
  let useServiceOrderHistory: typeof import('../../../app/composables/useServiceOrderHistory').useServiceOrderHistory

  beforeEach(async () => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchMock)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
    ;({ useServiceOrderHistory } = await import('../../../app/composables/useServiceOrderHistory'))
  })

  const page = (ids: string[], nextCursor: string | null = null) => ({ items: ids.map(id => ev(id, '2026-11-13T10:00:00Z')), nextCursor })
  const setup = (cat: 'all' | 'items' = 'all') => {
    const id = ref<string | null>('os1')
    const category = ref<'all' | 'items'>(cat)
    return { id, category, h: useServiceOrderHistory(id, category as never) }
  }
  const deferred = <T>() => {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  it('load: limit 30, sem category quando "all"; ready', async () => {
    fetchMock.mockResolvedValue(page(['1', '2'], 'cur'))
    const { h } = setup()
    await h.load()
    expect(fetchMock).toHaveBeenCalledWith('/api/service-orders/os1/history', { query: { limit: 30 } })
    expect(h.status.value).toBe('ready')
    expect(h.hasMore.value).toBe(true)
    expect(h.items.value).toHaveLength(2)
  })

  it('load com categoria envia category; loadMore repassa o cursor opaco e deduplica por id', async () => {
    fetchMock.mockResolvedValueOnce(page(['1', '2'], 'opaque==')).mockResolvedValueOnce(page(['2', '3']))
    const { h } = setup('items')
    await h.load()
    await h.loadMore()
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/service-orders/os1/history', { query: { limit: 30, category: 'items' } })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/service-orders/os1/history', { query: { limit: 30, category: 'items', cursor: 'opaque==' } })
    expect(h.items.value.map(i => i.id)).toEqual(['1', '2', '3'])
    expect(h.hasMore.value).toBe(false)
    await h.loadMore() // sem cursor: ignora
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('404 -> not-found; 500 -> error', async () => {
    fetchMock.mockRejectedValueOnce({ statusCode: 404 })
    const a = setup()
    await a.h.load()
    expect(a.h.status.value).toBe('not-found')
    fetchMock.mockRejectedValueOnce({ statusCode: 500 })
    const b = setup()
    await b.h.load()
    expect(b.h.status.value).toBe('error')
  })

  it('falha em loadMore preserva os itens e liga loadMoreError', async () => {
    fetchMock.mockResolvedValueOnce(page(['1'], 'c')).mockRejectedValueOnce(new Error('rede'))
    const { h } = setup()
    await h.load()
    await h.loadMore()
    expect(h.items.value).toHaveLength(1)
    expect(h.loadMoreError.value).toBe(true)
    expect(h.status.value).toBe('ready')
    fetchMock.mockResolvedValueOnce(page(['2']))
    await h.loadMore() // retry
    expect(h.loadMoreError.value).toBe(false)
    expect(h.items.value).toHaveLength(2)
  })

  it('loadMore concorrente é ignorado', async () => {
    const d = deferred<ReturnType<typeof page>>()
    fetchMock.mockResolvedValueOnce(page(['1'], 'c')).mockReturnValueOnce(d.promise)
    const { h } = setup()
    await h.load()
    const p1 = h.loadMore()
    await h.loadMore()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    d.resolve(page(['2']))
    await p1
    expect(h.items.value).toHaveLength(2)
  })

  it('resposta obsoleta (reset/troca de filtro durante o voo) é descartada', async () => {
    const d = deferred<ReturnType<typeof page>>()
    fetchMock.mockReturnValueOnce(d.promise)
    const { h } = setup()
    const p = h.load()
    h.reset()
    d.resolve(page(['velho']))
    await p
    expect(h.items.value).toEqual([])
    expect(h.status.value).toBe('idle')
  })

  it('refresh mantém a lista visível; falha no refresh não derruba a lista', async () => {
    fetchMock.mockResolvedValueOnce(page(['1'])).mockRejectedValueOnce(new Error('x'))
    const { h } = setup()
    await h.load()
    const p = h.refresh()
    expect(h.items.value).toHaveLength(1)
    expect(h.refreshing.value).toBe(true)
    await p
    expect(h.refreshing.value).toBe(false)
    expect(h.status.value).toBe('ready')
    expect(h.items.value).toHaveLength(1)
  })

  it('sem orderId não chama a API', async () => {
    const id = ref<string | null>(null)
    const h = useServiceOrderHistory(id, ref('all') as never)
    await h.load()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('sigilo (estático): sem orders.history nada do histórico existe', () => {
  const header = read('app/components/service-orders/detail/OSHeader.vue')
  const modal = read('app/components/service-orders/detail/Modal.vue')
  const page = read('app/pages/app/service-orders.vue')

  it('botão "Histórico" só com v-if="canViewHistory", sem disabled/tooltip', () => {
    const m = header.match(/<UButton\b(?:(?!<\/?UButton)[\s\S])*?label="Histórico"[\s\S]*?\/>/)
    expect(m, 'botão Histórico não encontrado').not.toBeNull()
    const btn = m![0]
    expect(btn).toContain('v-if="canViewHistory"')
    expect(btn).not.toMatch(/disabled/)
    expect(btn).not.toMatch(/tooltip/i)
    expect(header).not.toMatch(/<UTooltip[^>]*Hist[óo]rico/)
    expect(header.match(/Hist[óo]rico/g)).toHaveLength(1)
  })

  it('Modal: sidebar e layout flex só dentro de v-if="canViewHistory"; página usa ORDERS_HISTORY e importa ActionCode', () => {
    const idx = modal.indexOf('<ServiceOrdersDetailOSHistorySidebar')
    expect(idx).toBeGreaterThan(-1)
    expect(modal.slice(0, idx)).toMatch(/<template v-if="canViewHistory">\s*<div class="min-w-0 flex-1 overflow-y-auto">[\s\S]*$/)
    expect(modal.match(/OSHistorySidebar/g)).toHaveLength(1)
    expect(modal).toMatch(/<ReuseBody v-else \/>/)
    expect(modal).toMatch(/body: canViewHistory \? '[^']*overflow-hidden[^']*' : 'flex-1 min-h-0 overflow-y-auto p-0'/)
    expect(page).toMatch(/canViewHistory = computed\(\(\) => workshop\.can\(ActionCode\.ORDERS_HISTORY\)\)/)
    expect(page).toMatch(/:can-view-history="canViewHistory"/)
    expect(page).toMatch(/import \{ ActionCode \} from '~\/constants\/action-codes'/)
  })

  it('só o composable do painel chama /history, e o painel só o instancia dentro do Sidebar (montado sob canViewHistory)', () => {
    const files = [header, modal, page, read('app/components/service-orders/detail/OSHistoryList.vue')]
    for (const f of files) expect(f).not.toContain('/history')
    expect(read('app/composables/useServiceOrderHistory.ts')).toContain('/history`')
    expect(read('app/components/service-orders/detail/OSHistorySidebar.vue')).toContain('useServiceOrderHistory(')
  })

  it('correções adjacentes: USeparator no lugar de UDivider; fechar mobile com aria-label', () => {
    expect(header).not.toContain('UDivider')
    expect(header).toContain('<USeparator')
    const mobileClose = header.slice(header.lastIndexOf('<UButton'))
    expect(mobileClose).toContain('aria-label="Fechar"')
  })

  it('estado vazio avisa sobre OS anteriores ao recurso; sem filtro por origem na UI', () => {
    const list = read('app/components/service-orders/detail/OSHistoryList.vue')
    expect(list).toContain('OS criadas antes deste recurso não possuem histórico.')
    expect(read('app/composables/useServiceOrderHistory.ts')).not.toContain('source')
    expect(read('app/components/service-orders/detail/OSHistoryFilters.vue')).not.toMatch(/origem|source/i)
  })

  it('painel não persiste preferência (sem storage)', () => {
    for (const f of ['OSHistorySidebar.vue', 'OSHistoryList.vue', 'OSHistoryFilters.vue']) {
      expect(read(`app/components/service-orders/detail/${f}`)).not.toMatch(/localStorage|sessionStorage|useStorage|useCookie/)
    }
    expect(read('app/composables/useServiceOrderHistory.ts')).not.toMatch(/localStorage|sessionStorage|useStorage|useCookie/)
  })
})
