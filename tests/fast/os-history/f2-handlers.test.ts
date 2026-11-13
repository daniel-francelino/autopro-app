// Histórico da OS (F2): handlers POST service-orders (criar/editar/status) e DELETE service-orders/:id.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { guardSeed, USERS } from '../../support/phase3-guard-fixture'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }
vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))
installNitroGlobals()
await installServerUtilsGlobals()

const POST = 'server/api/service-orders/index.post.ts'
const DEL = 'server/api/service-orders/[id].delete.ts'
const RID = '33333333-3333-4333-8333-333333333333'
const O = 'o1'
type Row = Record<string, any>

const order = (over: Row = {}): Row => ({
  id: O, organization_id: 'org-a', number: 'OS1', status: 'open', client_id: 'cl1', vehicle_id: 'v1', employee_responsible_id: null,
  responsible_employees: [], items: [], discount: 0, total_amount: 100, reported_defect: 'barulho', entry_date: '2026-11-01', deleted_at: null, ...over
})
function seed(orderOver: Row = {}, codes = ['orders.update', 'orders.create', 'orders.delete']) {
  fake = createFakeSupabase(guardSeed(codes, {
    service_orders: [order(orderOver)],
    clients: [{ id: 'cl1', organization_id: 'org-a', name: 'Ana' }, { id: 'cl2', organization_id: 'org-a', name: 'Beto' }],
    vehicles: [{ id: 'v1', organization_id: 'org-a', brand: 'VW', model: 'Gol', license_plate: 'ABC1D23' }, { id: 'v2', organization_id: 'org-a', brand: 'Fiat', model: 'Uno', license_plate: 'XYZ9K88' }],
    employees: [{ id: 'e1', organization_id: 'org-a', name: 'Carlos' }],
    service_order_events: [], employee_financial_records: [], service_order_installments: [], financial_transactions: [], bank_account_statements: []
  }))
  const u = USERS.admin
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}
const call = (file: string, o: { body?: unknown, headers?: Record<string, string>, method?: string } = {}) => {
  const e = fakeEvent({ method: o.method ?? 'POST', cookies: { 'sb-access-token': 'tok' }, params: { id: O }, body: o.body, headers: o.headers })
  ;(e as any).context = { audit: { requestId: RID, userId: USERS.admin.id, actorType: 'user' } }
  return callHandler(file, e)
}
const events = (type?: string): Row[] => ((fake.tables.service_order_events ?? []) as Row[]).filter(e => !type || e.event_type === type)
const edit = (orderData: Row, headers?: Record<string, string>) => call(POST, { body: { orderId: O, orderData }, headers })

beforeEach(() => { auth.refreshSession.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('POST service-orders (F2)', () => {
  it('OSH-200: criação grava order.created (general) e origem os_form por padrão', async () => {
    seed()
    const res = await call(POST, { body: { orderData: { number: 'OS9', client_id: 'cl1' } } })
    expect(res.status).toBe(200)
    const e = events('order.created')
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ visibility: 'general', category: 'order', source_code: 'os_form', source_trust: 'inferred', correlation_id: RID })
    expect(e[0]!.payload).toEqual({ order_number: 'OS9' })
    expect(e[0]!.idempotency_key).toMatch(/^order_created:/)
  })

  it('OSH-207: reenvio idêntico não gera evento', async () => {
    seed()
    await edit({ reported_defect: 'barulho', discount: '0', client_id: 'cl1' })
    expect(events()).toHaveLength(0)
  })

  it('OSH-208/240/241: campos, cliente e veículo viram nomes (sem ids), um evento fields_changed', async () => {
    seed()
    await edit({ reported_defect: 'barulho e perda', client_id: 'cl2', vehicle_id: 'v2' }, { 'x-origin': 'os_form' })
    const e = events('order.fields_changed')
    expect(e).toHaveLength(1)
    expect(e[0]!.source_trust).toBe('declared')
    expect(e[0]!.payload.changes).toEqual([
      { field: 'reported_defect', from: 'barulho', to: 'barulho e perda' },
      { field: 'client', from: 'Ana', to: 'Beto' },
      { field: 'vehicle', from: 'VW Gol (ABC1D23)', to: 'Fiat Uno (XYZ9K88)' }
    ])
    expect(JSON.stringify(e[0])).not.toMatch(/cl1|cl2|"v1"|"v2"/)
  })

  it('OSH-245/252/253: status gera status_changed sem duplicar em fields_changed; os_list aceita; origem alheia = mismatch', async () => {
    seed()
    await edit({ status: 'in_progress' }, { 'x-origin': 'os_list' })
    expect(events().map(e => e.event_type)).toEqual(['order.status_changed'])
    expect(events()[0]).toMatchObject({ source_code: 'os_list', source_trust: 'declared', payload: { from: 'open', to: 'in_progress' } })
    await edit({ status: 'completed' }, { 'x-origin': 'financial_bulk' })
    expect(events('order.status_changed')[1]).toMatchObject({ source_code: 'os_form', source_trust: 'mismatch' })
  })

  it('itens: um evento items_changed, sem comissão/custo, mesmo correlation_id dos demais', async () => {
    seed({ items: [{ name: 'Filtro', quantity: 1, unit_price: 35, cost_price: 10 }] })
    await edit({ items: [{ name: 'Filtro', quantity: 3, unit_price: 35, cost_price: 10 }, { name: 'Óleo', quantity: 1, unit_price: 50 }], discount: 5 })
    const it = events('order.items_changed')
    expect(it).toHaveLength(1)
    expect(it[0]!.category).toBe('items')
    expect(it[0]!.payload.lines).toHaveLength(2)
    expect(JSON.stringify(it[0]).toLowerCase()).not.toMatch(/commission|cost/)
    expect(events().every(e => e.correlation_id === RID)).toBe(true)
    const f = events('order.fields_changed')[0]!.payload.changes as Row[]
    expect(f.find(c => c.field === 'discount')).toEqual({ field: 'discount', from: 0, to: 5 })
  })

  it('responsáveis: nome em snapshot, sem id nem comissão', async () => {
    seed()
    await edit({ responsible_employees: [{ employee_id: 'e1', commission_percent: 10 }] })
    const e = events('order.responsibles_changed')
    expect(e).toHaveLength(1)
    expect(e[0]!.payload).toEqual({ added: ['Carlos'], removed: [] })
  })

  it('falha ao gravar evento não derruba a edição nem muda a resposta', async () => {
    seed()
    const real = fake.client.from.bind(fake.client)
    ;(fake.client as any).from = (t: string) => { if (t === 'service_order_events') throw new Error('events down'); return real(t) }
    const res = await edit({ reported_defect: 'novo' })
    expect(res.status).toBe(200)
    expect((fake.tables.service_orders as Row[])[0]!.reported_defect).toBe('novo')
  })
})

describe('DELETE service-orders/:id (F2)', () => {
  it('grava order.deleted com número, origem os_detail por padrão, idempotência por request', async () => {
    seed()
    const res = await call(DEL, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const e = events('order.deleted')
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ visibility: 'general', source_code: 'os_detail', idempotency_key: `order_deleted:${O}:${RID}`, payload: { order_number: 'OS1' } })
    expect((fake.tables.service_orders as Row[])[0]!.deleted_at).toBeTruthy()
  })
  it('origem os_list declarada é aceita', async () => {
    seed()
    await call(DEL, { method: 'DELETE', headers: { 'x-origin': 'os_list' } })
    expect(events('order.deleted')[0]).toMatchObject({ source_code: 'os_list', source_trust: 'declared' })
  })
})
