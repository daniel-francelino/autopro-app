// Histórico da OS (F0): lacunas de cobertura sobre os testes do developer (sources/record/render/history-endpoint).
// Cenários: docs/testing/os-history-scenarios.md OSH-003/004/005/006/010/011/013/014/031/032/034/036/038/042.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { guardSeed, USERS, type Persona } from '../../support/phase3-guard-fixture'
import { OS_HISTORY_SOURCES, originForPath, resolveSource, isOsHistorySourceCode } from '../../../lib/utils/os-history-sources'
import { recordOsEvents } from '../../../server/utils/os-history/record'
import { renderOsEvent, type OsEventRow } from '../../../server/utils/os-history/render'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }
vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const policy = { defaultSource: 'commission_report', allowedSources: ['bonus_page'] } as const

// ---------------------------------------------------------------- origem (x-origin)
describe('[OSH-003] header de origem inválido nunca vira origem nem rótulo', () => {
  const hostile = ['foo', '', '   ', 'x'.repeat(10 * 1024), '<script>alert(1)</script>', 'os_detail;DROP TABLE x', '__proto__', 'constructor', "' OR 1=1 --"]
  it.each(hostile.map(h => [h.length > 40 ? `${h.slice(0, 12)}...(${h.length} chars)` : JSON.stringify(h), h]))('%s', (_n, value) => {
    const r = resolveSource(value, policy)
    expect(r).toMatchObject({ code: 'commission_report', label: 'Relatórios > Comissões', trust: 'inferred' })
    expect(isOsHistorySourceCode(r.code)).toBe(true)
    expect(r.label).toBe(OS_HISTORY_SOURCES[r.code])
    // Q1 em aberto: o conteúdo de `declared` não é fixado aqui, mas lixo cru nunca pode ser guardado.
    expect(r.declared === null || isOsHistorySourceCode(r.declared)).toBe(true)
  })
})

describe('[OSH-001/002/004] origem declarada, divergente e padrão', () => {
  it('declarada no conjunto do endpoint', () => {
    expect(resolveSource('bonus_page', policy)).toEqual({ code: 'bonus_page', label: 'Financeiro > Bônus', declared: 'bonus_page', trust: 'declared' })
  })
  it('no catálogo mas fora do conjunto: infere, guarda o declarado, mismatch', () => {
    expect(resolveSource('financial_bulk', policy)).toEqual({ code: 'commission_report', label: 'Relatórios > Comissões', declared: 'financial_bulk', trust: 'mismatch' })
  })
  it('sem allowedSources só a padrão é aceita', () => {
    expect(resolveSource('os_list', { defaultSource: 'os_detail' })).toMatchObject({ code: 'os_detail', trust: 'mismatch' })
    expect(resolveSource('os_detail', { defaultSource: 'os_detail' })).toMatchObject({ code: 'os_detail', trust: 'declared' })
  })
})

describe('[OSH-005] catálogo fechado', () => {
  it('14 códigos únicos, cada um com rótulo pt-BR não vazio', () => {
    const codes = Object.keys(OS_HISTORY_SOURCES)
    expect(codes).toHaveLength(14)
    expect(new Set(codes).size).toBe(14)
    expect(codes).toEqual(expect.arrayContaining(['os_detail', 'os_form', 'os_list', 'financial_entries', 'financial_bulk', 'commission_report', 'commission_bulk', 'bonus_page', 'appointments', 'fiscal', 'system', 'admin_support', 'api', 'unknown']))
    for (const label of Object.values(OS_HISTORY_SOURCES)) expect(label.trim().length).toBeGreaterThan(0)
  })
})

describe('[OSH-006] rota da página -> origem (plugin api-client)', () => {
  it.each([
    ['/app/financial/bonuses/123', 'bonus_page'],
    ['/app/financial/commissions', 'commission_report'],
    ['/app/reports/commissions', 'commission_report'],
    ['/app/service-orders/abc', 'os_detail'],
    ['/app/financial?tab=x#y', 'financial_entries'],
    ['/admin', 'admin_support']
  ])('%s -> %s', (path, code) => {
    expect(originForPath(path)).toBe(code)
    expect(isOsHistorySourceCode(originForPath(path))).toBe(true)
  })
  it.each(['/', '/app', '/login', '/app/customers', '/app/financialx', '/app/reports', '', undefined])('rota sem mapa %j não gera código', (path) => {
    expect(originForPath(path as string | undefined)).toBeNull()
  })
})

// ---------------------------------------------------------------- recordOsEvents
const REQ = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const item = (over: Record<string, unknown> = {}) => ({ organizationId: ORG, serviceOrderId: 'o1', eventType: 'installment.paid', category: 'payment', visibility: 'financial', payload: { amount: 10 }, idempotencyKey: 'k-default', ...over }) as never
const evt = (headers: Record<string, string> = {}) => {
  const e = fakeEvent({ headers }) as unknown as { context: unknown }
  e.context = { audit: { requestId: REQ, startedAt: 0, userId: USER, email: 'maria@x.com' } }
  return e as never
}
const dsPolicy = { defaultSource: 'os_detail' } as const

describe('recordOsEvents (lacunas)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('[OSH-010] ator, correlation_id e origem vêm do servidor: campos equivalentes no item são ignorados', async () => {
    const f = createFakeSupabase()
    await recordOsEvents(evt({ 'x-origin': 'os_detail' }), f.client, [item({ actor_user_id: 'forjado', actorUserId: 'forjado', actor_name: 'Hacker', correlation_id: 'forjado', correlationId: 'forjado', source_code: 'system', source_trust: 'declared', origin: 'backfill' })], dsPolicy)
    const [row] = f.tables.service_order_events as Array<Record<string, unknown>>
    expect(row).toMatchObject({ actor_user_id: USER, correlation_id: REQ, source_code: 'os_detail', origin: 'live', actor_name: 'Usuário' })
  })

  it('[OSH-011] falha permanente: 2 tentativas exatamente, não lança, log com request_id', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'down' } })
    const client = { from: () => ({ upsert, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } as never
    await expect(recordOsEvents(evt(), client, [item()], dsPolicy)).resolves.toBeUndefined()
    expect(upsert).toHaveBeenCalledTimes(2)
    const opts = { onConflict: 'organization_id,idempotency_key', ignoreDuplicates: true }
    expect(upsert).toHaveBeenNthCalledWith(1, [expect.objectContaining({ idempotency_key: 'k-default' })], opts)
    expect(upsert).toHaveBeenNthCalledWith(2, [expect.objectContaining({ idempotency_key: 'k-default' })], opts)
    expect(err).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(err.mock.calls[0])).toContain(REQ)
  })

  it('[OSH-011] insert que rejeita a promise (em vez de devolver error) também não lança', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const upsert = vi.fn().mockRejectedValue(new Error('network'))
    const client = { from: () => ({ upsert, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } as never
    await expect(recordOsEvents(evt(), client, [item()], dsPolicy)).resolves.toBeUndefined()
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('[OSH-011] falha ao ler o header ou ao montar a linha também não lança', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = createFakeSupabase()
    const g = globalThis as Record<string, unknown>
    const real = g.getHeader
    g.getHeader = () => { throw new Error('header boom') }
    try {
      await expect(recordOsEvents(evt(), f.client, [item()], dsPolicy)).resolves.toBeUndefined()
    } finally { g.getHeader = real }
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(recordOsEvents(evt(), { from: () => { throw new Error('x') } } as never, [item({ payload: circular })], dsPolicy)).resolves.toBeUndefined()
  })

  it('[OSH-012] 1ª falha, 2ª ok: 1 evento gravado e sem log de erro', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = createFakeSupabase()
    f.failNext('service_order_events', 'boom')
    await recordOsEvents(evt(), f.client, [item({ idempotencyKey: 'k' })], dsPolicy)
    expect(f.tables.service_order_events).toHaveLength(1)
    expect(err).not.toHaveBeenCalled()
  })

  it('[OSH-013] lista vazia: nenhuma chamada ao banco', async () => {
    const from = vi.fn()
    await expect(recordOsEvents(evt(), { from } as never, [], dsPolicy)).resolves.toBeUndefined()
    expect(from).not.toHaveBeenCalled()
  })

  it('[OSH-014] 3 eventos da mesma ação: 1 insert em lote, mesmo correlation_id', async () => {
    const f = createFakeSupabase()
    await recordOsEvents(evt(), f.client, [item({ idempotencyKey: 'a' }), item({ idempotencyKey: 'b' }), item({ idempotencyKey: 'c' })], dsPolicy)
    expect(f.writes.filter(w => w.table === 'service_order_events')).toHaveLength(1)
    const rows = f.tables.service_order_events as Array<Record<string, unknown>>
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map(r => r.correlation_id))).toEqual(new Set([REQ]))
  })
  it.todo('[OSH-014] `step` crescente 1..3: a migration 108 não tem coluna step (sem decisão); revisitar se o desenho a adotar')
})

// ---------------------------------------------------------------- endpoint
const HISTORY = 'server/api/service-orders/[id]/history.get.ts'
const CODES = ['orders.read', 'orders.pay', 'reports.commissions', 'orders.history']
const cookies = { 'sb-access-token': 'tok' }
const login = (persona: Persona) => {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}
let n = 0
const ev = (over: Record<string, unknown> = {}) => ({
  id: `ev-${++n}`, seq: n, organization_id: 'org-a', service_order_id: 'o1', occurred_at: new Date(Date.UTC(2026, 10, 13, 10, 0, 0) + n * 1000).toISOString(),
  event_type: 'order.status_changed', schema_version: 1, category: 'status', visibility: 'general', actor_name: 'Maria',
  payload: { from: 'open', to: 'completed' }, correlation_id: REQ,
  source_code: 'os_form', source_label: 'Ordem de serviço (cadastro/edição)', ...over
})
function seed(granted: string[], events: Array<Record<string, unknown>>) {
  const s = guardSeed(CODES, { service_orders: [{ id: 'o1', organization_id: 'org-a' }], service_order_events: events })
  s.role_actions = granted.map(code => ({ role_id: 'r-com', action_id: `act-${CODES.indexOf(code)}`, is_granted: true }))
  fake = createFakeSupabase(s)
}
const get = (query: Record<string, unknown> = {}, extra: { cookies?: Record<string, string>, headers?: Record<string, string> } = {}) =>
  callHandler(HISTORY, fakeEvent({ cookies: extra.cookies ?? cookies, params: { id: 'o1' }, query, headers: extra.headers }))
type Items = { items: Array<Record<string, unknown>>, nextCursor: string | null }

describe('GET history (lacunas)', () => {
  beforeEach(() => auth.refreshSession.mockReset())

  it('[OSH-032] sem sessão: 401 e nada é lido', async () => {
    seed(['orders.read', 'orders.history'], [ev()])
    auth.getUser.mockReset().mockResolvedValue({ data: { user: null }, error: { message: 'no session' } })
    const res = await get({}, { cookies: {} })
    expect(res.status).toBe(401)
    expect(res.body).toBeUndefined()
  })

  it('[OSH-031] organization_id/org na query e header forjado são ignorados: só a org do usuário', async () => {
    seed(['orders.read', 'orders.history'], [ev(), ev({ organization_id: 'org-b' }), ev({ organization_id: 'org-b' })])
    login('com')
    const res = await get({ organization_id: 'org-b', org: 'org-b', organizationId: 'org-b' }, { headers: { 'x-organization-id': 'org-b', 'x-org-id': 'org-b' } })
    expect(res.status).toBe(200)
    expect((res.body as Items).items).toHaveLength(1)
  })

  it('[OSH-034] comissão sem permissão financeira: general + commission, sem financial', async () => {
    seed(['orders.read', 'orders.history', 'reports.commissions'], [ev({ id: 'g' }), ev({ id: 'f', visibility: 'financial' }), ev({ id: 'c', visibility: 'commission' })])
    login('com')
    const ids = ((await get()).body as Items).items.map(i => i.id).sort()
    expect(ids).toEqual(['c', 'g'])
  })

  it('[OSH-036] resposta só com campos permitidos: sem ids, e-mail, IP, correlation_id, commissions[]', async () => {
    const dirty = { amount: 300, installment_number: 2, payment_method: 'pix', email: 'cliente@secreto.com', ip: '203.0.113.9', user_agent: 'UA-secreto', entity_id: 'ENTITY-SECRETA', actor_user_id: 'ACTOR-SECRETO', correlation_id: 'CORR-SECRETA', commissions: [{ employee_id: 'EMP-SECRETO', amount: 99 }] }
    seed(['orders.read', 'orders.history'], [ev({ event_type: 'installment.paid', category: 'payment', payload: dirty }), ev({ event_type: 'future.thing', payload: dirty })])
    login('com')
    const res = await get()
    const body = res.body as Items
    expect(body.items).toHaveLength(2)
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(['actorName', 'category', 'description', 'details', 'groupId', 'id', 'occurredAt', 'source', 'title'])
      expect(Object.keys(item.source as object).sort()).toEqual(['code', 'label'])
    }
    const json = JSON.stringify(res.body)
    for (const secret of ['cliente@secreto.com', '203.0.113.9', 'UA-secreto', 'ENTITY-SECRETA', 'ACTOR-SECRETO', 'CORR-SECRETA', 'EMP-SECRETO', 'commissions', REQ, 'org-a'])
      expect(json).not.toContain(secret)
  })

  it('[OSH-038] limit ausente/0/texto = padrão 30; 101 vira 100; negativo vira 1; origem inválida 400 sem 500', async () => {
    seed(['orders.read', 'orders.history'], Array.from({ length: 105 }, () => ev()))
    login('com')
    const size = async (limit?: unknown) => ((await get(limit === undefined ? {} : { limit })).body as Items).items.length
    expect(await size()).toBe(30)
    expect(await size('0')).toBe(30)
    expect(await size('abc')).toBe(30)
    expect(await size('101')).toBe(100)
    expect(await size('-5')).toBe(1)
    expect((await get({ source: '<script>' })).status).toBe(400)
    expect((await get({ source: '__proto__' })).status).toBe(400)
    expect((await get({ cursor: Buffer.from('{"t":"nao-data","s":1}').toString('base64url') })).status).toBe(400)
    expect((await get({ cursor: Buffer.from('{"t":"2026-01-01T00:00:00Z","s":"x"}').toString('base64url') })).status).toBe(400)
  })
})

// ---------------------------------------------------------------- renderizador
describe('[OSH-042] rótulo de origem vem do catálogo, nunca do que está gravado', () => {
  const row: OsEventRow = {
    id: 'e1', occurred_at: '2026-11-13T12:00:00Z', event_type: 'installment.paid', schema_version: 1, category: 'payment',
    actor_name: 'Maria', payload: {}, correlation_id: REQ, source_code: 'os_detail', source_label: '<img src=x onerror=alert(1)>'
  }
  it('source.label vem de OS_HISTORY_SOURCES mesmo que o rótulo gravado seja hostil', () => {
    expect(renderOsEvent(row).source.label).toBe(OS_HISTORY_SOURCES.os_detail)
  })
  it('texto do payload é devolvido como dado (escape fica no front)', () => {
    const r = renderOsEvent({ ...row, source_label: OS_HISTORY_SOURCES.os_detail, event_type: 'order.status_changed', payload: { from: '<b>x</b>', to: 'completed' } })
    // Status fora do mapa não expõe o texto/código cru (rótulo genérico).
    expect(r.details[0]!.from).toBe('outro status')
  })
})
