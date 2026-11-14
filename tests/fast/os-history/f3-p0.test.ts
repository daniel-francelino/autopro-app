// Histórico da OS (F3, sem NFS-e): P0 complementar a f3-handlers.test.ts (OSH-3xx).
// Agendamento (payload/tenant/falhas), order.deleted com resumo, comissão manual via rota, estático.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { seedOrganizations } from '../../support/organizations-fixture'
import { guardSeed, USERS } from '../../support/phase3-guard-fixture'
import { renderOsEvent } from '../../../server/utils/os-history/render'
import { OS_EVENT_CATALOG } from '../../../server/utils/os-history/events'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }
vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))
vi.mock('../../../server/utils/employee-commission-plans', () => ({
  resolveEmployeeCommissionRulesForEmployees: vi.fn(async (_s: unknown, _o: string, ids: string[]) =>
    new Map(ids.map(id => [id, [{ id: 'r', plan_id: 'p', version_id: 'v', name: '10%', commission_type: 'percentage', commission_amount: 10, commission_base: 'revenue', category_ids: [], is_default: true }]]))),
  resolveCommissionPlanRules: vi.fn(async () => [{ id: 'r2', plan_id: 'plan-x', version_id: 'v', name: '20%', commission_type: 'percentage', commission_amount: 20, commission_base: 'revenue', category_ids: [], is_default: true }]),
  fetchCommissionPlan: vi.fn(async (_s: unknown, _o: string, id: string) => (id === 'plan-x' ? { id: 'plan-x', name: 'Plantão', active: true } : null))
}))
installNitroGlobals()
await installServerUtilsGlobals()

const ROOT = process.cwd()
const POST = 'server/api/appointments/index.post.ts'
const PUT = 'server/api/appointments/[id].put.ts'
const DEL = 'server/api/appointments/[id].delete.ts'
const ODEL = 'server/api/service-orders/[id].delete.ts'
const OPOST = 'server/api/service-orders/index.post.ts'
const GEN = 'server/api/service-orders/[id]/generate-commissions.post.ts'
const AP1 = '00000000-0000-4000-8000-0000000000a1'
const RID = '55555555-5555-4555-8555-555555555555'
type Row = Record<string, any>

function seed(extra: Row = {}) {
  fake = createFakeSupabase(guardSeed(['appointments.create', 'appointments.update', 'appointments.delete', 'orders.delete', 'orders.create', 'orders.update'], {
    organizations: seedOrganizations('full'),
    service_orders: [
      { id: 'oA', organization_id: 'org-a', number: 'OS1', status: 'completed', total_amount: 1000, discount: 0, total_taxes_amount: 0, entry_date: '2026-11-01', deleted_at: null, commission_release_mode: 'proportional', commission_manual_adjustments_log: [], responsible_employees: [{ employee_id: 'e1' }], items: [{ id: 'it1', total_price: 1000, cost_price: 0, quantity: 1, category_id: null }] },
      { id: 'oA2', organization_id: 'org-a', number: 'OS2', deleted_at: null },
      { id: 'oDel', organization_id: 'org-a', number: 'OS3', deleted_at: '2026-01-01T00:00:00Z' },
      { id: 'oB', organization_id: 'org-b', number: 'OS9', deleted_at: null }
    ],
    appointments: [
      { id: AP1, organization_id: 'org-a', service_order_id: 'oA', appointment_date: '2026-11-20', time: '08:00:00', status: 'scheduled', service_type: 'Revisão', deleted_at: null, client_name: 'Fulano Cliente', phone: '11999990000', email: 'cli@x.com', client_id: 'c-secret' },
      { id: 'ap2', organization_id: 'org-a', service_order_id: null, appointment_date: '2026-11-21', time: '09:00', status: 'scheduled', service_type: 'Avulso', deleted_at: null }
    ],
    employees: [{ id: 'e1', organization_id: 'org-a', name: 'Ana', deleted_at: null }],
    service_order_events: [], employee_financial_records: [], service_order_installments: [], financial_transactions: [], bank_account_statements: [],
    ...extra
  }))
  const u = USERS.admin
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}
const call = (file: string, o: { body?: unknown, headers?: Record<string, string>, id?: string, method?: string, rid?: string, user?: string } = {}) => {
  const e = fakeEvent({ method: o.method ?? 'POST', cookies: { 'sb-access-token': 'tok' }, params: { id: o.id ?? AP1 }, body: o.body, headers: o.headers })
  ;(e as any).context = { audit: { requestId: o.rid ?? RID, userId: USERS.admin.id, actorType: 'user' } }
  return callHandler(file, e)
}
const put = (body: Row, id = AP1) => call(PUT, { method: 'PUT', id, body })
const events = (type?: string): Row[] => ((fake.tables.service_order_events ?? []) as Row[]).filter(e => !type || e.event_type === type)
const ap = (id = AP1) => (fake.tables.appointments as Row[]).find(a => a.id === id)!
const base = { client_id: 'c-secret', vehicle_id: 'v1', appointment_date: '2026-11-22', time: '10:00', service_type: 'Revisão' }
const asRow = (e: Row) => ({ ...e, occurred_at: 'x' }) as any
const breakEvents = (mode: 'error' | 'throw') => {
  const orig = fake.client.from.bind(fake.client)
  ;(fake.client as any).from = (t: string) => {
    if (t !== 'service_order_events') return orig(t)
    if (mode === 'throw') throw new Error('events down')
    return { upsert: () => Promise.resolve({ error: { message: 'boom' } }), insert: () => Promise.resolve({ error: { message: 'boom' } }) }
  }
}
/** Faz a N-ésima consulta (1-based) a `table` falhar. */
const failNth = (table: string, nth: number) => {
  const real = fake.client.from.bind(fake.client)
  let n = 0
  ;(fake.client as any).from = (t: string) => { if (t === table && ++n === nth) fake.failNext(t, 'boom'); return real(t) }
}
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')

beforeEach(() => { auth.refreshSession.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('agendamento: payload, chave, origem, visibilidade (OSH-340..345, P0)', () => {
  it('cada tipo: payload exato, visibilidade general, origem appointments, sem dados do cliente nem ids crus', async () => {
    seed()
    await call(POST, { body: { ...base, service_order_id: 'oA', notes: 'tel 11999990000', client_name: 'Fulano Cliente' } })
    await put({ appointment_date: '2026-11-25', time: '09:15', status: 'confirmed', service_type: 'Alinhamento' })
    await put({ status: 'cancelled' })
    await put({ service_order_id: 'oA2' })
    await call(DEL, { method: 'DELETE' })
    const byType = (t: string) => events(t)
    expect(byType('appointment.linked').map(e => e.payload)).toEqual([
      { date: '2026-11-22', time: '10:00', status: 'scheduled', created: true },
      { date: '2026-11-25', time: '09:15', status: 'cancelled', created: false }
    ])
    expect(byType('appointment.changed')[0]!.payload).toEqual({ changes: [
      { field: 'date', from: '2026-11-20', to: '2026-11-25' }, { field: 'time', from: '08:00', to: '09:15' },
      { field: 'status', from: 'scheduled', to: 'confirmed' }, { field: 'service_type', from: 'Revisão', to: 'Alinhamento' }
    ] })
    expect(byType('appointment.cancelled')[0]!.payload).toEqual({ date: '2026-11-25', time: '09:15' })
    expect(byType('appointment.unlinked')[0]!.payload).toEqual({ date: '2026-11-25', time: '09:15' })
    expect(byType('appointment.removed').map(e => e.service_order_id)).toEqual(['oA2']) // após a troca, a exclusão vale para a OS atual
  })

  it('removed leva data/hora/status; chaves idempotentes por tipo; todos general/appointments/inferred/order', async () => {
    seed()
    await call(DEL, { method: 'DELETE' })
    const e = events('appointment.removed')[0]!
    expect(e.payload).toEqual({ date: '2026-11-20', time: '08:00', status: 'scheduled' })
    expect(e).toMatchObject({ service_order_id: 'oA', entity_type: 'appointment', entity_id: AP1, visibility: 'general', category: 'order', source_code: 'appointments', source_trust: 'inferred', correlation_id: RID })
    expect(e.idempotency_key).toBe(`appointment_removed:${AP1}`)
  })

  it('nenhum evento/render contém nome, telefone, e-mail ou ids crus (payload e descrição)', async () => {
    seed()
    await call(POST, { body: { ...base, service_order_id: 'oA' } })
    await put({ time: '09:00', status: 'confirmed' })
    await put({ service_order_id: 'oA2' })
    await call(DEL, { method: 'DELETE' })
    expect(events().length).toBeGreaterThanOrEqual(4)
    for (const e of events()) {
      const s = JSON.stringify(e.payload) + renderOsEvent({ ...asRow(e), actor_name: 'Maria', source_code: 'appointments', source_label: 'Agenda' }).description
      expect(s, e.event_type).not.toMatch(/Fulano|11999990000|cli@x|c-secret|oA|org-a|v1/)
      expect(s, e.event_type).not.toContain(AP1)
    }
  })

  it('PUT com mudança de data JUNTO com troca de OS: só unlinked e linked (sem changed)', async () => {
    seed()
    await put({ service_order_id: 'oA2', appointment_date: '2026-12-01' })
    expect(events().map(e => e.event_type).sort()).toEqual(['appointment.linked', 'appointment.unlinked'])
    expect(events('appointment.unlinked')[0]).toMatchObject({ service_order_id: 'oA' })
    expect(events('appointment.linked')[0]).toMatchObject({ service_order_id: 'oA2' })
    expect(events('appointment.linked')[0]!.payload.date).toBe('2026-12-01')
  })

  it('OS excluída ou de outra organização: zero evento (caracterização; tenant do vínculo NÃO é do histórico)', async () => {
    for (const target of ['oDel', 'oB']) {
      seed()
      expect((await call(POST, { body: { ...base, service_order_id: target } })).status).toBe(200)
      expect((await put({ service_order_id: target }, 'ap2')).status).toBe(200)
      expect(events(), target).toHaveLength(0)
    }
    // trocar de OS válida para OS de outra org: unlinked na antiga, nenhum linked na estranha
    seed()
    await put({ service_order_id: 'oB' })
    expect(events().map(e => e.event_type)).toEqual(['appointment.unlinked'])
    expect(events().every(e => e.organization_id === 'org-a' && e.service_order_id === 'oA')).toBe(true)
  })

  it('agendamento de outra organização: 404, sem evento', async () => {
    seed({ appointments: [{ id: 'apB', organization_id: 'org-b', service_order_id: 'oB', appointment_date: '2026-11-20', time: '08:00', status: 'scheduled', service_type: 'X', deleted_at: null }] })
    expect((await put({ time: '10:00' }, 'apB')).status).toBe(404)
    expect(events()).toHaveLength(0)
  })

  it('campos desconhecidos no corpo não viram evento nem payload', async () => {
    seed()
    await put({ foo: 'bar', notes: 'segredo 123', priority: 'high' })
    expect(events()).toHaveLength(0)
    await put({ time: '11:00', foo: 'bar' })
    expect(JSON.stringify(events()[0]!.payload)).not.toMatch(/foo|bar|segredo/)
  })
})

describe('agendamento: falhas do histórico nunca mudam o resultado (OSH-348, P0)', () => {
  const snapshotState = () => JSON.stringify(fake.tables.appointments).replace(/"deleted_at":"20[^"]+"/g, '"deleted_at":"T"')
  const scenarios: Array<[string, () => Promise<any>]> = [
    ['POST', () => call(POST, { body: { ...base, service_order_id: 'oA' } })],
    ['PUT', () => put({ time: '12:00', status: 'cancelled' })],
    ['PUT troca de OS', () => put({ service_order_id: 'oA2' })],
    ['DELETE', () => call(DEL, { method: 'DELETE' })]
  ]
  for (const mode of ['error', 'throw'] as const) {
    it.each(scenarios)(`${mode}: %s tem mesma resposta, status e estado com e sem falha do evento`, async (_n, run) => {
      seed()
      const ok = await run()
      const okState = snapshotState().replace(/"id":"[0-9a-f-]{36}"/g, '"id":"X"')
      seed()
      breakEvents(mode)
      const bad = await run()
      expect(bad.status).toBe(ok.status)
      expect(JSON.stringify(bad.body).replace(/[0-9a-f-]{36}/g, 'X')).toBe(JSON.stringify(ok.body).replace(/[0-9a-f-]{36}/g, 'X'))
      expect(snapshotState().replace(/"id":"[0-9a-f-]{36}"/g, '"id":"X"')).toBe(okState)
    })
  }

  it('loadAppointmentSnap falhando (PUT/DELETE): operação segue, sem evento', async () => {
    seed()
    failNth('appointments', 2) // 1=existência, 2=snapshot
    const r = await put({ time: '12:00' })
    expect(r.status).toBe(200)
    expect(ap().time).toBe('12:00')
    expect(events()).toHaveLength(0)
    seed()
    failNth('appointments', 2)
    expect((await call(DEL, { method: 'DELETE' })).status).toBe(200)
    expect(ap().deleted_at).toBeTruthy()
    expect(events()).toHaveLength(0)
  })

  it('evento só após confirmação: update/insert/delete com erro => erro HTTP e zero eventos', async () => {
    seed()
    failNth('appointments', 3) // update do PUT
    expect((await put({ time: '12:00', service_order_id: 'oA2' })).status).toBe(500)
    expect(events()).toHaveLength(0)
    seed()
    failNth('appointments', 1) // insert
    expect((await call(POST, { body: { ...base, service_order_id: 'oA' } })).status).toBe(500)
    expect(events()).toHaveLength(0)
    seed()
    failNth('appointments', 3) // update (soft delete)
    expect((await call(DEL, { method: 'DELETE' })).status).toBe(500)
    expect(events()).toHaveLength(0)
  })
})

describe('POST service-orders com appointmentData (appointment.created)', () => {
  const create = () => call(OPOST, { body: { orderData: { number: 'N1', client_id: 'c1', vehicle_id: 'v1', entry_date: '2026-11-05' }, appointmentData: { appointment_date: '2026-11-10', time: '09:00' } } })
  it('agendamento inserido => 1 appointment.created na OS nova (general, sem ids no payload)', async () => {
    seed()
    const r = await create()
    expect(r.status).toBe(200)
    const e = events('appointment.created')
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ visibility: 'general', category: 'order' })
    expect(e[0]!.payload).toEqual({ date: '2026-11-10', time: '09:00', status: 'scheduled' })
  })
  it('insert do agendamento falhou => sem appointment.created (resposta 200 mantida)', async () => {
    seed()
    failNth('appointments', 1)
    expect((await create()).status).toBe(200)
    expect(events('appointment.created')).toHaveLength(0)
  })
  it('falha ao gravar o evento não muda a resposta', async () => {
    seed()
    const ok = await create()
    seed()
    breakEvents('throw')
    const bad = await create()
    expect(bad.status).toBe(ok.status)
    expect((fake.tables.appointments as Row[]).length).toBe(3)
  })
})

describe('chaves idempotentes exatas de appointment.* (M1)', () => {
  const R1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  const R2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  const putR = (body: Row, rid: string, id = AP1) => call(PUT, { method: 'PUT', id, body, rid })
  it('cada tipo usa tipo:ids:escopo (escopo = request id); created/removed só por id', async () => {
    seed()
    await call(POST, { body: { ...base, service_order_id: 'oA' }, rid: R1 })
    const newId = (fake.tables.appointments as Row[]).at(-1)!.id as string
    expect(events('appointment.linked')[0]!.idempotency_key).toBe(`appointment_linked:${newId}:oA:${R1}`)
    await putR({ service_order_id: 'oA2' }, R1) // ap1 (oA) -> oA2
    await putR({ time: '09:45' }, R1)
    await putR({ status: 'cancelled' }, R1)
    await call(DEL, { method: 'DELETE', rid: R1 })
    const key = (t: string, so: string) => events(t).filter(e => e.service_order_id === so).map(e => e.idempotency_key)
    expect(key('appointment.unlinked', 'oA')).toEqual([`appointment_unlinked:${AP1}:oA:${R1}`])
    expect(key('appointment.linked', 'oA2')).toEqual([`appointment_linked:${AP1}:oA2:${R1}`])
    expect(key('appointment.changed', 'oA2')).toEqual([`appointment_changed:${AP1}:${R1}`])
    expect(key('appointment.cancelled', 'oA2')).toEqual([`appointment_cancelled:${AP1}:${R1}`])
    expect(key('appointment.removed', 'oA2')).toEqual([`appointment_removed:${AP1}`])
  })
  it('appointment.created (OS + agendamento) usa appointment_created:<id> e created:false/true do linked vem do estado anterior', async () => {
    seed()
    await call(OPOST, { body: { orderData: { number: 'N1', client_id: 'c1', vehicle_id: 'v1', entry_date: '2026-11-05' }, appointmentData: { appointment_date: '2026-11-10', time: '09:00' } }, rid: R1 })
    const c = events('appointment.created')[0]!
    expect(c.idempotency_key).toBe(`appointment_created:${(fake.tables.appointments as Row[]).at(-1)!.id}`)
    seed()
    await putR({ service_order_id: 'oA2' }, R1, 'ap2')
    expect(events('appointment.linked')[0]).toMatchObject({ payload: expect.objectContaining({ created: false }) })
  })
  it('dois escopos diferentes geram chaves diferentes (sem colisão): alterações em requests distintos = 2 chaves; cancelamentos idem', async () => {
    seed()
    await putR({ time: '09:45' }, R1)
    await putR({ time: '10:15' }, R2)
    expect(events('appointment.changed').map(e => e.idempotency_key)).toEqual([`appointment_changed:${AP1}:${R1}`, `appointment_changed:${AP1}:${R2}`])
    seed()
    await putR({ status: 'cancelled' }, R1)
    const k1 = events('appointment.cancelled')[0]!.idempotency_key
    seed()
    await putR({ status: 'cancelled' }, R2)
    const k2 = events('appointment.cancelled')[0]!.idempotency_key
    expect([k1, k2]).toEqual([`appointment_cancelled:${AP1}:${R1}`, `appointment_cancelled:${AP1}:${R2}`])
    expect(k1).not.toBe(k2)
  })
})

describe('order.deleted com resumo (OSH-301, P0)', () => {
  const effects = () => ({
    employee_financial_records: [
      { id: 'r1', organization_id: 'org-a', service_order_id: 'oA', record_type: 'commission', amount: 45.5, status: 'pending', employee_id: 'e1', financial_transaction_id: null },
      { id: 'r2', organization_id: 'org-a', service_order_id: 'oA', record_type: 'commission', amount: 12, status: 'pending', employee_id: 'e1', financial_transaction_id: null }
    ],
    service_order_installments: [
      { id: 'i1', organization_id: 'org-a', service_order_id: 'oA', amount: 777, status: 'pending', financial_transaction_id: null },
      { id: 'i2', organization_id: 'org-a', service_order_id: 'oA', amount: 888, status: 'pending', financial_transaction_id: null },
      { id: 'i3', organization_id: 'org-a', service_order_id: 'oA', amount: 999, status: 'pending', financial_transaction_id: null }
    ]
  })
  it('sem efeitos: contagens zero; com efeitos: contagens corretas, sem valores nem ids', async () => {
    seed()
    expect((await call(ODEL, { method: 'DELETE', id: 'oA' })).status).toBe(200)
    expect(events('order.deleted')[0]!.payload).toEqual({ order_number: 'OS1', removed: { installments: 0, receipts: 0, transactions: 0, commissions: 0 } })
    seed(effects())
    await call(ODEL, { method: 'DELETE', id: 'oA' })
    const e = events()
    expect(e).toHaveLength(1)
    expect(e[0]!.payload.removed).toEqual({ installments: 3, receipts: 0, transactions: 0, commissions: 2 })
    expect(JSON.stringify(e[0]!.payload)).not.toMatch(/777|888|999|45\.5|\br1\b|\bi1\b|e1|oA/)
    expect(renderOsEvent(asRow(e[0]!)).description).toContain('3 parcelas, 2 comissões')
  })
  it('receipts e transactions NÃO zero: parcela com lançamento, comissão com lançamento, income e expense diretos', async () => {
    const T = (id: string, type: string, so: string | null) => ({ id, organization_id: 'org-a', service_order_id: so, type, status: 'paid', amount: 321.99, deleted_at: null, bank_account_id: null })
    seed({
      service_order_installments: [{ id: 'i1', organization_id: 'org-a', service_order_id: 'oA', amount: 555, status: 'paid', financial_transaction_id: 'tx-i' }],
      employee_financial_records: [{ id: 'r1', organization_id: 'org-a', service_order_id: 'oA', record_type: 'commission', amount: 44, status: 'paid', employee_id: 'e1', financial_transaction_id: 'tx-c' }],
      financial_transactions: [T('tx-i', 'income', null), T('tx-c', 'expense', null), T('tx-d1', 'income', 'oA'), T('tx-d2', 'expense', 'oA')]
    })
    expect((await call(ODEL, { method: 'DELETE', id: 'oA' })).status).toBe(200)
    const e = events('order.deleted')
    expect(e).toHaveLength(1)
    // receipts = parcela recebida (1) + entrada direta income (1); transactions = 4 lançamentos estornados
    expect(e[0]!.payload.removed).toEqual({ installments: 1, receipts: 2, transactions: 4, commissions: 1 })
    expect(JSON.stringify(e[0]!.payload)).not.toMatch(/555|321|tx-/)
    expect(renderOsEvent(asRow(e[0]!)).description).not.toMatch(/\d{3,}/)
  })
  it('exclusão e resposta idênticas com e sem falha do evento (erro e exceção)', async () => {
    seed(effects())
    const ok = await call(ODEL, { method: 'DELETE', id: 'oA' })
    const okTables = JSON.stringify([fake.tables.service_orders, fake.tables.employee_financial_records, fake.tables.service_order_installments])
    for (const mode of ['error', 'throw'] as const) {
      seed(effects())
      breakEvents(mode)
      const bad = await call(ODEL, { method: 'DELETE', id: 'oA' })
      expect(bad.status).toBe(ok.status)
      expect(bad.body).toEqual(ok.body)
      expect(JSON.stringify([fake.tables.service_orders, fake.tables.employee_financial_records, fake.tables.service_order_installments]).replace(/"deleted_at":"[^"]+"/g, '"deleted_at":"T"'))
        .toBe(okTables.replace(/"deleted_at":"[^"]+"/g, '"deleted_at":"T"'))
    }
  })
  it('OS de outra organização: não exclui e não grava evento', async () => {
    seed()
    expect((await call(ODEL, { method: 'DELETE', id: 'oB' })).status).toBe(404)
    expect((fake.tables.service_orders as Row[]).find(o => o.id === 'oB')!.deleted_at).toBeNull()
    expect(events()).toHaveLength(0)
  })
})

describe('comissão manual via rota generate-commissions (F1 coberta no util; aqui o handler)', () => {
  const pending = (n: number, amount: number) => ({ id: `rm${n}`, organization_id: 'org-a', service_order_id: 'oA', employee_id: 'e1', record_type: 'commission', status: 'pending', amount, created_at: `2026-11-0${n}T10:00:00Z` })
  const gen = (body: Row) => call(GEN, { id: 'oA', body })
  const seedManual = () => seed({
    service_order_installments: [{ id: 'ip', organization_id: 'org-a', service_order_id: 'oA', amount: 500, status: 'paid', deleted_at: null }],
    employee_financial_records: [pending(1, 20), pending(2, 10)]
  })
  it('employeeId+reason: 1 commission.recalculated (de→para, justificativa), visibilidade commission, sem released', async () => {
    seedManual()
    const r = await gen({ employeeId: 'e1', reason: 'ajuste do gerente' })
    expect(r.status).toBe(200)
    expect(events().map(e => e.event_type)).toEqual(['commission.recalculated'])
    expect(events()[0]).toMatchObject({ visibility: 'commission', category: 'commission', source_code: 'os_detail', service_order_id: 'oA' })
    expect(events()[0]!.payload).toEqual({ employee_name: 'Ana', previous_amount: 30, new_amount: 50, reason: 'ajuste do gerente', override_action: null, override_plan_name: null })
  })
  it('override apply: payload com override_action=apply e nome do plano; remove em seguida registra remove', async () => {
    seedManual()
    await gen({ employeeId: 'e1', reason: 'plantão', override: { action: 'apply', commissionPlanId: 'plan-x' } })
    const a = events('commission.recalculated')
    expect(a).toHaveLength(1)
    expect(a[0]!.payload).toMatchObject({ reason: 'plantão', override_action: 'apply', override_plan_name: 'Plantão' })
    expect(events('commission.released')).toHaveLength(0)
    await gen({ employeeId: 'e1', reason: 'fim do plantão', override: { action: 'remove' } })
    const all = events('commission.recalculated')
    expect(all).toHaveLength(2)
    expect(all[1]!.payload).toMatchObject({ reason: 'fim do plantão', override_action: 'remove' })
    expect(all.every(e => e.visibility === 'commission')).toBe(true)
  })
  it('update do log de ajuste manual falhando: zero eventos (rota)', async () => {
    seedManual()
    failNth('service_orders', 3) // 1=select, 2=snapshot de itens, 3=log
    await gen({ employeeId: 'e1', reason: 'x' })
    expect(events()).toHaveLength(0)
  })
  it('sem motivo (400): zero eventos; falha do evento (exceção) não muda a resposta', async () => {
    seedManual()
    expect((await gen({ employeeId: 'e1', reason: '' })).status).toBe(400)
    expect(events()).toHaveLength(0)
    seedManual()
    const ok = await gen({ employeeId: 'e1', reason: 'x' })
    seedManual()
    breakEvents('throw')
    const bad = await gen({ employeeId: 'e1', reason: 'x' })
    expect(bad.status).toBe(ok.status)
    const norm = (b: unknown) => JSON.stringify(b).replace(/"recalculated_at":"[^"]+"/g, '"recalculated_at":"T"')
    expect(norm(bad.body)).toBe(norm(ok.body))
  })
})

describe('estático F3', () => {
  const handlers = [POST, PUT, DEL]
  it('handlers de agendamento passam historyContext(appointments) e importam só o necessário', () => {
    for (const f of handlers) {
      const s = read(f)
      expect(s, f).toMatch(/historyContext\(event, OS_SOURCE_POLICIES\.appointments\)/)
      expect(s, f).toMatch(/recordWithContext\(history, supabase,/)
      const imports = [...s.matchAll(/from '([^']*os-history[^']*)'/g)].map(m => m[1])
      expect(imports.sort(), f).toEqual(['../../utils/os-history/appointment-events', '../../utils/os-history/events'])
      expect(s, f).not.toMatch(/os-history\/(render|diff|order-events|record|sources)/)
      expect(s, f).not.toMatch(/service_order_events/)
    }
  })
  it('importadores de os-history em server/api de agendamento: ratchet (só estes 3)', () => {
    const files = ['index.post.ts', '[id].put.ts', '[id].delete.ts', 'index.get.ts']
    const imp = files.filter(f => /os-history/.test(read(`server/api/appointments/${f}`)))
    expect(imp).toEqual(['index.post.ts', '[id].put.ts', '[id].delete.ts'])
  })
  it('todo appointment.* tem renderizador, visibilidade general e categoria order; política appointments existe', () => {
    const types = Object.keys(OS_EVENT_CATALOG).filter(k => k.startsWith('appointment.')).sort()
    expect(types).toEqual(['appointment.cancelled', 'appointment.changed', 'appointment.created', 'appointment.linked', 'appointment.removed', 'appointment.unlinked'])
    const render = read('server/utils/os-history/render.ts')
    for (const t of types) {
      expect(render, t).toContain(`'${t}'`)
      expect(OS_EVENT_CATALOG[t as keyof typeof OS_EVENT_CATALOG]).toMatchObject({ visibility: 'general', category: 'order' })
    }
    expect(read('server/utils/os-history/events.ts')).toMatch(/appointments\s*:/)
  })
})

describe('perguntas de negócio abertas (F3)', () => {
  it.todo('Q27: agendamento criado já vinculado deve gerar `created` ou `linked` (hoje: `linked` com created:true; via OS: `created`)?')
  it.todo('`changed` deve incluir mudança de tipo de serviço (hoje inclui service_type de→para)?')
  it.todo('contagem de comissões em order.deleted deve ser visível em `general` (hoje general)?')
})
