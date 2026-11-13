// Histórico da OS (F0): GET /api/service-orders/:id/history (tenant, visibilidade, paginação, origem)
// e o evento de prova `installment.paid` gravado por installments/:id/pay.
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

const cookies = { 'sb-access-token': 'tok' }
const HISTORY = 'server/api/service-orders/[id]/history.get.ts'
const PAY = 'server/api/service-orders/[id]/installments/[installmentId]/pay.post.ts'

const login = (persona: Persona) => {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

let seq = 0
const ev = (over: Record<string, unknown> = {}) => ({
  id: `ev-${++seq}`, seq, organization_id: 'org-a', service_order_id: 'o1', occurred_at: `2026-11-13T10:00:${String(seq).padStart(2, '0')}Z`,
  event_type: 'order.status_changed', schema_version: 1, category: 'status', visibility: 'general', actor_name: 'Maria',
  payload: { from: 'open', to: 'completed' }, correlation_id: '11111111-1111-4111-8111-111111111111',
  source_code: 'os_form', source_label: 'Ordem de serviço (cadastro/edição)', ...over
})

function seed(codes: string[], granted: string[], events: Array<Record<string, unknown>>) {
  const s = guardSeed(codes, {
    service_orders: [{ id: 'o1', organization_id: 'org-a' }, { id: 'o-b', organization_id: 'org-b' }],
    service_order_events: events
  })
  s.role_actions = granted.map(code => ({ role_id: 'r-com', action_id: `act-${codes.indexOf(code)}`, is_granted: true }))
  fake = createFakeSupabase(s)
}

const get = (query: Record<string, unknown> = {}, id = 'o1') => callHandler(HISTORY, fakeEvent({ cookies, params: { id }, query }))
const CODES = ['orders.read', 'orders.pay', 'reports.commissions']

beforeEach(() => auth.refreshSession.mockReset())

describe('GET history', () => {
  it('sem orders.read -> 403', async () => {
    seed(CODES, [], [ev()])
    login('com')
    expect((await get()).status).toBe(403)
  })

  it('orders.read vê só eventos gerais; financeiro e comissão são omitidos (não mascarados)', async () => {
    seed(CODES, ['orders.read'], [ev(), ev({ visibility: 'financial', event_type: 'installment.paid', category: 'payment' }), ev({ visibility: 'commission' })])
    login('com')
    const res = await get()
    expect(res.status).toBe(200)
    const body = res.body as { items: Array<{ category: string }> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]!.category).toBe('status')
  })

  it('orders.pay libera os financeiros; admin vê tudo', async () => {
    const events = [ev(), ev({ visibility: 'financial' }), ev({ visibility: 'commission' })]
    seed(CODES, ['orders.read', 'orders.pay'], events)
    login('com')
    expect(((await get()).body as { items: unknown[] }).items).toHaveLength(2)
    seed(CODES, [], events)
    login('admin')
    expect(((await get()).body as { items: unknown[] }).items).toHaveLength(3)
  })

  it('isolamento de tenant: não lista eventos de outra org e OS de outra org dá 404', async () => {
    seed(CODES, ['orders.read'], [ev(), ev({ organization_id: 'org-b' }), ev({ organization_id: 'org-b', service_order_id: 'o-b' })])
    login('com')
    expect(((await get()).body as { items: unknown[] }).items).toHaveLength(1)
    expect((await get({}, 'o-b')).status).toBe(404)
  })

  it('não vaza ids crus, e-mail nem correlation_id', async () => {
    seed(CODES, ['orders.read'], [ev()])
    login('com')
    const json = JSON.stringify((await get()).body)
    expect(json).not.toContain('11111111-1111')
    expect(json).not.toContain('correlation')
    expect(json).not.toContain('organization')
  })

  it('filtro source, source inválida e paginação por cursor', async () => {
    seed(CODES, ['orders.read'], [ev(), ev({ source_code: 'financial_entries' }), ev(), ev()])
    login('com')
    expect(((await get({ source: 'financial_entries' })).body as { items: unknown[] }).items).toHaveLength(1)
    expect((await get({ source: 'nope' })).status).toBe(400)
    expect((await get({ cursor: '%%%' })).status).toBe(400)
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    for (const bad of [
      { t: '2026-11-13T10:00:00Z",seq.gt.0,or=(id.neq.x', s: 1 },
      { t: '2026-11-13T10:00:00Z (x)', s: 1 },
      { t: 'Nov 13 2026 (10:00)', s: 1 },
      { t: '2026-11-13T10:00:00Z', s: -1 },
      { t: '2026-11-13T10:00:00Z', s: 1.5 },
      { t: '2026-11-13T10:00:00Z', s: '1' }
    ]) expect((await get({ cursor: enc(bad) })).status).toBe(400)
    expect((await get({ cursor: enc({ t: '2026-11-13T10:00:00.123456+00:00', s: 3 }) })).status).toBe(200)

    const page1 = (await get({ limit: '3' })).body as { items: unknown[], nextCursor: string | null }
    expect(page1.items).toHaveLength(3)
    expect(page1.nextCursor).toEqual(expect.any(String))
    const all = (await get({ limit: '10' })).body as { items: unknown[], nextCursor: string | null }
    expect(all.items).toHaveLength(4)
    expect(all.nextCursor).toBeNull()
  })

  it('o mais recente vem primeiro', async () => {
    seed(CODES, ['orders.read'], [ev({ id: 'old' }), ev({ id: 'new' })])
    login('com')
    const ids = ((await get()).body as { items: Array<{ id: string }> }).items.map(i => i.id)
    expect(ids).toEqual(['new', 'old'])
  })
})

describe('evento de prova: installment.paid', () => {
  const tables = () => ({
    service_orders: [{ id: 'o2', organization_id: 'org-a', number: 'OS3', status: 'completed', entry_date: '2026-03-10', total_amount: 100, discount: 0, payment_status: 'pending', deleted_at: null, commission_release_mode: null, commission_manual_adjustments_log: [], responsible_employees: [], items: [] }],
    service_order_installments: [{ id: 'i1', organization_id: 'org-a', service_order_id: 'o2', kind: 'installment', installment_number: 2, amount: 100, status: 'pending', due_date: '2026-04-10', deleted_at: null }],
    bank_accounts: [{ id: 'ba1', organization_id: 'org-a', current_balance: 1000 }],
    bank_account_statements: [], financial_transactions: [], financial_categories: [], employees: [], employee_financial_records: []
  })
  const pay = (headers: Record<string, string> = {}) =>
    callHandler(PAY, fakeEvent({ method: 'POST', cookies, params: { id: 'o2', installmentId: 'i1' }, body: { bank_account_id: 'ba1', payment_method: 'pix' }, headers }))

  it('grava 1 evento financeiro com origem validada e chave idempotente', async () => {
    fake = createFakeSupabase(guardSeed(['orders.pay'], tables()))
    login('admin')
    const res = await pay({ 'x-origin': 'os_detail' })
    expect(res.status).toBe(200)
    const rows = fake.tables.service_order_events as Array<Record<string, any>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      organization_id: 'org-a', service_order_id: 'o2', event_type: 'installment.paid', visibility: 'financial', category: 'payment',
      entity_id: null, source_code: 'os_detail', source_trust: 'declared', actor_user_id: null
    })
    expect(rows[0]!.payload).toMatchObject({ installment_number: 2, amount: 100, payment_method: 'pix', partial: false })
    expect(rows[0]!.idempotency_key).toMatch(/^installment_paid:i1:/)
  })

  const payWith = (body: Record<string, unknown>) =>
    callHandler(PAY, fakeEvent({ method: 'POST', cookies, params: { id: 'o2', installmentId: 'i1' }, body }))
  const events = () => fake.tables.service_order_events as Array<Record<string, any>>
  const setup = (installment: Record<string, unknown> = {}, extra: Record<string, unknown[]> = {}) => {
    const t = tables()
    t.service_order_installments = [{ ...t.service_order_installments[0]!, ...installment }]
    fake = createFakeSupabase(guardSeed(['orders.pay'], { ...t, ...extra } as Record<string, any[]>))
    login('admin')
  }

  it('o método do evento vem de payment_method (camelCase é ignorado) ou do planejado na parcela', async () => {
    setup()
    expect((await payWith({ paymentMethod: 'cash', payment_method: 'pix' })).status).toBe(200)
    expect(events()[0]!.payload.payment_method).toBe('pix')

    setup({ payment_method: 'boleto' })
    expect((await payWith({ paymentMethod: 'cash' })).status).toBe(200)
    expect(events()[0]!.payload.payment_method).toBe('boleto')
  })

  it('transação pendente existente: usa o método da transação, não o da parcela; nunca é parcial', async () => {
    setup(
      { financial_transaction_id: 'tx1', payment_method: 'pix' },
      { financial_transactions: [{ id: 'tx1', organization_id: 'org-a', status: 'pending', amount: 100, payment_method: 'cash', description: 'x' }] }
    )
    expect((await payWith({ payment_method: 'credit_card' })).status).toBe(200)
    expect(events()).toHaveLength(1)
    expect(events()[0]!.payload).toMatchObject({ payment_method: 'cash', partial: false, amount: 100 })
    expect(events()[0]!.idempotency_key).toBe('installment_paid:i1:tx1')
  })

  it('transação pendente existente sem método próprio cai no método da parcela', async () => {
    setup(
      { financial_transaction_id: 'tx1', payment_method: 'pix' },
      { financial_transactions: [{ id: 'tx1', organization_id: 'org-a', status: 'pending', amount: 100, payment_method: null, description: 'x' }] }
    )
    expect((await payWith({})).status).toBe(200)
    expect(events()[0]!.payload.payment_method).toBe('pix')
  })

  it('recebimento parcial: partial=true, valor recebido (não o da parcela) e chave com a transação criada', async () => {
    setup()
    expect((await payWith({ payment_method: 'pix', amount: 40 })).status).toBe(200)
    expect(fake.tables.service_order_installments![0]!.status).toBe('partial')
    expect(events()).toHaveLength(1)
    expect(events()[0]!.payload).toMatchObject({ partial: true, amount: 40 })
    expect(events()[0]!.idempotency_key).toMatch(/^installment_paid:i1:.+/)
  })

  it.each([
    ['  pix  ', 'pix'],
    ['x'.repeat(50), 'x'.repeat(30)],
    [123, null],
    [{ a: 1 }, null],
    ['   ', null]
  ])('normaliza o método do payload: %j -> %j', async (input, expected) => {
    setup({ payment_method: null })
    expect((await payWith({ payment_method: input })).status).toBe(200)
    expect(events()[0]!.payload.payment_method).toBe(expected)
  })

  it('payment_date: válida é gravada; inválida (31/02, formato) vira null; ausente usa hoje', async () => {
    setup()
    await payWith({ payment_method: 'pix', payment_date: '2026-03-05' })
    expect(events()[0]!.payload.payment_date).toBe('2026-03-05')

    for (const bad of ['2026-02-31', '05/03/2026', '2026-3-5', 'ontem']) {
      setup()
      expect((await payWith({ payment_method: 'pix', payment_date: bad })).status).toBe(200)
      expect(events()[0]!.payload.payment_date, bad).toBeNull()
    }

    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-11-13T15:00:00Z'))
      setup()
      await payWith({ payment_method: 'pix' })
      expect(events()[0]!.payload.payment_date).toBe('2026-11-13')
    } finally {
      vi.useRealTimers()
    }
  })

  it('falha ao gravar o evento NÃO derruba o recebimento', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      fake = createFakeSupabase(guardSeed(['orders.pay'], tables()))
      const real = fake.client.from.bind(fake.client)
      ;(fake.client as { from: unknown }).from = (t: string) => {
        if (t === 'service_order_events') throw new Error('events table down')
        return real(t)
      }
      login('admin')
      const res = await pay()
      expect(res.status).toBe(200)
      expect(fake.tables.service_order_installments![0]!.status).toBe('paid')
      expect(errSpy).toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
    }
  })
})
