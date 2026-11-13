// Histórico da OS (F3): agendamento vinculado à OS, resumo na exclusão e renderização. NFS-e fora de escopo.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { guardSeed, USERS } from '../../support/phase3-guard-fixture'
import { renderOsEvent } from '../../../server/utils/os-history/render'
import { OS_EVENT_CATALOG } from '../../../server/utils/os-history/events'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }
vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))
installNitroGlobals()
await installServerUtilsGlobals()

const POST = 'server/api/appointments/index.post.ts'
const PUT = 'server/api/appointments/[id].put.ts'
const DEL = 'server/api/appointments/[id].delete.ts'
const ODEL = 'server/api/service-orders/[id].delete.ts'
const RID = '33333333-3333-4333-8333-333333333333'
type Row = Record<string, any>

function seed(extra: Row = {}) {
  fake = createFakeSupabase(guardSeed(['appointments.create', 'appointments.update', 'appointments.delete', 'orders.delete'], {
    service_orders: [
      { id: 'oA', organization_id: 'org-a', number: 'OS1', deleted_at: null },
      { id: 'oA2', organization_id: 'org-a', number: 'OS2', deleted_at: null },
      { id: 'oB', organization_id: 'org-b', number: 'OS9', deleted_at: null }
    ],
    appointments: [
      { id: 'ap1', organization_id: 'org-a', service_order_id: 'oA', appointment_date: '2026-11-20', time: '08:00:00', status: 'scheduled', service_type: 'Revisão', deleted_at: null },
      { id: 'ap2', organization_id: 'org-a', service_order_id: null, appointment_date: '2026-11-21', time: '09:00', status: 'scheduled', service_type: 'Avulso', deleted_at: null }
    ],
    service_order_events: [], employee_financial_records: [], service_order_installments: [], financial_transactions: [], bank_account_statements: [],
    ...extra
  }))
  const u = USERS.admin
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}
const call = (file: string, o: { body?: unknown, headers?: Record<string, string>, id?: string, method?: string } = {}) => {
  const e = fakeEvent({ method: o.method ?? 'POST', cookies: { 'sb-access-token': 'tok' }, params: { id: o.id ?? 'ap1' }, body: o.body, headers: o.headers })
  ;(e as any).context = { audit: { requestId: RID, userId: USERS.admin.id, actorType: 'user' } }
  return callHandler(file, e)
}
const events = (type?: string): Row[] => ((fake.tables.service_order_events ?? []) as Row[]).filter(e => !type || e.event_type === type)
const base = { client_id: 'c1', vehicle_id: 'v1', appointment_date: '2026-11-22', time: '10:00', service_type: 'Revisão' }
const asRow = (e: Row) => ({ ...e, occurred_at: 'x' }) as any

beforeEach(() => { auth.refreshSession.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('appointments -> histórico da OS (F3)', () => {
  it('OSH-342: POST com service_order_id grava appointment.linked na OS, origem appointments; sem vínculo, zero eventos', async () => {
    seed()
    expect((await call(POST, { body: { ...base, service_order_id: 'oA' } })).status).toBe(200)
    const e = events('appointment.linked')
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ service_order_id: 'oA', organization_id: 'org-a', visibility: 'general', source_code: 'appointments', source_trust: 'inferred' })
    expect(e[0]!.payload).toMatchObject({ date: '2026-11-22', time: '10:00', created: true })
    seed()
    await call(POST, { body: base })
    expect(events()).toHaveLength(0)
  })

  it('OSH-346: vínculo com OS de outra organização não grava evento (agendamento segue como hoje)', async () => {
    seed()
    expect((await call(POST, { body: { ...base, service_order_id: 'oB' } })).status).toBe(200)
    expect(events()).toHaveLength(0)
    expect((await call(PUT, { method: 'PUT', id: 'ap2', body: { service_order_id: 'oB' } })).status).toBe(200)
    expect(events()).toHaveLength(0)
  })

  it('OSH-343: PUT data/hora gera 1 appointment.changed; reenvio igual, zero', async () => {
    seed()
    await call(PUT, { method: 'PUT', body: { appointment_date: '2026-11-22', time: '09:30' } })
    const e = events('appointment.changed')
    expect(e).toHaveLength(1)
    expect(e[0]!.payload.changes).toEqual([{ field: 'date', from: '2026-11-20', to: '2026-11-22' }, { field: 'time', from: '08:00', to: '09:30' }])
    expect(renderOsEvent(asRow(e[0]!)).description).toContain('data 20/11/2026 → 22/11/2026')
    await call(PUT, { method: 'PUT', body: { appointment_date: '2026-11-22', time: '09:30' } })
    expect(events()).toHaveLength(1)
  })

  it('PUT status cancelled gera appointment.cancelled (sem duplicar em changed)', async () => {
    seed()
    await call(PUT, { method: 'PUT', body: { status: 'cancelled' } })
    expect(events('appointment.cancelled')).toHaveLength(1)
    expect(events('appointment.changed')).toHaveLength(0)
  })

  it('OSH-344: trocar de OS gera unlinked na antiga e linked na nova; vincular avulso gera linked; desvincular gera unlinked', async () => {
    seed()
    await call(PUT, { method: 'PUT', body: { service_order_id: 'oA2' } })
    expect(events('appointment.unlinked').map(e => e.service_order_id)).toEqual(['oA'])
    expect(events('appointment.linked').map(e => e.service_order_id)).toEqual(['oA2'])
    expect(events('appointment.linked')[0]!.payload.created).toBe(false)
    await call(PUT, { method: 'PUT', id: 'ap2', body: { service_order_id: 'oA' } })
    expect(events('appointment.linked').map(e => e.service_order_id)).toEqual(['oA2', 'oA'])
    await call(PUT, { method: 'PUT', id: 'ap2', body: { service_order_id: null } })
    expect(events('appointment.unlinked')).toHaveLength(2)
  })

  it('PUT em agendamento avulso sem vínculo: zero eventos', async () => {
    seed()
    await call(PUT, { method: 'PUT', id: 'ap2', body: { time: '11:00' } })
    expect(events()).toHaveLength(0)
  })

  it('OSH-345: DELETE vinculado grava appointment.removed; avulso, zero', async () => {
    seed()
    expect((await call(DEL, { method: 'DELETE' })).status).toBe(200)
    expect(events('appointment.removed')).toHaveLength(1)
    expect(events('appointment.removed')[0]!.service_order_id).toBe('oA')
    await call(DEL, { method: 'DELETE', id: 'ap2' })
    expect(events()).toHaveLength(1)
  })

  it('OSH-348: falha ao gravar evento não derruba criar/alterar/excluir', async () => {
    seed()
    const orig = fake.client.from.bind(fake.client)
    ;(fake.client as any).from = (t: string) => (t === 'service_order_events' ? { upsert: () => Promise.resolve({ error: { message: 'boom' } }) } : orig(t))
    expect((await call(POST, { body: { ...base, service_order_id: 'oA' } })).status).toBe(200)
    expect((await call(PUT, { method: 'PUT', body: { time: '12:00' } })).status).toBe(200)
    expect((await call(DEL, { method: 'DELETE' })).status).toBe(200)
  })
})

describe('DELETE service-orders com efeitos (F3, OSH-301)', () => {
  it('order.deleted leva só contagens (sem valores nem ids)', async () => {
    seed({
      employee_financial_records: [{ id: 'r1', organization_id: 'org-a', service_order_id: 'oA', record_type: 'commission', amount: 45, status: 'paid', employee_id: 'e1', financial_transaction_id: null }],
      service_order_installments: [{ id: 'i1', organization_id: 'org-a', service_order_id: 'oA', amount: 100, status: 'paid', financial_transaction_id: null }]
    })
    expect((await call(ODEL, { method: 'DELETE', id: 'oA' })).status).toBe(200)
    const e = events()
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ event_type: 'order.deleted', visibility: 'general' })
    expect(e[0]!.payload).toEqual({ order_number: 'OS1', removed: { installments: 1, receipts: 0, transactions: 0, commissions: 1 } })
    expect(JSON.stringify(e[0]!.payload)).not.toMatch(/45|e1|r1|i1/)
    expect(renderOsEvent(asRow(e[0]!)).description).toMatch(/^OS nº OS1 excluída por .+\. Removidos junto: 1 parcela, 1 comissão\.$/)
  })
})

describe('catálogo F3', () => {
  it('todo appointment.* é general, categoria order, e renderizado', () => {
    for (const t of Object.keys(OS_EVENT_CATALOG).filter(k => k.startsWith('appointment.'))) {
      expect(OS_EVENT_CATALOG[t as keyof typeof OS_EVENT_CATALOG]).toMatchObject({ visibility: 'general', category: 'order' })
      const r = renderOsEvent({ id: 'x', occurred_at: 'x', event_type: t, schema_version: 1, category: 'order', actor_name: 'Maria', payload: { date: '2026-11-20', time: '08:00', changes: [{ field: 'status', from: 'scheduled', to: 'confirmed' }] }, correlation_id: 'c', source_code: 'appointments', source_label: 'Agenda' })
      expect(r.title, t).not.toBe('Evento registrado')
      expect(r.description).toContain('Maria')
    }
  })
})
