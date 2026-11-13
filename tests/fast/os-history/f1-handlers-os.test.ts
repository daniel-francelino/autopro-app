// Histórico da OS (F1): eventos gravados pelos handlers DENTRO da OS (cancel, payment.delete, process-payment,
// down-payment, receive-extra-payment, generate-commissions, installments/:id DELETE, financial-transactions/:id DELETE).
// Handlers reais + fake supabase. Cobre OSH-104/105/106/108/109/110/125/140-145/150-152/160-161.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { guardSeed, USERS, type Persona } from '../../support/phase3-guard-fixture'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const D = 'server/api/service-orders/[id]/'
const F = {
  cancel: `${D}cancel.post.ts`,
  paymentDelete: `${D}payment.delete.ts`,
  process: `${D}process-payment.post.ts`,
  down: `${D}down-payment.post.ts`,
  extra: `${D}receive-extra-payment.post.ts`,
  generate: `${D}generate-commissions.post.ts`,
  instDelete: `${D}installments/[installmentId].delete.ts`,
  txDelete: `${D}financial-transactions/[transactionId].delete.ts`
}

const RID = '33333333-3333-4333-8333-333333333333'
const O = 'o1'
const INST1 = '00000000-0000-4000-8000-0000000000b1'
const INST2 = '00000000-0000-4000-8000-0000000000b2'
const TX1 = '00000000-0000-4000-8000-0000000000d1'
const TX2 = '00000000-0000-4000-8000-0000000000d2'
const REC1 = '00000000-0000-4000-8000-0000000000a1'
const REC2 = '00000000-0000-4000-8000-0000000000a2'

type Row = Record<string, any>
const login = (persona: Persona = 'admin') => {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

const order = (over: Row = {}): Row => ({
  id: O, organization_id: 'org-a', number: 'OS1', status: 'completed', total_amount: 300, discount: 0, payment_status: 'pending',
  entry_date: '2026-11-01', deleted_at: null, commission_release_mode: null, commission_manual_adjustments_log: [], responsible_employees: [], items: [], ...over
})
const inst = (id: string, n: number, over: Row = {}): Row => ({
  id, organization_id: 'org-a', service_order_id: O, kind: 'installment', installment_number: n, amount: 150, status: 'pending', due_date: '2026-12-01', deleted_at: null, ...over
})
const tx = (id: string, over: Row = {}): Row => ({
  id, organization_id: 'org-a', type: 'income', status: 'paid', amount: 150, due_date: '2026-11-10', description: 'Recebimento', bank_account_id: 'ba1',
  service_order_id: O, deleted_at: null, payment_method: 'pix', ...over
})
const com = (id: string, over: Row = {}): Row => ({
  id, organization_id: 'org-a', employee_id: 'emp1', service_order_id: O, record_type: 'commission', status: 'pending', amount: 45, deleted_at: null, ...over
})

function seed(extra: Record<string, Row[]> = {}, codes = ['orders.pay', 'orders.cancel', 'orders.update', 'financial.delete']) {
  fake = createFakeSupabase(guardSeed(codes, {
    service_orders: [order()],
    employees: [{ id: 'emp1', organization_id: 'org-a', name: 'João Mecânico' }],
    bank_accounts: [{ id: 'ba1', organization_id: 'org-a', current_balance: 1000, is_active: true, name: 'Caixa Principal' }],
    bank_account_statements: [], financial_categories: [], financial_transactions: [], employee_financial_records: [],
    service_order_installments: [], service_order_events: [],
    ...extra
  }))
  login()
}

const call = (file: string, o: { params?: Record<string, string>, body?: unknown, headers?: Record<string, string>, method?: string } = {}) => {
  const e = fakeEvent({ method: o.method ?? 'POST', cookies: { 'sb-access-token': 'tok' }, params: { id: O, ...o.params }, body: o.body, headers: o.headers })
  ;(e as any).context = { audit: { requestId: RID, userId: USERS.admin.id, actorType: 'user' } }
  return callHandler(file, e)
}
const events = (type?: string): Row[] => ((fake.tables.service_order_events ?? []) as Row[]).filter(e => !type || e.event_type === type)
const types = () => events().map(e => e.event_type).sort()
const src = (e: Row) => [e.source_code, e.source_trust, e.source_declared]
const breakEvents = () => {
  const real = fake.client.from.bind(fake.client)
  ;(fake.client as any).from = (t: string) => { if (t === 'service_order_events') throw new Error('events down'); return real(t) }
}

beforeEach(() => {
  auth.refreshSession.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('cancel (OSH-140, 141, 145, 125)', () => {
  const setup = (o: Row = {}) => seed({
    service_orders: [order({ status: 'open', ...o })],
    employee_financial_records: [com(REC1), com(REC2, { status: 'paid', amount: 30, financial_transaction_id: TX2 })],
    financial_transactions: [{ id: TX2, organization_id: 'org-a', type: 'expense', status: 'paid', amount: 30, deleted_at: null }]
  })

  it('1 order.cancelled (general/order) + 1 commission.removed por comissão, mesmo correlation_id, origem os_detail', async () => {
    setup()
    const res = await call(F.cancel)
    expect(res.status).toBe(200)
    expect((fake.tables.service_orders as Row[])[0]!.status).toBe('cancelled')
    expect(types()).toEqual(['commission.removed', 'commission.removed', 'order.cancelled'])
    const c = events('order.cancelled')[0]!
    expect(c).toMatchObject({ visibility: 'general', category: 'order', service_order_id: O, entity_id: null, idempotency_key: `order_cancelled:${O}:${RID}`, correlation_id: RID })
    expect(c.payload).toEqual({ order_number: 'OS1', previous_status: 'open' })
    expect(events().every(e => e.correlation_id === RID && e.organization_id === 'org-a')).toBe(true)
    expect(events().every(e => src(e).join() === 'os_detail,inferred,')).toBe(true)
    const removed = events('commission.removed')
    expect(removed.every(e => e.visibility === 'commission' && e.category === 'commission')).toBe(true)
    expect(removed.map(e => e.idempotency_key).sort()).toEqual([`commission_removed:${REC1}`, `commission_removed:${REC2}`])
    expect(removed.find(e => e.entity_id === REC2)!.payload).toEqual({ employee_name: 'João Mecânico', amount: 30, was_paid: true, reason: 'order_cancelled' })
    expect(removed.find(e => e.entity_id === REC1)!.payload.was_paid).toBe(false)
  })

  it('OSH-145: order.cancelled não cita comissão nem valores; fica em general enquanto os efeitos ficam em commission', async () => {
    setup()
    await call(F.cancel)
    const json = JSON.stringify(events('order.cancelled'))
    expect(json.toLowerCase()).not.toContain('comiss')
    expect(json.toLowerCase()).not.toContain('commission')
    expect(events('order.cancelled')[0]!.visibility).toBe('general')
    expect(events().filter(e => e.visibility === 'general').map(e => e.event_type)).toEqual(['order.cancelled'])
  })

  it.each([
    [{ 'x-origin': 'os_list' }, ['os_list', 'declared', 'os_list']],
    [{ 'x-origin': 'os_detail' }, ['os_detail', 'declared', 'os_detail']],
    [{}, ['os_detail', 'inferred', null]],
    [{ 'x-origin': 'commission_report' }, ['os_detail', 'mismatch', 'commission_report']]
  ])('origem %j herdada por TODOS os eventos da cascata: %j', async (headers, expected) => {
    setup()
    await call(F.cancel, { headers })
    expect(events()).toHaveLength(3)
    for (const e of events()) expect(src(e)).toEqual(expected)
  })

  it('OSH-141: OS já cancelada -> idempotente, sem evento; com pagamento -> 409 sem evento', async () => {
    setup({ status: 'cancelled' })
    expect((await call(F.cancel)).status).toBe(200)
    seed({ service_orders: [order({ status: 'open', payment_status: 'partial' })] })
    expect((await call(F.cancel)).status).toBe(409)
    seed({ service_orders: [order({ status: 'open' })], service_order_installments: [inst(INST1, 1)] })
    expect((await call(F.cancel)).status).toBe(409)
    expect(events()).toHaveLength(0)
  })

  it('OS de outra org -> 404 sem evento', async () => {
    seed({ service_orders: [order({ organization_id: 'org-b' })] })
    expect((await call(F.cancel)).status).toBe(404)
    expect(events()).toHaveLength(0)
  })

  it('OSH-150: falha ao gravar evento não muda status nem corpo da resposta', async () => {
    setup()
    const baseline = await call(F.cancel)
    setup()
    breakEvents()
    const res = await call(F.cancel)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(baseline.body)
    expect((fake.tables.service_orders as Row[])[0]!.status).toBe('cancelled')
    expect(events()).toHaveLength(0)
  })
})

describe('payment.delete (OSH-106, 125, 142)', () => {
  const setup = () => seed({
    service_orders: [order({ payment_status: 'partial' })],
    service_order_installments: [inst(INST1, 1, { status: 'paid', financial_transaction_id: TX1 }), inst(INST2, 2)],
    financial_transactions: [tx(TX1)],
    employee_financial_records: [com(REC1)]
  })

  it('payment.deleted + commission.removed + payment.status_changed, todos com o mesmo correlation_id e a origem do header', async () => {
    setup()
    const res = await call(F.paymentDelete, { method: 'DELETE', headers: { 'x-origin': 'os_detail' } })
    expect(res.status).toBe(200)
    expect(types()).toEqual(['commission.removed', 'payment.deleted', 'payment.status_changed'])
    const d = events('payment.deleted')[0]!
    expect(d).toMatchObject({ visibility: 'financial', category: 'payment', idempotency_key: `payment_deleted:${O}:${RID}`, entity_type: 'service_order' })
    expect(d.payload).toEqual({ installments_removed: 2, received_total: 150 })
    expect(events('payment.status_changed')[0]!.payload).toEqual({ from: 'partial', to: 'pending' })
    const r = events('commission.removed')[0]!
    expect(r).toMatchObject({ visibility: 'commission', idempotency_key: `commission_removed:${REC1}` })
    expect(r.payload).toMatchObject({ reason: 'payment_deleted', employee_name: 'João Mecânico' })
    for (const e of events()) {
      expect(e.correlation_id).toBe(RID)
      expect(src(e)).toEqual(['os_detail', 'declared', 'os_detail']) // herdada: nunca system/unknown
    }
  })

  it('sem header: origem inferida os_detail em toda a cascata; mismatch preserva a inferida', async () => {
    setup()
    await call(F.paymentDelete, { method: 'DELETE' })
    for (const e of events()) expect(src(e)).toEqual(['os_detail', 'inferred', null])
    setup()
    await call(F.paymentDelete, { method: 'DELETE', headers: { 'x-origin': 'financial_entries' } })
    for (const e of events()) expect(src(e)).toEqual(['os_detail', 'mismatch', 'financial_entries'])
  })

  it('comissão já paga bloqueia (409) e não grava nenhum evento; OS de outra org -> 404', async () => {
    seed({ employee_financial_records: [com(REC1, { status: 'paid' })], service_order_installments: [inst(INST1, 1)] })
    expect((await call(F.paymentDelete, { method: 'DELETE' })).status).toBe(409)
    seed({ service_orders: [order({ organization_id: 'org-b' })] })
    expect((await call(F.paymentDelete, { method: 'DELETE' })).status).toBe(404)
    expect(events()).toHaveLength(0)
  })

  it('sem mudança de situação não grava payment.status_changed', async () => {
    seed({ service_order_installments: [inst(INST1, 1)] })
    await call(F.paymentDelete, { method: 'DELETE' })
    expect(types()).toEqual(['payment.deleted'])
  })

  it('OSH-150: falha ao gravar evento não muda resposta nem estado', async () => {
    setup()
    const baseline = await call(F.paymentDelete, { method: 'DELETE' })
    setup()
    breakEvents()
    const res = await call(F.paymentDelete, { method: 'DELETE' })
    expect(res.body).toEqual(baseline.body)
    expect(fake.tables.employee_financial_records).toHaveLength(0)
  })
})

describe('installments/:id DELETE (OSH-104, 125)', () => {
  const setup = () => seed({
    service_orders: [order({ payment_status: 'partial' })],
    service_order_installments: [inst(INST1, 1, { status: 'paid', financial_transaction_id: TX1 }), inst(INST2, 2)],
    financial_transactions: [tx(TX1)]
  })
  const del = (headers?: Record<string, string>, body: Row = { reason: 'lançada errada' }) =>
    call(F.instDelete, { method: 'DELETE', params: { installmentId: INST1 }, body, headers })

  it('installment.removed com motivo + payment.status_changed herdando origem e correlation_id', async () => {
    setup()
    expect((await del({ 'x-origin': 'os_detail' })).status).toBe(200)
    const e = events('installment.removed')[0]!
    expect(e).toMatchObject({ visibility: 'financial', category: 'payment', entity_id: INST1, idempotency_key: `installment_removed:${INST1}` })
    expect(e.payload).toEqual({ installment_number: 1, amount: 150, reason: 'lançada errada' })
    expect(types()).toEqual(['installment.removed', 'payment.status_changed'])
    for (const ev of events()) expect([ev.correlation_id, ...src(ev)]).toEqual([RID, 'os_detail', 'declared', 'os_detail'])
  })

  it('sem motivo (400), parcela inexistente/de outra OS (404): zero eventos', async () => {
    setup()
    expect((await del(undefined, {})).status).toBe(400)
    expect((await call(F.instDelete, { method: 'DELETE', params: { installmentId: 'nao-existe' }, body: { reason: 'x' } })).status).toBe(404)
    expect(events()).toHaveLength(0)
  })

  it('comissão paga bloqueia (409) sem evento', async () => {
    setup()
    ;(fake.tables.employee_financial_records as Row[]).push(com(REC1, { status: 'paid' }))
    expect((await del()).status).toBe(409)
    expect(events()).toHaveLength(0)
  })

  it('OSH-150: falha ao gravar evento não muda a resposta', async () => {
    setup()
    const baseline = await del()
    setup()
    breakEvents()
    const res = await del()
    expect(res.body).toEqual(baseline.body)
    expect((fake.tables.service_order_installments as Row[]).find(i => i.id === INST1)!.deleted_at).toBeTruthy()
  })
})

describe('financial-transactions/:id DELETE (OSH-108)', () => {
  const setup = () => seed({
    service_orders: [order({ payment_status: 'paid' })],
    service_order_installments: [inst(INST1, 1, { status: 'paid', financial_transaction_id: TX1, amount: 150 })],
    financial_transactions: [tx(TX1, { service_order_installment_id: INST1 })]
  })
  const del = (headers?: Record<string, string>) => call(F.txDelete, { method: 'DELETE', params: { transactionId: TX1 }, headers })

  it('receipt.reversed (financial) sem motivo automático no texto, origem os_detail, + status_changed herdando', async () => {
    setup()
    expect((await del({ 'x-origin': 'os_detail' })).status).toBe(200)
    const e = events('receipt.reversed')[0]!
    expect(e).toMatchObject({ visibility: 'financial', category: 'payment', entity_id: TX1, idempotency_key: `receipt_reversed:${TX1}` })
    expect(e.payload).toEqual({ amount: 150, payment_method: 'pix', payment_date: '2026-11-10', bank_account_name: 'Caixa Principal', installment_number: 1, reason: null })
    expect(types()).toEqual(['payment.status_changed', 'receipt.reversed'])
    expect(events('payment.status_changed')[0]!.payload).toEqual({ from: 'paid', to: 'pending' })
    for (const ev of events()) expect([ev.correlation_id, ...src(ev)]).toEqual([RID, 'os_detail', 'declared', 'os_detail'])
    expect(events('entry.deleted')).toHaveLength(0)
  })

  it('transação de outra OS/org -> 404 sem evento; comissão paga -> 409 sem evento', async () => {
    seed({ financial_transactions: [tx(TX1, { organization_id: 'org-b' })] })
    expect((await del()).status).toBe(404)
    setup()
    ;(fake.tables.employee_financial_records as Row[]).push(com(REC1, { status: 'paid' }))
    expect((await del()).status).toBe(409)
    expect(events()).toHaveLength(0)
  })

  it('OSH-150: falha ao gravar evento não muda a resposta', async () => {
    setup()
    const baseline = await del()
    setup()
    breakEvents()
    expect((await del()).body).toEqual(baseline.body)
    expect((fake.tables.financial_transactions as Row[])[0]!.deleted_at).toBeTruthy()
  })
})

describe('down-payment e receive-extra-payment (OSH-105)', () => {
  const body = { amount: 100, paymentMethod: 'pix', bankAccountId: 'ba1', paymentDate: '2026-11-05' }

  it('down-payment: payment.down_payment_received (financial) com chave pela transação; não mexe em payment_status', async () => {
    seed({ service_orders: [order({ status: 'open' })] })
    const res = await call(F.down, { body, headers: { 'x-origin': 'os_detail' } })
    expect(res.status).toBe(200)
    const txId = (fake.tables.financial_transactions as Row[])[0]!.id
    expect(types()).toEqual(['payment.down_payment_received'])
    expect(events()[0]).toMatchObject({ visibility: 'financial', category: 'payment', idempotency_key: `down_payment:${txId}`, correlation_id: RID })
    expect(events()[0]!.payload).toEqual({ amount: 100, payment_method: 'pix', payment_date: '2026-11-05', bank_account_name: 'Caixa Principal' })
    expect(src(events()[0]!)).toEqual(['os_detail', 'declared', 'os_detail'])
  })

  it('down-payment: validação/estado inválido -> erro de negócio e zero eventos', async () => {
    seed({ service_orders: [order({ status: 'open' })] })
    expect((await call(F.down, { body: { ...body, amount: 0 } })).status).toBe(400)
    expect((await call(F.down, { body: { amount: 10 } })).status).toBe(400)
    seed({ service_orders: [order({ status: 'completed' })] })
    expect((await call(F.down, { body })).status).toBe(409)
    seed({ service_orders: [order({ status: 'open', organization_id: 'org-b' })] })
    expect((await call(F.down, { body })).status).toBe(404)
    expect(events()).toHaveLength(0)
  })

  it('receive-extra-payment: payment.extra_received + payment.status_changed herdando origem; chave pela transação', async () => {
    seed({ service_orders: [order({ status: 'completed' })] })
    const res = await call(F.extra, { body, headers: { 'x-origin': 'financial_bulk' } })
    expect(res.status).toBe(200)
    const txId = (fake.tables.financial_transactions as Row[])[0]!.id
    expect(types()).toEqual(['payment.extra_received', 'payment.status_changed'])
    expect(events('payment.extra_received')[0]).toMatchObject({ visibility: 'financial', idempotency_key: `extra_payment:${txId}` })
    expect(events('payment.extra_received')[0]!.payload).toMatchObject({ amount: 100, payment_method: 'pix' })
    for (const e of events()) expect(src(e)).toEqual(['os_detail', 'mismatch', 'financial_bulk'])
  })

  it('receive-extra-payment em OS não concluída -> 409 sem evento', async () => {
    seed({ service_orders: [order({ status: 'open' })] })
    expect((await call(F.extra, { body })).status).toBe(409)
    expect(events()).toHaveLength(0)
  })

  it.each([['down', 'open'], ['extra', 'completed']])('OSH-150 %s: falha do evento não muda resposta nem estado', async (key, status) => {
    seed({ service_orders: [order({ status })] })
    const baseline = await call(F[key as 'down'], { body })
    seed({ service_orders: [order({ status })] })
    breakEvents()
    const res = await call(F[key as 'down'], { body })
    expect(res.status).toBe(200)
    expect(res.body).toEqual(baseline.body)
    expect(fake.tables.financial_transactions).toHaveLength(1)
  })
})

describe('process-payment (OSH-105, 107, 109)', () => {
  const body = {
    paymentMethod: 'pix', bankAccountId: 'ba1', paymentDate: '2026-11-05',
    installments: [{ amount: 100, status: 'paid' }, { amount: 200, status: 'pending', due_date: '2026-12-05' }]
  }

  it('payment.plan_created + installment.paid (só o pago) + payment.status_changed; mesma origem/correlation', async () => {
    seed()
    const res = await call(F.process, { body, headers: { 'x-origin': 'os_detail' } })
    expect(res.status).toBe(200)
    expect(types()).toEqual(['installment.paid', 'payment.plan_created', 'payment.status_changed'])
    const plan = events('payment.plan_created')[0]!
    expect(plan).toMatchObject({ visibility: 'financial', category: 'payment', idempotency_key: `payment_plan_created:${O}:${RID}` })
    expect(plan.payload).toEqual({ installment_count: 2, total_amount: 300, paid_count: 1, payment_method: 'pix', after_removal: false })
    const paid = events('installment.paid')[0]!
    expect(paid.idempotency_key).toMatch(new RegExp(`^installment_paid:[^:]+:[^:]+$`))
    expect(paid.payload).toMatchObject({ amount: 100, partial: false, installment_number: 1 })
    expect(events('payment.status_changed')[0]!.payload).toEqual({ from: 'pending', to: 'partial' })
    for (const e of events()) expect([e.correlation_id, ...src(e)]).toEqual([RID, 'os_detail', 'declared', 'os_detail'])
  })

  it('after_removal=true quando a OS já teve payment.deleted (regeneração); sem decisão Q8 não emite plan_regenerated', async () => {
    seed({ service_order_events: [{ id: 'old', organization_id: 'org-a', service_order_id: O, event_type: 'payment.deleted', occurred_at: '2026-11-01T10:00:00Z' }] })
    await call(F.process, { body })
    expect(events('payment.plan_created')[0]!.payload.after_removal).toBe(true)
    expect(events('payment.plan_regenerated')).toHaveLength(0)
  })

  it('plano antigo já seguido de outro plano (ciclo fechado): after_removal=false', async () => {
    seed({ service_order_events: [
      { id: 'old1', organization_id: 'org-a', service_order_id: O, event_type: 'payment.deleted', occurred_at: '2026-11-01T10:00:00Z' },
      { id: 'old2', organization_id: 'org-a', service_order_id: O, event_type: 'payment.plan_created', occurred_at: '2026-11-02T10:00:00Z' }
    ] })
    await call(F.process, { body })
    expect(events('payment.plan_created').at(-1)!.payload.after_removal).toBe(false)
  })

  it('plano já existente (409), soma errada (400) e OS não concluída (409): zero eventos', async () => {
    seed({ service_order_installments: [inst(INST1, 1)] })
    expect((await call(F.process, { body })).status).toBe(409)
    seed()
    expect((await call(F.process, { body: { ...body, installments: [{ amount: 1 }] } })).status).toBe(400)
    seed({ service_orders: [order({ status: 'open' })] })
    expect((await call(F.process, { body })).status).toBe(409)
    expect(events()).toHaveLength(0)
  })

  it('OSH-150: falha do evento não muda resposta nem estado', async () => {
    seed()
    const baseline = await call(F.process, { body })
    seed()
    breakEvents()
    const res = await call(F.process, { body })
    expect(res.status).toBe(200)
    expect(res.body).toEqual(baseline.body)
    expect(fake.tables.service_order_installments).toHaveLength(2)
  })

  it('eventos não vazam commissions[] cru, e-mail ou ids de funcionário', async () => {
    seed()
    await call(F.process, { body })
    const json = JSON.stringify(events())
    expect(json).not.toContain('@')
    expect(json).not.toContain('"commissions"')
    expect(json).not.toContain('emp1')
  })
})

describe('generate-commissions (OSH-121)', () => {
  it('regeneração geral SEM mudança de total não grava commission.regenerated; falha do evento não muda a resposta', async () => {
    seed({ employee_financial_records: [com(REC1)] })
    const baseline = await call(F.generate, { body: {}, headers: { 'x-origin': 'os_detail' } })
    expect(baseline.status).toBe(200)
    expect(events('commission.regenerated')).toHaveLength(0)
    seed({ employee_financial_records: [com(REC1)] })
    breakEvents()
    const res = await call(F.generate, { body: {} })
    expect(res.status).toBe(200)
    expect(res.body).toEqual(baseline.body)
  })

  it('regeneração geral COM mudança de total grava 1 commission.regenerated (commission) com total_before/total_after', async () => {
    seed({ employee_financial_records: [com(REC1)] })
    const real = fake.client.from.bind(fake.client)
    let reads = 0
    // simula o recálculo alterando o total entre o "antes" (1a leitura) e o "depois" (última leitura)
    ;(fake.client as any).from = (t: string) => {
      if (t === 'employee_financial_records' && ++reads === 2) (fake.tables.employee_financial_records as Row[])[0]!.amount = 60
      return real(t)
    }
    const res = await call(F.generate, { body: {}, headers: { 'x-origin': 'os_detail' } })
    expect(res.status).toBe(200)
    const regen = events('commission.regenerated')
    expect(regen).toHaveLength(1)
    expect(regen[0]).toMatchObject({ visibility: 'commission', category: 'commission', idempotency_key: `commission_regenerated:${O}:${RID}`, correlation_id: RID })
    expect(Object.keys(regen[0]!.payload).sort()).toEqual(['total_after', 'total_before'])
    expect(src(regen[0]!)).toEqual(['os_detail', 'declared', 'os_detail'])
  })

  it('OS de outra organização: sem evento', async () => {
    seed({ service_orders: [order({ organization_id: 'org-b' })] })
    await call(F.generate, { body: {} })
    expect(events()).toHaveLength(0)
  })
})

describe('OSH-161: sem permissão, x-origin não muda a autorização', () => {
  it.each(Object.keys(F))('%s -> 403 com e sem header, zero eventos', async (key) => {
    seed({ service_orders: [order({ status: 'open' })], service_order_installments: [inst(INST1, 1)], financial_transactions: [tx(TX1)] })
    ;(fake.tables.role_actions as Row[]).length = 0
    login('com')
    const file = F[key as keyof typeof F]
    const params = { installmentId: INST1, transactionId: TX1 }
    const a = await call(file, { params, body: { reason: 'x', amount: 1, bankAccountId: 'ba1' } })
    const b = await call(file, { params, body: { reason: 'x', amount: 1, bankAccountId: 'ba1' }, headers: { 'x-origin': 'os_detail' } })
    expect([a.status, b.status]).toEqual([403, 403])
    expect(events()).toHaveLength(0)
  })
})
