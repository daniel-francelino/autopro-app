// Histórico da OS (F1): cobertura das correções do code review (M2 cache/lote, M3 confirmação do último passo,
// M4 só o que o banco confirmou), installment.edited (OSH-103) e ordem causa->efeito (L1) SEM .sort().
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { seedOrganizations } from '../../support/organizations-fixture'
import { guardSeed, USERS } from '../../support/phase3-guard-fixture'
import { resolveEntryOsLink, OS_SOURCE_POLICIES } from '../../../server/utils/os-history/events'
import { withOrigin } from '../../../app/utils/with-origin'

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
  patch: `${D}installments/[installmentId].patch.ts`,
  instDelete: `${D}installments/[installmentId].delete.ts`,
  txDelete: `${D}financial-transactions/[transactionId].delete.ts`,
  bulkCommissions: 'server/api/financial/pay-commissions-bulk.post.ts',
  bulkEntries: 'server/api/financial/pay-entries-bulk.post.ts',
  commissionPay: 'server/api/reports/commissions/[id]/pay.post.ts',
  entryPay: 'server/api/financial/[id]/pay.post.ts'
}
const RID = '55555555-5555-4555-8555-555555555555'
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [REC1, REC2, REC3, INST1, INST2, TX1, TX2, TX3] = [U(1), U(2), U(3), U(11), U(12), U(21), U(22), U(23)]
type Row = Record<string, any>

const order = (o: Row = {}): Row => ({ id: 'o1', organization_id: 'org-a', number: 'OS1', status: 'completed', total_amount: 300, discount: 0, payment_status: 'pending', entry_date: '2026-11-01', deleted_at: null, commission_release_mode: 'proportional', commission_manual_adjustments_log: [], responsible_employees: [], items: [], ...o })
const inst = (id: string, n: number, o: Row = {}): Row => ({ id, organization_id: 'org-a', service_order_id: 'o1', kind: 'installment', installment_number: n, amount: 150, status: 'pending', due_date: '2026-12-01', deleted_at: null, ...o })
const tx = (id: string, o: Row = {}): Row => ({ id, organization_id: 'org-a', type: 'income', status: 'paid', amount: 150, due_date: '2026-11-10', description: 'Rec', bank_account_id: 'ba1', service_order_id: 'o1', deleted_at: null, payment_method: 'pix', ...o })
const rec = (id: string, o: Row = {}): Row => ({ id, organization_id: 'org-a', employee_id: 'emp1', service_order_id: 'o1', record_type: 'commission', status: 'pending', amount: 50, deleted_at: null, ...o })
const etx = (id: string, o: Row = {}): Row => ({ id, organization_id: 'org-a', status: 'pending', type: 'expense', amount: 50, due_date: '2026-11-10', description: 'L', bank_account_id: 'ba1', deleted_at: null, service_order_id: null, employee_financial_record_id: null, ...o })

function seed(extra: Record<string, Row[]> = {}) {
  fake = createFakeSupabase(guardSeed(['orders.pay', 'orders.cancel', 'orders.update', 'financial.update', 'financial.delete'], {
    organizations: seedOrganizations('proportional'),
    service_orders: [order(), order({ id: 'o2' }), order({ id: 'o3' })],
    employees: [{ id: 'emp1', organization_id: 'org-a', name: 'João Mecânico' }, { id: 'emp2', organization_id: 'org-a', name: 'Maria Lanterneira' }],
    bank_accounts: [{ id: 'ba1', organization_id: 'org-a', current_balance: 1000, is_active: true, name: 'Caixa Principal' }],
    bank_account_statements: [], financial_categories: [], financial_transactions: [], employee_financial_records: [], service_order_installments: [], service_order_events: [],
    ...extra
  }))
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: USERS.admin.id, email: USERS.admin.email } }, error: null })
}
const call = (file: string, o: { params?: Record<string, string>, body?: unknown, headers?: Record<string, string>, method?: string } = {}) => {
  const e = fakeEvent({ method: o.method ?? 'POST', cookies: { 'sb-access-token': 'tok' }, params: { id: 'o1', ...o.params }, body: o.body, headers: o.headers })
  ;(e as any).context = { audit: { requestId: RID, userId: USERS.admin.id, actorType: 'user' } }
  return callHandler(file, e)
}
const events = (): Row[] => (fake.tables.service_order_events ?? []) as Row[]
const order_ = () => events().map(e => e.event_type) // ordem de gravação, SEM sort
const src = (e: Row) => [e.source_code, e.source_trust, e.source_declared]
/** N-ésima chamada (1-based) a `table` falha com erro. */
const failNth = (table: string, nth: number) => {
  const real = fake.client.from.bind(fake.client)
  let n = 0
  ;(fake.client as any).from = (t: string) => { if (t === table && ++n === nth) fake.failNext(t, 'boom'); return real(t) }
}
/** N-ésima chamada a `table` devolve `result` sem tocar no banco. */
const stubNth = (table: string, nth: number, result: { data: unknown, error: unknown }) => {
  const real = fake.client.from.bind(fake.client)
  let n = 0
  const stub: any = new Proxy({}, { get: (_t, k) => (k === 'then' ? (res: (v: unknown) => unknown) => res(result) : () => stub) })
  ;(fake.client as any).from = (t: string) => (t === table && ++n === nth ? stub : real(t))
}
const countCalls = () => {
  const real = fake.client.from.bind(fake.client)
  const calls: Record<string, number> = {}
  ;(fake.client as any).from = (t: string) => { calls[t] = (calls[t] ?? 0) + 1; return real(t) }
  return calls
}

beforeEach(() => {
  auth.refreshSession.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('installment.edited (OSH-103)', () => {
  const patch = (body: Row, headers?: Record<string, string>, installmentId = INST2) => call(F.patch, { method: 'PATCH', params: { installmentId }, body, headers })
  beforeEach(() => seed({ service_order_installments: [inst(INST1, 1, { status: 'paid' }), inst(INST2, 2)] }))

  it('de -> para real de valor e vencimento; chave com request id; origem os_detail; financial/payment', async () => {
    expect((await patch({ amount: 200, due_date: '2027-01-10' })).status).toBe(200)
    expect(events()).toHaveLength(1)
    expect(events()[0]).toMatchObject({
      event_type: 'installment.edited', visibility: 'financial', category: 'payment', organization_id: 'org-a', service_order_id: 'o1',
      entity_type: 'installment', entity_id: INST2, idempotency_key: `installment_edited:${INST2}:${RID}`, correlation_id: RID
    })
    expect(events()[0]!.payload).toEqual({
      installment_number: 2,
      changes: [{ field: 'amount', from: 150, to: 200 }, { field: 'due_date', from: '2026-12-01', to: '2027-01-10' }]
    })
    expect(src(events()[0]!)).toEqual(['os_detail', 'inferred', null])
  })

  it('só valor ou só vencimento: apenas o campo alterado entra em changes', async () => {
    await patch({ amount: 175 })
    expect(events()[0]!.payload.changes).toEqual([{ field: 'amount', from: 150, to: 175 }])
    seed({ service_order_installments: [inst(INST2, 2)] })
    await patch({ due_date: '2027-02-02' })
    expect(events()[0]!.payload.changes).toEqual([{ field: 'due_date', from: '2026-12-01', to: '2027-02-02' }])
  })

  it('nada mudou (mesmos valores), corpo vazio, valor inválido, parcela paga, inexistente ou de outra org: zero eventos', async () => {
    expect((await patch({ amount: 150, due_date: '2026-12-01' })).status).toBe(200)
    expect((await patch({})).status).toBe(400)
    expect((await patch({ amount: -1 })).status).toBe(400)
    expect((await patch({ amount: 10 }, undefined, INST1)).status).toBe(409)
    expect((await patch({ amount: 10 }, undefined, U(99))).status).toBe(404)
    seed({ service_order_installments: [inst(INST2, 2, { organization_id: 'org-b' })] })
    expect((await patch({ amount: 10 })).status).toBe(404)
    expect(events()).toHaveLength(0)
  })

  it('origem: header válido aceito só se o endpoint permite; mismatch preserva a inferida', async () => {
    await patch({ amount: 160 }, { 'x-origin': 'os_detail' })
    expect(src(events()[0]!)).toEqual(['os_detail', 'declared', 'os_detail'])
    seed({ service_order_installments: [inst(INST2, 2)] })
    await patch({ amount: 160 }, { 'x-origin': 'financial_entries' })
    expect(src(events()[0]!)).toEqual(['os_detail', 'mismatch', 'financial_entries'])
  })

  it('update com erro: 500 e zero eventos; falha do evento não muda a resposta', async () => {
    failNth('service_order_installments', 2)
    expect((await patch({ amount: 160 })).status).toBe(500)
    expect(events()).toHaveLength(0)
    seed({ service_order_installments: [inst(INST2, 2)] })
    const baseline = await patch({ amount: 160 })
    seed({ service_order_installments: [inst(INST2, 2)] })
    const real = fake.client.from.bind(fake.client)
    ;(fake.client as any).from = (t: string) => { if (t === 'service_order_events') throw new Error('down'); return real(t) }
    const failed = await patch({ amount: 160 })
    expect(failed.status).toBe(baseline.status)
    expect(failed.body).toEqual(baseline.body)
  })

  it('sem permissão orders.update: 403 com e sem x-origin', async () => {
    ;(fake.tables.role_actions as Row[]).length = 0
    auth.getUser.mockResolvedValue({ data: { user: { id: USERS.com.id, email: USERS.com.email } }, error: null })
    expect((await patch({ amount: 1 })).status).toBe(403)
    expect((await patch({ amount: 1 }, { 'x-origin': 'os_detail' })).status).toBe(403)
    expect(events()).toHaveLength(0)
  })
})

describe('A4: ordem causa -> efeito e contagem exata (sem .sort)', () => {
  it('cancel: order.cancelled antes dos efeitos (commission.removed), 3 eventos', async () => {
    seed({ service_orders: [order({ status: 'open' })], employee_financial_records: [rec(REC1), rec(REC2)] })
    await call(F.cancel)
    expect(order_()).toEqual(['order.cancelled', 'commission.removed', 'commission.removed'])
  })

  it('payment.delete: payment.deleted -> commission.removed -> payment.status_changed', async () => {
    seed({ service_orders: [order({ payment_status: 'partial' })], service_order_installments: [inst(INST1, 1, { status: 'paid', financial_transaction_id: TX1 }), inst(INST2, 2)], financial_transactions: [tx(TX1)], employee_financial_records: [rec(REC1)] })
    await call(F.paymentDelete, { method: 'DELETE' })
    expect(order_()).toEqual(['payment.deleted', 'commission.removed', 'payment.status_changed'])
  })

  it('receipt.reversed (recebimento estornado) vem antes de payment.status_changed', async () => {
    seed({ service_orders: [order({ payment_status: 'paid' })], service_order_installments: [inst(INST1, 1, { status: 'paid', financial_transaction_id: TX1 })], financial_transactions: [tx(TX1, { service_order_installment_id: INST1 })] })
    await call(F.txDelete, { method: 'DELETE', params: { transactionId: TX1 } })
    expect(order_()).toEqual(['receipt.reversed', 'payment.status_changed'])
  })

  it('installments DELETE: installment.removed antes de payment.status_changed', async () => {
    seed({ service_orders: [order({ payment_status: 'partial' })], service_order_installments: [inst(INST1, 1, { status: 'paid', financial_transaction_id: TX1 }), inst(INST2, 2)], financial_transactions: [tx(TX1)] })
    await call(F.instDelete, { method: 'DELETE', params: { installmentId: INST1 }, body: { reason: 'erro' } })
    expect(order_()).toEqual(['installment.removed', 'payment.status_changed'])
  })

  it('process-payment: plan_created -> installment.paid -> payment.status_changed', async () => {
    seed()
    await call(F.process, { body: { paymentMethod: 'pix', bankAccountId: 'ba1', installments: [{ amount: 100, status: 'paid' }, { amount: 200, status: 'pending', due_date: '2026-12-05' }] } })
    expect(order_()).toEqual(['payment.plan_created', 'installment.paid', 'payment.status_changed'])
  })

  it('process-payment: a herança do modo da org (D4) NÃO gera commission.release_mode_changed, mas a OS passa a `full`; releaseCommissionsInFull no body é ignorado (D7)', async () => {
    // OS em proportional, org em full, sem comissão: o modo é sincronizado em silêncio.
    seed({ organizations: seedOrganizations('full') })
    expect(fake.tables.service_orders!.find(o => o.id === 'o1')!.commission_release_mode).toBe('proportional')
    const r = await call(F.process, { body: { paymentMethod: 'pix', bankAccountId: 'ba1', releaseCommissionsInFull: true, installments: [{ amount: 300, status: 'pending', due_date: '2026-12-05' }] } })
    expect(r.status).toBe(200) // FV-4: sem evento só vale se a requisição deu certo
    expect(fake.tables.service_orders!.find(o => o.id === 'o1')!.commission_release_mode).toBe('full') // efeito: sincronizou
    expect(order_()).toEqual(['payment.plan_created'])
    expect(events().some(e => e.event_type === 'commission.release_mode_changed')).toBe(false)
    expect(events().some(e => String(e.idempotency_key ?? '').startsWith('commission_release_mode:'))).toBe(false)
    // OS já em full e org em full: sem evento e sem update de modo em service_orders
    seed({ organizations: seedOrganizations('full'), service_orders: [order({ commission_release_mode: 'full' })] })
    const r2 = await call(F.process, { body: { paymentMethod: 'pix', bankAccountId: 'ba1', releaseCommissionsInFull: true, installments: [{ amount: 300, status: 'pending', due_date: '2026-12-05' }] } })
    expect(r2.status).toBe(200)
    expect(order_()).toEqual(['payment.plan_created'])
    expect(fake.writes.filter(w => w.table === 'service_orders' && w.op === 'update' && w.values && 'commission_release_mode' in (w.values as object))).toHaveLength(0)
    expect(fake.tables.service_orders!.find(o => o.id === 'o1')!.commission_release_mode).toBe('full')
  })

  it('lotes gravam na ordem de entrada, 1 evento por item confirmado', async () => {
    seed({ employee_financial_records: [rec(REC1, { service_order_id: 'o1' }), rec(REC2, { service_order_id: 'o2' }), rec(REC3, { service_order_id: 'o3' })] })
    await call(F.bulkCommissions, { body: { registroIds: [REC3, REC1, REC2], contaBancariaId: 'ba1' } })
    expect(events().map(e => e.service_order_id)).toEqual(['o3', 'o1', 'o2'])
    seed({ financial_transactions: [etx(TX1, { service_order_id: 'o2', type: 'income' }), etx(TX2, { service_order_id: 'o3', type: 'income' })] })
    await call(F.bulkEntries, { body: { entryIds: [TX2, TX1] } })
    expect(events().map(e => e.service_order_id)).toEqual(['o3', 'o2'])
  })
})

describe('M2: cache/lote reduz consultas (sem mudar eventos)', () => {
  it('pay-commissions-bulk: nomes em 1 consulta e recebido por OS uma única vez', async () => {
    seed({ employee_financial_records: [rec(REC1, { employee_id: 'emp1' }), rec(REC2, { employee_id: 'emp2' }), rec(REC3, { employee_id: 'emp1' })] })
    const calls = countCalls()
    const res = await call(F.bulkCommissions, { body: { registroIds: [REC1, REC2, REC3], contaBancariaId: 'ba1' } })
    expect((res.body as any).data.paidCount).toBe(3)
    expect(events()).toHaveLength(3)
    expect(calls.employees).toBe(1) // 2 funcionários, 1 consulta
    // Relativo ao cenário SEM cache: 3 inserts + 3 leituras do recebido (6) e 3 leituras do nome da conta (+2 sobre o cache).
    expect(calls.financial_transactions).toBeLessThan(6)
    expect(calls.financial_transactions).toBeGreaterThanOrEqual(3) // ao menos os 3 inserts de despesa
    expect(calls.bank_accounts).toBeLessThan(10)
    expect(events().every(e => e.payload.bank_account_name === 'Caixa Principal')).toBe(true)
    expect(events().map(e => e.payload.employee_name)).toEqual(['João Mecânico', 'Maria Lanterneira', 'João Mecânico'])
  })

  it('pay-entries-bulk: registros de comissão pré-carregados em lote (prefetch) e nomes em 1 consulta', async () => {
    seed({
      employee_financial_records: [rec(REC1, { employee_id: 'emp1' }), rec(REC2, { employee_id: 'emp2' }), rec(REC3, { employee_id: 'emp1' })],
      financial_transactions: [etx(TX1, { employee_financial_record_id: REC1 }), etx(TX2, { employee_financial_record_id: REC2 }), etx(TX3, { employee_financial_record_id: REC3 })]
    })
    const calls = countCalls()
    const res = await call(F.bulkEntries, { body: { entryIds: [TX1, TX2, TX3] } })
    expect((res.body as any).data.paidCount).toBe(3)
    expect(events().map(e => e.event_type)).toEqual(['commission.paid', 'commission.paid', 'commission.paid'])
    // 3 updates de sincronização no loop + leitura em lote; sem prefetch seriam 3 leituras (>= 6 chamadas)
    expect(calls.employee_financial_records).toBeLessThan(6)
    expect(calls.employees).toBe(1)
  })
})

describe('M3: evento só depois do último passo CONFIRMADO', () => {
  it('pay-commissions-bulk: update do registro com zero linhas => falha, rollback e nenhum evento', async () => {
    seed({ employee_financial_records: [rec(REC1)] })
    const real = fake.client.from.bind(fake.client)
    let n = 0
    ;(fake.client as any).from = (t: string) => {
      if (t === 'employee_financial_records' && ++n === 2) (fake.tables.employee_financial_records as Row[]).splice(0) // apagado entre leitura e update
      return real(t)
    }
    const res = await call(F.bulkCommissions, { body: { registroIds: [REC1], contaBancariaId: 'ba1' } })
    expect((res.body as any).data).toMatchObject({ paidCount: 0, failedCount: 1 })
    expect(events()).toHaveLength(0)
    expect((fake.tables.bank_accounts as Row[])[0]!.current_balance).toBe(1000)
  })

  it('pay-entries-bulk: sincronização devolve zero linhas => commission.paid com record_synced=false', async () => {
    seed({ employee_financial_records: [rec(REC1)], financial_transactions: [etx(TX1, { employee_financial_record_id: REC1 })] })
    stubNth('employee_financial_records', 1, { data: [], error: null }) // 1a chamada = update de sincronização
    await call(F.bulkEntries, { body: { entryIds: [TX1] } })
    expect(events()).toHaveLength(1)
    expect(events()[0]!.payload).toMatchObject({ via_entry: true, record_synced: false })
  })

  it('pay-entries-bulk: sincronização com erro => record_synced=false; com sucesso => true', async () => {
    seed({ employee_financial_records: [rec(REC1)], financial_transactions: [etx(TX1, { employee_financial_record_id: REC1 })] })
    stubNth('employee_financial_records', 1, { data: null, error: { message: 'x' } })
    await call(F.bulkEntries, { body: { entryIds: [TX1] } })
    expect(events()[0]!.payload.record_synced).toBe(false)
    seed({ employee_financial_records: [rec(REC1)], financial_transactions: [etx(TX1, { employee_financial_record_id: REC1 })] })
    await call(F.bulkEntries, { body: { entryIds: [TX1] } })
    expect(events()[0]!.payload.record_synced).toBe(true)
    expect((fake.tables.employee_financial_records as Row[])[0]!.status).toBe('paid')
  })

  it('pay-entries-bulk: update de status do lançamento com erro (statusError) => nenhum evento', async () => {
    seed({ financial_transactions: [etx(TX1, { service_order_id: 'o2', type: 'income' }), etx(TX2, { service_order_id: 'o3', type: 'income' })] })
    failNth('financial_transactions', 2) // 1=leitura do 1o lançamento, 2=update de status dele
    await call(F.bulkEntries, { body: { entryIds: [TX1, TX2] } })
    expect(events().map(e => e.service_order_id)).toEqual(['o3'])
  })

  it('without_receipt: false quando a OS tem recebimento income pago; true quando não tem', async () => {
    seed({ employee_financial_records: [rec(REC1)], financial_transactions: [tx(TX1)] })
    await call(F.commissionPay, { params: { id: REC1 }, body: { bankAccountId: 'ba1' } })
    expect(events()[0]!.payload.without_receipt).toBe(false)
    seed({ employee_financial_records: [rec(REC1)] })
    await call(F.commissionPay, { params: { id: REC1 }, body: { bankAccountId: 'ba1' } })
    expect(events()[0]!.payload.without_receipt).toBe(true)
  })

  it('without_receipt: leitura do recebido falha => NÃO afirma "sem recebimento" (sem falha o mesmo cenário daria true)', async () => {
    seed({ employee_financial_records: [rec(REC1)] })
    failNth('financial_transactions', 2) // 1=insert da despesa, 2=leitura do recebido
    await call(F.commissionPay, { params: { id: REC1 }, body: { bankAccountId: 'ba1' } })
    expect(events()[0]!.payload.without_receipt).toBe(false)
  })
})

describe('M4: remoções só se o banco confirmou', () => {
  it('cancel: delete de uma comissão com erro => commission.removed só da confirmada; order.cancelled mantido', async () => {
    seed({ service_orders: [order({ status: 'open' })], employee_financial_records: [rec(REC1), rec(REC2)] })
    failNth('employee_financial_records', 2) // 1=leitura, 2=delete da REC1
    await call(F.cancel)
    expect(order_()).toEqual(['order.cancelled', 'commission.removed'])
    expect(events()[1]!.entity_id).toBe(REC2)
  })

  it('cancel: update do status falha (updatedOrder nulo) => nenhum evento, nem de comissão', async () => {
    seed({ service_orders: [order({ status: 'open' })], employee_financial_records: [rec(REC1)] })
    failNth('service_orders', 2) // 1=leitura, 2=update de status
    await call(F.cancel)
    expect(events()).toHaveLength(0)
  })

  it('payment.delete: delete de comissão com erro => só as confirmadas viram commission.removed', async () => {
    seed({ service_order_installments: [inst(INST1, 1)], employee_financial_records: [rec(REC1), rec(REC2)] })
    failNth('employee_financial_records', 3) // 1=guarda de comissão paga, 2=leitura, 3=delete da REC1
    await call(F.paymentDelete, { method: 'DELETE' })
    expect(order_()).toEqual(['payment.deleted', 'commission.removed'])
    expect(events()[1]!.entity_id).toBe(REC2)
  })

  it('payment.delete: delete de parcela com erro => installments_removed conta só as confirmadas', async () => {
    seed({ service_order_installments: [inst(INST1, 1), inst(INST2, 2)] })
    failNth('service_order_installments', 2) // 1=leitura, 2=delete da parcela 1
    await call(F.paymentDelete, { method: 'DELETE' })
    expect(events()[0]!.payload.installments_removed).toBe(1)
  })

  it('payment.deleted: só sinal pago => grava com received_total do caixa real; nada recebido e nada removido => não grava', async () => {
    seed({ service_order_installments: [inst(INST1, 1, { kind: 'down_payment', status: 'paid', amount: 100 })] })
    await call(F.paymentDelete, { method: 'DELETE' })
    expect(events()[0]).toMatchObject({ event_type: 'payment.deleted' })
    expect(events()[0]!.payload).toEqual({ installments_removed: 1, received_total: 0 })
    seed()
    await call(F.paymentDelete, { method: 'DELETE' })
    expect(events()).toHaveLength(0)
  })

  // Corrigido: leitura do recebido falhando não vira "R$ 0,00"; o histórico grava received_total null (desconhecido).
  it('payment.deleted: leitura do recebido falha => received_total é null (desconhecido), não 0', async () => {
    seed({ service_order_installments: [inst(INST1, 1)] })
    failNth('financial_transactions', 1)
    await call(F.paymentDelete, { method: 'DELETE' })
    expect(events()[0]!.payload).toEqual({ installments_removed: 1, received_total: null })
  })

  it('payment.deleted: sem parcela removida e leitura do recebido falhando => não grava', async () => {
    seed()
    failNth('financial_transactions', 1)
    await call(F.paymentDelete, { method: 'DELETE' })
    expect(events()).toHaveLength(0)
  })
})

describe('textos automáticos e vazamento', () => {
  it('nenhuma cascata grava o motivo automático "Estorno automático" no evento', async () => {
    const chk = () => expect(JSON.stringify(events())).not.toMatch(/estorno autom/i)
    seed({ service_orders: [order({ payment_status: 'paid' })], service_order_installments: [inst(INST1, 1, { status: 'paid', financial_transaction_id: TX1 })], financial_transactions: [tx(TX1, { service_order_installment_id: INST1 })] })
    await call(F.txDelete, { method: 'DELETE', params: { transactionId: TX1 } }); chk()
    seed({ service_order_installments: [inst(INST1, 1, { status: 'paid', financial_transaction_id: TX1 })], financial_transactions: [tx(TX1)], employee_financial_records: [rec(REC1)] })
    await call(F.paymentDelete, { method: 'DELETE' }); chk()
    seed({ service_orders: [order({ status: 'open' })], employee_financial_records: [rec(REC1)] })
    await call(F.cancel); chk()
    expect(events().length).toBeGreaterThan(0)
  })

  it('process-payment com comissões e funcionários no banco: eventos sem commissions[], e-mail, nome de funcionário ou ids', async () => {
    seed({ employee_financial_records: [rec(REC1)], service_orders: [order({ responsible_employees: [{ employee_id: 'emp1' }] })] })
    await call(F.process, { body: { paymentMethod: 'pix', bankAccountId: 'ba1', installments: [{ amount: 100, status: 'paid' }, { amount: 200, status: 'pending', due_date: '2026-12-05' }] } })
    expect(events().length).toBeGreaterThan(0)
    const json = JSON.stringify(events())
    for (const bad of ['@', '"commissions"', 'emp1', 'João', REC1]) expect(json).not.toContain(bad)
    expect(events().filter(e => String(e.event_type).startsWith('commission.'))).toEqual([])
    expect(json).not.toMatch(/commission/i)
  })
})

describe('origem financial_bulk em pay-entries-bulk e withOrigin', () => {
  it('x-origin financial_bulk (o default do endpoint) é aceito como declared em ambos os tipos de evento', async () => {
    seed({ employee_financial_records: [rec(REC1)], financial_transactions: [etx(TX1, { employee_financial_record_id: REC1 }), etx(TX2, { service_order_id: 'o2', type: 'income' })] })
    await call(F.bulkEntries, { body: { entryIds: [TX1, TX2] }, headers: { 'x-origin': 'financial_bulk' } })
    expect(events()).toHaveLength(2)
    for (const e of events()) expect(src(e)).toEqual(['financial_bulk', 'declared', 'financial_bulk'])
  })

  it('withOrigin: define x-origin e preserva method, body e outros headers (inclusive Headers/array)', () => {
    const out = withOrigin('financial_bulk', { method: 'POST', body: { a: 1 }, headers: { Authorization: 'Bearer t', 'X-Other': '1' } })
    expect(out).toMatchObject({ method: 'POST', body: { a: 1 } })
    expect(out.headers).toEqual({ authorization: 'Bearer t', 'x-other': '1', 'x-origin': 'financial_bulk' })
    expect(withOrigin('os_detail', { headers: new Headers({ 'X-A': 'b' }) }).headers).toEqual({ 'x-a': 'b', 'x-origin': 'os_detail' })
    expect(withOrigin('os_detail', {}).headers).toEqual({ 'x-origin': 'os_detail' })
  })

  it('withOrigin é override explícito: sobrescreve x-origin já presente (o plugin é que só preenche quando falta)', () => {
    expect(withOrigin('commission_bulk', { headers: { 'x-origin': 'os_detail' } }).headers['x-origin']).toBe('commission_bulk')
  })

  it('withOrigin não muta o objeto de opções recebido', () => {
    const opts = { method: 'POST', headers: { a: 'b' } }
    withOrigin('os_detail', opts)
    expect(opts.headers).toEqual({ a: 'b' })
  })
})

describe('B2: resolveEntryOsLink com registro que não é comissão de OS', () => {
  const link = (entry: Row) => resolveEntryOsLink(fake.client, 'org-a', entry)
  beforeEach(() => seed({ employee_financial_records: [rec(REC1, { record_type: 'bonus' }), rec(REC2, { service_order_id: null }), rec(REC3, { organization_id: 'org-b' })] }))

  it('registro não-comissão (ex.: bônus) => cai em entry.* só se o lançamento tem OS; senão null', async () => {
    expect(await link({ employee_financial_record_id: REC1, service_order_id: 'o2' })).toEqual({ kind: 'entry', serviceOrderId: 'o2' })
    expect(await link({ employee_financial_record_id: REC1, service_order_id: null })).toBeNull()
    expect(await link({ employee_financial_record_id: REC2, service_order_id: null })).toBeNull()
  })

  it('registro de outra organização não é lido (tenant): sem vínculo de comissão', async () => {
    expect(await link({ employee_financial_record_id: REC3, service_order_id: null })).toBeNull()
  })

  it('comissão de OS => kind=commission com nome; sem vínculo algum => null', async () => {
    seed({ employee_financial_records: [rec(REC1)] })
    expect(await link({ employee_financial_record_id: REC1 })).toMatchObject({ kind: 'commission', serviceOrderId: 'o1', recordId: REC1, employeeName: 'João Mecânico', recordPaid: false })
    expect(await link({})).toBeNull()
  })

  it('handler: lançamento ligado a bônus (sem OS) pago fora da OS => zero eventos', async () => {
    seed({ employee_financial_records: [rec(REC1, { record_type: 'bonus' })], financial_transactions: [etx(TX1, { employee_financial_record_id: REC1 })] })
    expect((await call(F.entryPay, { params: { id: TX1 } })).status).toBe(200)
    expect(events()).toHaveLength(0)
    expect(OS_SOURCE_POLICIES.financialEntries.defaultSource).toBe('financial_entries')
  })
})
