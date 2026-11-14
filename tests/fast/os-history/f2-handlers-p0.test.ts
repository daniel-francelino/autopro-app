// Histórico da OS (F2), handlers POST service-orders e DELETE service-orders/:id: cenários P0 que
// complementam f2-handlers.test.ts (não repete: criação básica, reenvio idêntico, cliente/veículo, status/origem, itens, responsáveis).
// OSH-209/210/223/225/242/243/247/248/249/258/261/262/263/267/269/270/271/300/304/305/306/307.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { guardSeed, USERS } from '../../support/phase3-guard-fixture'

const boom = vi.hoisted(() => ({ diff: false, update: false, created: false, deleted: false }))
let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }
vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))
vi.mock('../../../server/utils/os-history/diff', async (orig) => {
  const m = await orig<typeof import('../../../server/utils/os-history/diff')>()
  return { ...m, diffOrderFields: (...a: Parameters<typeof m.diffOrderFields>) => { if (boom.diff) throw new Error('diff boom'); return m.diffOrderFields(...a) } }
})
vi.mock('../../../server/utils/os-history/order-events', async (orig) => {
  const m = await orig<typeof import('../../../server/utils/os-history/order-events')>()
  return {
    ...m,
    buildOrderUpdateEvents: (...a: Parameters<typeof m.buildOrderUpdateEvents>) => { if (boom.update) throw new Error('update builder boom'); return m.buildOrderUpdateEvents(...a) },
    buildOrderDeletedEvent: (...a: Parameters<typeof m.buildOrderDeletedEvent>) => { if (boom.deleted) throw new Error('deleted builder boom'); return m.buildOrderDeletedEvent(...a) },
    buildOrderCreatedEvent: (...a: Parameters<typeof m.buildOrderCreatedEvent>) => { if (boom.created) throw new Error('created builder boom'); return m.buildOrderCreatedEvent(...a) }
  }
})
installNitroGlobals()
await installServerUtilsGlobals()

const POST = 'server/api/service-orders/index.post.ts'
const DEL = 'server/api/service-orders/[id].delete.ts'
const CANCEL = 'server/api/service-orders/[id]/cancel.post.ts'
const HISTORY = 'server/api/service-orders/[id]/history.get.ts'
const RID = '33333333-3333-4333-8333-333333333333'
const RID2 = '44444444-4444-4444-8444-444444444444'
const O = 'o1'
type Row = Record<string, any>

const order = (over: Row = {}): Row => ({
  id: O, organization_id: 'org-a', number: 'OS1', status: 'open', client_id: 'cl1', vehicle_id: 'v1', employee_responsible_id: null,
  master_product_id: null, responsible_employees: [], items: [], discount: 0, total_amount: 100, reported_defect: 'barulho',
  notes: null, entry_date: '2026-11-01', payment_status: 'pending', commission_amount: 0, deleted_at: null, ...over
})
const CODES = ['orders.update', 'orders.create', 'orders.delete', 'orders.read', 'orders.cancel', 'orders.pay', 'orders.history']
function seed(orderOver: Row = {}, extra: Record<string, Row[]> = {}) {
  fake = createFakeSupabase(guardSeed(CODES, {
    service_orders: [order(orderOver), order({ id: 'ob', organization_id: 'org-b', number: 'OSB', client_id: 'clb' })],
    clients: [
      { id: 'cl1', organization_id: 'org-a', name: 'Ana', phone: '11999990000', cpf: '123.456.789-09' }, { id: 'cl2', organization_id: 'org-a', name: 'Beto' },
      { id: 'cl3', organization_id: 'org-a', name: '   ' }, { id: 'clb', organization_id: 'org-b', name: 'Cliente da Outra Org' }
    ],
    vehicles: [{ id: 'v1', organization_id: 'org-a', brand: 'VW', model: 'Gol', license_plate: 'ABC1D23' }, { id: 'v2', organization_id: 'org-a', brand: 'Fiat', model: 'Uno', license_plate: 'XYZ9K88' }],
    employees: [{ id: 'e1', organization_id: 'org-a', name: 'Carlos' }, { id: 'e2', organization_id: 'org-a', name: 'Dora' }],
    master_products: [{ id: 'mp1', organization_id: 'org-a', name: 'Pacote Revisão' }],
    service_order_events: [], employee_financial_records: [], service_order_installments: [], financial_transactions: [], bank_account_statements: [],
    ...extra
  }))
  login('admin')
}
const login = (p: keyof typeof USERS) => auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: USERS[p].id, email: USERS[p].email } }, error: null })
const call = (file: string, o: { body?: unknown, headers?: Record<string, string>, method?: string, id?: string, rid?: string, query?: Record<string, unknown> } = {}) => {
  const e = fakeEvent({ method: o.method ?? 'POST', cookies: { 'sb-access-token': 'tok' }, params: { id: o.id ?? O }, body: o.body, headers: o.headers, query: o.query })
  ;(e as any).context = { audit: { requestId: o.rid ?? RID, userId: USERS.admin.id, actorType: 'user' } }
  return callHandler(file, e)
}
const events = (type?: string): Row[] => ((fake.tables.service_order_events ?? []) as Row[]).filter(e => !type || e.event_type === type)
const edit = (orderData: Row, o: { headers?: Record<string, string>, rid?: string, id?: string, extra?: Row } = {}) =>
  call(POST, { body: { orderId: o.id ?? O, orderData, ...o.extra }, headers: o.headers, rid: o.rid })
const eventInserts = () => fake.writes.filter(w => w.table === 'service_order_events' && (w.op === 'insert' || w.op === 'upsert'))
const breakEvents = (mode: 'throw' | 'error') => {
  const real = fake.client.from.bind(fake.client)
  const stub: any = new Proxy({}, { get: (_t, k) => (k === 'then' ? (res: (v: unknown) => unknown) => res({ data: null, error: { message: 'insert falhou' } }) : () => stub) })
  ;(fake.client as any).from = (t: string) => {
    if (t !== 'service_order_events') return real(t)
    if (mode === 'throw') throw new Error('down')
    return stub
  }
}
const stored = () => (fake.tables.service_orders as Row[]).find(r => r.id === O)!

beforeEach(() => { auth.refreshSession.mockReset(); boom.diff = false; boom.update = false; boom.created = false; boom.deleted = false; vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('[OSH-200/252/255/256/267] criação: origem, tenant e chave', () => {
  it('sem header cai em os_form (inferida); os_form/os_list declarados; header alheio/injeção = mismatch sem tela adivinhada', async () => {
    seed()
    await call(POST, { body: { orderData: { number: 'N1' } } })
    expect(events('order.created')[0]).toMatchObject({ source_code: 'os_form', source_trust: 'inferred' })
    await call(POST, { body: { orderData: { number: 'N2' } }, headers: { 'x-origin': 'os_form' } })
    expect(events('order.created')[1]).toMatchObject({ source_code: 'os_form', source_trust: 'declared' })
    await call(POST, { body: { orderData: { number: 'N3' } }, headers: { 'x-origin': 'os_list' } }) // duplicar OS pela lista
    expect(events('order.created')[2]).toMatchObject({ source_code: 'os_list', source_trust: 'declared' })
    for (const [i, h] of ['financial_bulk', 'commission_report', '<script>alert(1)</script>'].entries()) {
      await call(POST, { body: { orderData: { number: `M${i}` } }, headers: { 'x-origin': h } })
      const e = events('order.created')[3 + i]!
      expect(e.source_code).toBe('os_form')
      expect(e.source_trust).not.toBe('declared')
      expect(JSON.stringify(e)).not.toContain('<script>')
    }
  })

  it('OSH-200: a chave de order.created é determinística pelo id da OS (não pelo request); a OS duplicada não herda eventos', async () => {
    seed()
    await call(POST, { body: { orderData: { number: 'N1' } }, rid: RID })
    await call(POST, { body: { orderData: { number: 'N2' } }, rid: RID2 })
    const [a, b] = events('order.created')
    expect(a!.idempotency_key).toBe(`order_created:${a!.service_order_id}`)
    expect(b!.idempotency_key).toBe(`order_created:${b!.service_order_id}`)
    expect(a!.service_order_id).not.toBe(b!.service_order_id)
    expect(events().filter(e => e.service_order_id === O)).toHaveLength(0)
  })

  it('OSH-267: organization_id (e ids de ator) vindos do corpo são ignorados; evento usa a org da sessão', async () => {
    seed()
    await call(POST, { body: { orderData: { number: 'N1', organization_id: 'org-b' }, organization_id: 'org-b' }, headers: { 'x-origin': 'os_form' } })
    await edit({ reported_defect: 'x', organization_id: 'org-b' }, { extra: { organization_id: 'org-b' } })
    expect(events().length).toBeGreaterThanOrEqual(2)
    for (const e of events()) expect(e.organization_id).toBe('org-a')
    expect(stored().organization_id).toBe('org-a')
  })
})

describe('[OSH-269/270] tenant e permissão', () => {
  it('OS de outra org: 404, zero eventos em qualquer org e OS intocada', async () => {
    seed()
    const res = await edit({ reported_defect: 'invasão' }, { id: 'ob' })
    expect(res.status).toBe(404)
    expect(events()).toHaveLength(0)
    expect((fake.tables.service_orders as Row[]).find(r => r.id === 'ob')!.reported_defect).toBe('barulho')
  })

  it.each([
    ['edição sem orders.update', { orderId: O, orderData: { reported_defect: 'x' } }],
    ['criação sem orders.create', { orderData: { number: 'N9' } }]
  ])('%s: 403 antes de escrever, com e sem x-origin, zero eventos', async (_n, body) => {
    seed()
    ;(fake.tables.role_actions as Row[]).length = 0
    login('com')
    for (const headers of [undefined, { 'x-origin': 'os_list' }, { 'x-origin': 'financial_bulk' }]) {
      expect((await call(POST, { body, headers })).status).toBe(403)
    }
    expect(events()).toHaveLength(0)
    expect(stored().reported_defect).toBe('barulho')
    expect(fake.writes.filter(w => w.table === 'service_orders')).toHaveLength(0)
  })
})

describe('[OSH-209/210] edição parcial e payload gravado', () => {
  it('OSH-209: campos ausentes no corpo não viram "para vazio"; só o enviado e diferente gera diff', async () => {
    seed({ notes: 'obs', diagnosis: 'd', expected_date: '2026-12-01', vehicle_id: 'v1', items: [{ name: 'Filtro', quantity: 1, unit_price: 35 }], responsible_employees: [{ employee_id: 'e1' }] })
    expect((await edit({ notes: 'obs 2' })).status).toBe(200)
    expect(events().map(e => e.event_type)).toEqual(['order.fields_changed'])
    expect(events()[0]!.payload.changes).toEqual([{ field: 'notes', from: 'obs', to: 'obs 2' }])
  })

  it('OSH-210: linha gravada sem ids crus, e-mail/telefone/CPF, comissão nem coluna fora da lista; ids só em entity_id/refs', async () => {
    seed({
      employee_responsible_id: 'e1', master_product_id: null,
      items: [{ id: 'it-1', name: 'Filtro', quantity: 1, unit_price: 35, cost_price: 5, commissions: [{ employee_id: 'e1', amount: 4321 }], commission_total: 4321, total_commission: 4321 }]
    })
    await edit({
      client_id: 'cl2', vehicle_id: 'v2', employee_responsible_id: 'e2', master_product_id: 'mp1', status: 'in_progress', discount: 5,
      items: [{ id: 'it-1', name: 'Filtro', quantity: 2, unit_price: 35, cost_price: 5, commissions: [{ employee_id: 'e1', amount: 8642 }], commission_total: 8642 }],
      responsible_employees: [{ employee_id: 'e1', commission_percent: 17.5, commission_amount: 999 }], commission_amount: 777, mystery_col: 'valor livre'
    }, { headers: { 'x-origin': 'os_form' } })
    expect(events().length).toBeGreaterThanOrEqual(4)
    const idKeys = new Set(['entity_id', 'service_order_id', 'organization_id', 'correlation_id', 'idempotency_key', 'id', 'actor_user_id'])
    for (const e of events()) {
      const body = JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !idKeys.has(k))))
      for (const bad of ['cl1', 'cl2', '"v1"', '"v2"', 'e1', 'e2', 'mp1', 'it-1', '@', '4321', '8642', '777', '999', '17.5', '11999990000', '123.456', 'mystery_col']) {
        expect(body, `${e.event_type} contém ${bad}`).not.toContain(bad)
      }
      expect(body.toLowerCase()).not.toContain('commission')
      expect(e.entity_id === null || e.entity_id === O).toBe(true)
    }
    const f = events('order.fields_changed')[0]!.payload.changes as Row[]
    expect(f.find(c => c.field === 'employee_responsible')).toEqual({ field: 'employee_responsible', from: 'Carlos', to: 'Dora' })
    expect(f.find(c => c.field === 'master_product')).toEqual({ field: 'master_product', from: null, to: 'Pacote Revisão' })
    expect(f.some(c => c.field === 'other')).toBe(false) // o handler não grava colunas fora do payload conhecido
  })
})

describe('[OSH-242/243] troca/remoção de cliente e veículo: nomes, nunca uuid', () => {
  it('remover veículo => null no destino (a tela mostra "Sem veículo"); cliente sem nome ou de outro tenant => "(sem nome)"', async () => {
    seed()
    await edit({ vehicle_id: null, client_id: 'cl3' })
    const ch = events('order.fields_changed')[0]!.payload.changes as Row[]
    expect(ch).toEqual([{ field: 'client', from: 'Ana', to: '(sem nome)' }, { field: 'vehicle', from: 'VW Gol (ABC1D23)', to: null }])
    expect(JSON.stringify(events())).not.toMatch(/cl3|"v1"/)
    seed()
    await edit({ client_id: 'clb' }) // cliente de outra org: o nome não é resolvido (tenant)
    expect(JSON.stringify(events())).not.toContain('Outra Org')
  })

  it('cliente e veículo trocados juntos: um único evento com 2 mudanças, ordem determinística', async () => {
    seed()
    await edit({ client_id: 'cl2', vehicle_id: 'v2' })
    expect(events('order.fields_changed')).toHaveLength(1)
    expect((events('order.fields_changed')[0]!.payload.changes as Row[]).map(c => c.field)).toEqual(['client', 'vehicle'])
  })
})

describe('[OSH-236/238] responsáveis: remoção, troca, snapshot de nome', () => {
  it('remover e trocar: nomes em added/removed; os que não mudam ficam de fora; o payload guarda o nome da época', async () => {
    seed({ responsible_employees: [{ employee_id: 'e1' }, { employee_id: 'e2' }] })
    await edit({ responsible_employees: [{ employee_id: 'e2' }] })
    expect(events('order.responsibles_changed')[0]!.payload).toEqual({ added: [], removed: ['Carlos'] })
    ;(fake.tables.employees as Row[]).find(e => e.id === 'e1')!.name = 'Carlos Renomeado'
    expect(events('order.responsibles_changed')[0]!.payload.removed).toEqual(['Carlos'])
    await edit({ responsible_employees: [{ employee_id: 'e1' }] }, { rid: RID2 }) // troca e2 -> e1
    expect(events('order.responsibles_changed')[1]!.payload).toEqual({ added: ['Carlos Renomeado'], removed: ['Dora'] })
  })
})

describe('[OSH-225] entradas inválidas de itens: a operação conclui como hoje', () => {
  it.each([null, {}, 'texto', '[{"name":"x"}]', [{ quantity: -1 }, null, 7, { name: 'ok', quantity: 'abc' }]])('items=%j => 200, sem lançar, eventos só dos tipos esperados', async (items) => {
    seed({ items: [{ name: 'Velho', quantity: 1, unit_price: 10 }] })
    const res = await edit({ items })
    expect(res.status).toBe(200)
    for (const e of events()) expect(['order.items_changed', 'order.fields_changed']).toContain(e.event_type)
    expect(JSON.stringify(events())).not.toMatch(/NaN|undefined|\[object/)
  })
})

describe('[OSH-206/201] campos financeiros: evento próprio, só financial; comissão nunca entra', () => {
  it('custo, taxa e payment_* mudando => 1 order.payment_terms_changed (financial), sem evento general; commission_amount ignorado', async () => {
    seed({ total_cost_amount: 10, terminal_fee_amount: 1, payment_method: 'pix', is_installment: false, installment_count: 0, payment_status: 'pending' })
    await edit({ total_cost_amount: 999, terminal_fee_amount: 55, payment_method: 'cash', is_installment: true, installment_count: 3, payment_status: 'paid', commission_amount: 888 })
    expect(events().map(e => e.event_type)).toEqual(['order.payment_terms_changed'])
    const e = events()[0]!
    expect(e).toMatchObject({ visibility: 'financial', category: 'payment', idempotency_key: expect.stringMatching(/^order_payment_terms_changed:/) })
    expect((e.payload.changes as Row[]).map(c => c.field)).toEqual(['total_cost_amount', 'terminal_fee_amount', 'payment_method', 'payment_status', 'is_installment', 'installment_count'])
    expect(JSON.stringify(e)).not.toMatch(/commission|888/)
    expect(stored().total_cost_amount).toBe(999)
  })
  it('mudança sem efeito (0 x null, mesma forma de pagamento) não gera evento', async () => {
    seed({ total_cost_amount: 0, terminal_fee_amount: null, payment_method: 'pix', is_installment: false, installment_count: 0 })
    await edit({ total_cost_amount: null, terminal_fee_amount: 0, payment_method: 'pix', is_installment: null, installment_count: '0' })
    expect(events()).toHaveLength(0)
  })
  it.todo('PERGUNTA AO RESPONSÁVEL: POST com status=cancelled (sem passar por cancel.post) deve ser bloqueado/redirecionado? Hoje grava status_changed e NÃO limpa pagamentos/comissões')
})

describe('[OSH-246/247/248] status via POST x cancel.post', () => {
  it('POST status=cancelled: exatamente 1 status_changed "open -> cancelled" e nenhum order.cancelled (comportamento atual)', async () => {
    seed()
    expect((await edit({ status: 'cancelled' })).status).toBe(200)
    expect(events().map(e => e.event_type)).toEqual(['order.status_changed'])
    expect(events()[0]!.payload).toEqual({ from: 'open', to: 'cancelled' })
  })

  it('cancel.post: exatamente 1 order.cancelled e NENHUM status_changed duplicado', async () => {
    seed()
    expect((await call(CANCEL)).status).toBe(200)
    expect(events('order.cancelled')).toHaveLength(1)
    expect(events('order.status_changed')).toHaveLength(0)
    expect(stored().status).toBe('cancelled')
  })

  it.each([['completed', 'open'], ['cancelled', 'open'], ['delivered', 'in_progress'], ['invoiced', 'completed'], ['estimate', 'waiting_for_part']])('%s -> %s é permitido e gera 1 evento de/para', async (from, to) => {
    seed({ status: from })
    expect((await edit({ status: to })).status).toBe(200)
    expect(events().map(e => [e.event_type, e.payload.from, e.payload.to])).toEqual([['order.status_changed', from, to]])
  })
})

describe('[OSH-249] ordem causa -> efeito e lote único', () => {
  it('status + campos + itens + responsáveis: 4 eventos, 1 insert em lote, mesma correlação, ordem fixa sem .sort()', async () => {
    seed({ items: [{ name: 'A', quantity: 1, unit_price: 10 }] })
    await edit({ status: 'completed', reported_defect: 'novo', items: [{ name: 'A', quantity: 2, unit_price: 10 }], responsible_employees: [{ employee_id: 'e1' }] })
    expect(events().map(e => e.event_type)).toEqual(['order.status_changed', 'order.fields_changed', 'order.items_changed', 'order.responsibles_changed'])
    expect(eventInserts()).toHaveLength(1)
    expect(new Set(events().map(e => e.correlation_id))).toEqual(new Set([RID]))
    expect(new Set(events().map(e => e.idempotency_key)).size).toBe(4)
  })
})

describe('[OSH-258] duplo clique / idempotência', () => {
  it('mesma edição 2x (mesmo e outro request id): 1 evento no total e 200 nas duas', async () => {
    seed()
    const a = await edit({ reported_defect: 'novo', status: 'completed' })
    const b = await edit({ reported_defect: 'novo', status: 'completed' })
    const c = await edit({ reported_defect: 'novo', status: 'completed' }, { rid: RID2 })
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200])
    expect(events()).toHaveLength(2) // status_changed + fields_changed da 1ª; nada nas demais
    expect(new Set(events().map(e => e.idempotency_key)).size).toBe(2)
  })
  it('edições distintas na mesma OS e requests distintos geram chaves distintas', async () => {
    seed()
    await edit({ reported_defect: 'a1' }, { rid: RID })
    await edit({ reported_defect: 'a2' }, { rid: RID2 })
    const keys = events('order.fields_changed').map(e => e.idempotency_key)
    expect(new Set(keys).size).toBe(2)
    expect(keys).toEqual([`order_fields_changed:${O}:${RID}`, `order_fields_changed:${O}:${RID2}`])
  })
})

describe('[OSH-261/262/263] falhas: histórico nunca muda a resposta; evento só após o passo confirmado', () => {
  const scenarios: Array<[string, () => Promise<{ status: number, body: unknown }>]> = [
    ['criar', () => call(POST, { body: { orderData: { number: 'NNN' } } })],
    ['editar campos', () => edit({ reported_defect: 'x' })],
    ['editar itens', () => edit({ items: [{ name: 'Z', quantity: 1, unit_price: 1 }] })],
    ['trocar status', () => edit({ status: 'completed' })]
  ]
  const stripIds = (b: unknown) => JSON.parse(JSON.stringify(b ?? null), (k, v) => (['id', 'created_at', 'updated_at'].includes(k) ? undefined : v))

  it.each(scenarios)('%s: resposta idêntica com insert de eventos lançando ou devolvendo erro', async (_n, run) => {
    seed()
    const base = await run()
    expect(base.status).toBe(200)
    for (const mode of ['throw', 'error'] as const) {
      seed()
      breakEvents(mode)
      const res = await run()
      expect(res.status).toBe(base.status)
      expect(stripIds(res.body)).toEqual(stripIds(base.body))
    }
  })

  it('o estado da OS persiste mesmo sem histórico (edição por campos, itens e status)', async () => {
    seed()
    breakEvents('error')
    await edit({ reported_defect: 'persistiu', status: 'completed', items: [{ name: 'Z', quantity: 1, unit_price: 1 }] })
    expect(stored()).toMatchObject({ reported_defect: 'persistiu', status: 'completed' })
    expect(events()).toHaveLength(0)
  })

  it('OSH-262: update da OS falha => 500 e ZERO eventos', async () => {
    seed()
    const real = fake.client.from.bind(fake.client)
    let n = 0
    ;(fake.client as any).from = (t: string) => { if (t === 'service_orders' && ++n === 2) fake.failNext(t, 'update falhou'); return real(t) }
    const res = await edit({ reported_defect: 'x', status: 'completed' })
    expect(res.status).toBe(500)
    expect(events()).toHaveLength(0)
    expect(stored().reported_defect).toBe('barulho')
  })

  it('OSH-263: exceção no diff é contida: OS salva, 200, sem evento parcial, erro logado', async () => {
    seed()
    boom.diff = true
    const res = await edit({ reported_defect: 'x', status: 'completed' })
    expect(res.status).toBe(200)
    expect(stored().reported_defect).toBe('x')
    expect(events()).toHaveLength(0)
    expect(console.error).toHaveBeenCalled()
  })
})

describe('[OSH-223/271] leitor só com orders.read vê a mudança de item sem comissão', () => {
  it('linha gravada e resposta do GET history sem nenhum vestígio de comissão', async () => {
    seed({
      items: [{ id: 'it-1', name: 'Troca de óleo', quantity: 1, unit_price: 300, commissions: [{ employee_id: 'e1', amount: 4321 }], commission_total: 4321 }],
      responsible_employees: [{ employee_id: 'e1' }]
    })
    await edit({ items: [{ id: 'it-1', name: 'Troca de óleo', quantity: 1, unit_price: 350, commissions: [{ employee_id: 'e1', amount: 9876 }], commission_total: 9876 }] }, { headers: { 'x-origin': 'os_form' } })
    const items = events('order.items_changed')
    expect(items).toHaveLength(1)
    expect(items[0]!.visibility).toBe('general')
    expect(JSON.stringify(events())).not.toMatch(/commission|4321|9876/i)
    // leitor restrito
    const ids = ['orders.read', 'orders.history'].map(c => (fake.tables.actions as Row[]).find(a => a.code === c)!.id)
    ;(fake.tables.role_actions as Row[]).splice(0, (fake.tables.role_actions as Row[]).length, ...ids.map(id => ({ role_id: 'r-com', action_id: id, is_granted: true })))
    login('com')
    const res = await call(HISTORY, { method: 'GET' })
    expect(res.status).toBe(200)
    const json = JSON.stringify(res.body)
    expect(json).toContain('Troca de óleo')
    expect(json).toContain('R$ 300,00')
    expect(json).toContain('R$ 350,00')
    expect(json).not.toMatch(/commission|comiss|4321|9876|"e1"/i)
  })
})

describe('DELETE service-orders/:id [OSH-300/304/305/306/307]', () => {
  it('OSH-300: evento com número em snapshot e visibilidade general; após a exclusão o GET history dá 404 e o evento permanece', async () => {
    seed()
    expect((await call(DEL, { method: 'DELETE', headers: { 'x-origin': 'os_list' } })).status).toBe(200)
    expect(events('order.deleted')).toHaveLength(1)
    expect(events('order.deleted')[0]).toMatchObject({ visibility: 'general', payload: { order_number: 'OS1' }, service_order_id: O })
    expect(stored().deleted_at).toBeTruthy()
    expect((await call(HISTORY, { method: 'GET' })).status).toBe(404)
    expect(events('order.deleted')).toHaveLength(1) // preservado
  })

  it('OSH-307: os_list/os_detail declarados; financial_bulk/= mismatch; valor fora do catálogo = inferida (origem inferida os_detail)', async () => {
    const out: Array<[string, string]> = []
    for (const h of ['os_list', 'os_detail', 'financial_bulk', '<script>']) {
      seed()
      await call(DEL, { method: 'DELETE', headers: { 'x-origin': h } })
      out.push([events('order.deleted')[0]!.source_code, events('order.deleted')[0]!.source_trust])
    }
    expect(out).toEqual([['os_list', 'declared'], ['os_detail', 'declared'], ['os_detail', 'mismatch'], ['os_detail', 'inferred']])
  })

  it('OSH-304: inexistente, já excluída e de outra org => 404, zero eventos', async () => {
    seed()
    for (const id of ['nao-existe', 'ob']) expect((await call(DEL, { method: 'DELETE', id })).status).toBe(404)
    expect(events()).toHaveLength(0)
    expect((fake.tables.service_orders as Row[]).find(r => r.id === 'ob')!.deleted_at).toBeNull()
    seed({ deleted_at: '2026-11-01T00:00:00Z' })
    expect((await call(DEL, { method: 'DELETE' })).status).toBe(404)
    expect(events()).toHaveLength(0)
  })

  it('OSH-305: falha ao gravar o evento não muda a resposta nem a exclusão', async () => {
    seed()
    const base = await call(DEL, { method: 'DELETE' })
    seed()
    breakEvents('throw')
    const res = await call(DEL, { method: 'DELETE' })
    expect(res.status).toBe(base.status)
    expect(res.body).toEqual(base.body)
    expect(stored().deleted_at).toBeTruthy()
    expect(events()).toHaveLength(0)
  })

  it('OSH-306: duplo clique => 2ª chamada 404 e total de order.deleted = 1', async () => {
    seed()
    expect((await call(DEL, { method: 'DELETE', rid: RID })).status).toBe(200)
    expect((await call(DEL, { method: 'DELETE', rid: RID2 })).status).toBe(404)
    expect(events('order.deleted')).toHaveLength(1)
  })

  it('sem orders.delete: 403, zero eventos, OS não excluída, independente do header', async () => {
    seed()
    ;(fake.tables.role_actions as Row[]).length = 0
    login('com')
    expect((await call(DEL, { method: 'DELETE', headers: { 'x-origin': 'os_list' } })).status).toBe(403)
    expect(events()).toHaveLength(0)
    expect(stored().deleted_at).toBeNull()
  })
})

describe('[M2] construtor de evento lançando e leitura de nomes falhando: resposta e estado idênticos', () => {
  const strip = (b: unknown) => JSON.parse(JSON.stringify(b ?? null), (k, v) => (['id', 'created_at', 'updated_at'].includes(k) ? undefined : v))
  const snapshotOrders = () => strip((fake.tables.service_orders as Row[]).map(r => ({ ...r })))
  const failNames = () => {
    const real = fake.client.from.bind(fake.client)
    ;(fake.client as any).from = (t: string) => { if (['clients', 'vehicles', 'employees', 'master_products'].includes(t)) throw new Error('names down'); return real(t) }
  }
  const editBody = { client_id: 'cl2', vehicle_id: 'v2', reported_defect: 'novo', status: 'completed', responsible_employees: [{ employee_id: 'e1' }], items: [{ name: 'Z', quantity: 1, unit_price: 9 }] }

  it('edição: baseline x builder lança x diff lança x nomes falham => mesmo status, corpo e OS gravada', async () => {
    seed()
    const base = await edit(editBody)
    const baseState = snapshotOrders()
    expect(base.status).toBe(200)
    expect(events().length).toBeGreaterThanOrEqual(4)
    const variants: Array<[string, () => void]> = [
      ['builder', () => { boom.update = true }],
      ['diff', () => { boom.diff = true }],
      ['nomes', () => failNames()]
    ]
    for (const [name, arm] of variants) {
      seed(); boom.update = false; boom.diff = false
      arm()
      const res = await edit(editBody)
      expect(res.status, name).toBe(base.status)
      expect(strip(res.body), name).toEqual(strip(base.body))
      expect(snapshotOrders(), name).toEqual(baseState)
      if (name !== 'nomes') expect(events(), name).toHaveLength(0)
      else expect(JSON.stringify(events())).not.toMatch(/cl1|cl2|"v1"|"v2"|"e1"/) // sem nome => fallback, nunca id cru
    }
  })

  it('criação: builder de order.created lançando e leitura falhando => mesma resposta e OS criada', async () => {
    const create = () => call(POST, { body: { orderData: { number: 'NEW1', client_id: 'cl1' } } })
    seed()
    const base = await create()
    expect(base.status).toBe(200)
    expect(events('order.created')).toHaveLength(1)
    const created = (fake.tables.service_orders as Row[]).filter(r => r.number === 'NEW1')
    expect(created).toHaveLength(1)
    for (const arm of [() => { boom.created = true }, () => breakEvents('throw'), () => breakEvents('error')]) {
      seed(); boom.created = false
      arm()
      const res = await create()
      expect(res.status).toBe(base.status)
      expect(strip(res.body)).toEqual(strip(base.body))
      expect((fake.tables.service_orders as Row[]).filter(r => r.number === 'NEW1')).toHaveLength(1)
      expect(events()).toHaveLength(0)
    }
  })
})

describe('[M1] gate financeiro ponta a ponta: order.payment_terms_changed', () => {
  const grant = (...codes: string[]) => {
    const ids = codes.map(c => (fake.tables.actions as Row[]).find(a => a.code === c)!.id)
    ;(fake.tables.role_actions as Row[]).splice(0, (fake.tables.role_actions as Row[]).length, ...ids.map(id => ({ role_id: 'r-com', action_id: id, is_granted: true })))
    login('com')
  }
  const SECRETS = /987,65|55,5|Dinheiro|Cartão|Pix|total_cost|terminal_fee|payment_method|installment_count/i

  it('gravado pelo POST de edição; orders.read NÃO vê (nem vestígio no JSON); orders.pay VÊ', async () => {
    seed({ total_cost_amount: 10, terminal_fee_amount: 1, payment_method: 'pix', is_installment: false, installment_count: 0 })
    await edit({ reported_defect: 'novo defeito', total_cost_amount: 987.65, terminal_fee_amount: 55.5, payment_method: 'cash', is_installment: true, installment_count: 3 })
    const fin = events('order.payment_terms_changed')
    expect(fin).toHaveLength(1)
    expect(fin[0]).toMatchObject({ visibility: 'financial', category: 'payment' })
    expect(events('order.fields_changed')).toHaveLength(1)
    expect(JSON.stringify(events('order.fields_changed'))).not.toMatch(SECRETS) // o evento general não carrega o financeiro

    grant('orders.read', 'orders.history')
    const readOnly = await call(HISTORY, { method: 'GET' })
    expect(readOnly.status).toBe(200)
    const roJson = JSON.stringify(readOnly.body)
    expect(roJson).toContain('novo defeito')
    expect(roJson).not.toMatch(SECRETS)
    expect((readOnly.body as { items: Array<{ title: string }> }).items.some(i => /pagamento/i.test(i.title))).toBe(false)
    expect((readOnly.body as { items: unknown[] }).items).toHaveLength(1)

    grant('orders.read', 'orders.history', 'orders.pay')
    const payer = await call(HISTORY, { method: 'GET' })
    expect(payer.status).toBe(200)
    const items = (payer.body as { items: Array<{ details: Array<{ label: string, from: string | null, to: string | null }> }> }).items
    expect(items).toHaveLength(2)
    const pj = JSON.stringify(payer.body)
    expect(pj).toMatch(/Dinheiro/)
    expect(pj).toMatch(/987,65/)
    expect(pj).not.toMatch(/total_cost|terminal_fee|payment_method|installment_count|"e1"/)
  })

  it('o gate também vale com paginação: orders.read não "sente" o evento omitido (hasMore/total)', async () => {
    seed({ total_cost_amount: 1 })
    await edit({ total_cost_amount: 987.65 })
    grant('orders.read', 'orders.history')
    const res = await call(HISTORY, { method: 'GET', query: { limit: 1 } })
    const b = res.body as { items: unknown[], hasMore?: boolean, nextCursor?: unknown }
    expect(b.items).toHaveLength(0)
    expect(b.hasMore ?? false).toBe(false)
    expect(b.nextCursor ?? null).toBeNull()
  })
})

describe('[B3] DELETE com construtor do evento lançando: resposta e exclusão idênticas', () => {
  it('builder lança / leitura falha => mesmo status e corpo; OS excluída; zero order.deleted', async () => {
    seed()
    const base = await call(DEL, { method: 'DELETE' })
    expect(base.status).toBe(200)
    expect(events('order.deleted')).toHaveLength(1)
    for (const arm of [() => { boom.deleted = true }, () => breakEvents('throw'), () => breakEvents('error')]) {
      seed(); boom.deleted = false
      arm()
      const res = await call(DEL, { method: 'DELETE' })
      expect(res.status).toBe(base.status)
      expect(res.body).toEqual(base.body)
      expect(stored().deleted_at).toBeTruthy()
      expect(events()).toHaveLength(0)
    }
  })
})
