// Histórico da OS (F1): eventos gravados por ações FORA da OS (comissões e lançamentos financeiros).
// Handlers reais + fake supabase (padrão de history-endpoint.test.ts). Cobre OSH-110, 122-129, 150-152, 160-162.
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

const F = {
  commissionPay: 'server/api/reports/commissions/[id]/pay.post.ts',
  commissionDelete: 'server/api/reports/commissions/[id].delete.ts',
  bulkCommissions: 'server/api/financial/pay-commissions-bulk.post.ts',
  bulkEntries: 'server/api/financial/pay-entries-bulk.post.ts',
  entryPay: 'server/api/financial/[id]/pay.post.ts',
  entryPut: 'server/api/financial/[id].put.ts',
  entryDelete: 'server/api/financial/[id].delete.ts'
}

const RID = '22222222-2222-4222-8222-222222222222'
const REC1 = '00000000-0000-4000-8000-0000000000a1'
const REC2 = '00000000-0000-4000-8000-0000000000a2'
const REC3 = '00000000-0000-4000-8000-0000000000a3'
const TX_C = '00000000-0000-4000-8000-0000000000c1'
const TX_O = '00000000-0000-4000-8000-0000000000c2'
const TX_L = '00000000-0000-4000-8000-0000000000c3'

type Row = Record<string, any>
const login = (persona: Persona = 'admin') => {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

const rec = (id: string, over: Row = {}): Row => ({
  id, organization_id: 'org-a', employee_id: 'emp1', service_order_id: 'o1', record_type: 'commission', status: 'pending',
  amount: 50, description: 'Comissão OS1', deleted_at: null, ...over
})
const tx = (id: string, over: Row = {}): Row => ({
  id, organization_id: 'org-a', status: 'pending', type: 'expense', amount: 50, due_date: '2026-11-10', description: 'Lançamento',
  bank_account_id: 'ba1', deleted_at: null, service_order_id: null, employee_financial_record_id: null, ...over
})

function seed(extra: Record<string, Row[]> = {}, codes = ['financial.update', 'financial.delete']) {
  fake = createFakeSupabase(guardSeed(codes, {
    service_orders: [{ id: 'o1', organization_id: 'org-a' }, { id: 'o2', organization_id: 'org-a' }, { id: 'o3', organization_id: 'org-a' }],
    employees: [{ id: 'emp1', organization_id: 'org-a', name: 'João Mecânico' }],
    bank_accounts: [{ id: 'ba1', organization_id: 'org-a', current_balance: 1000, is_active: true, name: 'Caixa Principal' }],
    bank_account_statements: [], financial_categories: [], financial_transactions: [], employee_financial_records: [],
    service_order_installments: [], service_order_events: [],
    ...extra
  }))
  login()
}

const call = (file: string, o: { params?: Record<string, string>, body?: unknown, headers?: Record<string, string>, method?: string } = {}) => {
  const e = fakeEvent({ method: o.method ?? 'POST', cookies: { 'sb-access-token': 'tok' }, params: o.params, body: o.body, headers: o.headers })
  ;(e as any).context = { audit: { requestId: RID, userId: USERS.admin.id, actorType: 'user' } }
  return callHandler(file, e)
}
const events = (type?: string): Row[] => ((fake.tables.service_order_events ?? []) as Row[]).filter(e => !type || e.event_type === type)
const src = (e: Row) => [e.source_code, e.source_trust, e.source_declared]

beforeEach(() => {
  auth.refreshSession.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('reports/commissions/:id/pay (OSH-122)', () => {
  const pay = (headers?: Record<string, string>) => call(F.commissionPay, { params: { id: REC1 }, body: { bankAccountId: 'ba1' }, headers })
  beforeEach(() => seed({ employee_financial_records: [rec(REC1)] }))

  it('grava 1 commission.paid (commission/commission), snapshot legível, chave determinística, org da sessão', async () => {
    const res = await pay({ 'x-origin': 'commission_report' })
    expect(res.status).toBe(200)
    expect(events()).toHaveLength(1)
    const e = events('commission.paid')[0]!
    expect(e).toMatchObject({
      organization_id: 'org-a', service_order_id: 'o1', category: 'commission', visibility: 'commission',
      entity_type: 'employee_financial_record', entity_id: REC1, correlation_id: RID
    })
    const txId = (fake.tables.financial_transactions as Row[])[0]!.id
    expect(e.idempotency_key).toBe(`commission_paid:${REC1}:${txId}`)
    expect(e.payload).toMatchObject({ employee_name: 'João Mecânico', amount: 50, bank_account_name: 'Caixa Principal', without_receipt: true })
    expect(e.payload.via_entry).toBeUndefined()
    const json = JSON.stringify(e)
    expect(json).not.toContain('@')
    expect(json).not.toContain('emp1')
  })

  it.each([
    [{ 'x-origin': 'commission_report' }, ['commission_report', 'declared', 'commission_report']],
    [{ 'x-origin': 'bonus_page' }, ['bonus_page', 'declared', 'bonus_page']],
    [{}, ['commission_report', 'inferred', null]],
    [{ 'x-origin': 'financial_bulk' }, ['commission_report', 'mismatch', 'financial_bulk']],
    [{ 'x-origin': 'lixo' }, ['commission_report', 'inferred', null]]
  ])('origem %j -> %j', async (headers, expected) => {
    expect((await pay(headers as Record<string, string>)).status).toBe(200)
    expect(src(events('commission.paid')[0]!)).toEqual(expected)
  })

  it('comissão que não é de OS (sem service_order_id) ou de outro tipo: paga sem evento', async () => {
    seed({ employee_financial_records: [rec(REC1, { service_order_id: null })] })
    expect((await pay()).status).toBe(200)
    seed({ employee_financial_records: [rec(REC1, { record_type: 'bonus' })] })
    expect((await pay()).status).toBe(200)
    expect(events()).toHaveLength(0)
  })

  it('negócio recusa (já paga / conta inválida): erro e zero eventos', async () => {
    seed({ employee_financial_records: [rec(REC1, { status: 'paid' })] })
    expect((await pay()).status).toBe(400)
    seed({ employee_financial_records: [rec(REC1)] })
    expect((await call(F.commissionPay, { params: { id: REC1 }, body: { bankAccountId: 'inexistente' } })).status).toBe(400)
    expect(events()).toHaveLength(0)
  })

  it('OSH-152: falha do passo final do negócio faz rollback e NÃO deixa evento órfão', async () => {
    const real = fake.client.from.bind(fake.client)
    let n = 0
    ;(fake.client as any).from = (t: string) => {
      if (t === 'employee_financial_records' && ++n === 2) fake.failNext(t, 'boom') // 1=select, 2=update final
      return real(t)
    }
    const res = await pay()
    expect(res.status).toBe(500)
    expect(events()).toHaveLength(0)
    expect((fake.tables.bank_accounts as Row[])[0]!.current_balance).toBe(1000)
  })

  it('org de outra organização: 404 sem evento (OSH-162, caminho unitário)', async () => {
    seed({ employee_financial_records: [rec(REC1, { organization_id: 'org-b' })] })
    expect((await pay()).status).toBe(404)
    expect(events()).toHaveLength(0)
  })
})

describe('reports/commissions/:id (DELETE) (OSH-125)', () => {
  const del = (headers?: Record<string, string>) => call(F.commissionDelete, { method: 'DELETE', params: { id: REC1 }, headers })

  it('commission.removed com snapshot (era paga), chave por registro, sem id cru no payload', async () => {
    seed({ employee_financial_records: [rec(REC1, { status: 'paid', amount: 80 })] })
    expect((await del()).status).toBe(200)
    expect(fake.tables.employee_financial_records).toHaveLength(0)
    const e = events('commission.removed')[0]!
    expect(events()).toHaveLength(1)
    expect(e).toMatchObject({ category: 'commission', visibility: 'commission', service_order_id: 'o1', entity_id: REC1, idempotency_key: `commission_removed:${REC1}` })
    expect(e.payload).toEqual({ employee_name: 'João Mecânico', amount: 80, was_paid: true, reason: 'manual_delete' })
    expect(src(e)).toEqual(['commission_report', 'inferred', null])
  })

  it('origem declarada os_detail aceita; outra (financial_bulk) vira mismatch', async () => {
    seed({ employee_financial_records: [rec(REC1)] })
    await del({ 'x-origin': 'os_detail' })
    expect(src(events()[0]!)).toEqual(['os_detail', 'declared', 'os_detail'])
    seed({ employee_financial_records: [rec(REC1)] })
    await del({ 'x-origin': 'financial_bulk' })
    expect(src(events()[0]!)).toEqual(['commission_report', 'mismatch', 'financial_bulk'])
  })

  it('comissão sem OS, 404: zero eventos', async () => {
    seed({ employee_financial_records: [rec(REC1, { service_order_id: null })] })
    expect((await del()).status).toBe(200)
    seed()
    expect((await del()).status).toBe(404)
    expect(events()).toHaveLength(0)
  })
})

describe('pay-commissions-bulk (OSH-123, 124, 151, 162)', () => {
  const recs = () => [rec(REC1, { service_order_id: 'o1' }), rec(REC2, { service_order_id: 'o2' }), rec(REC3, { service_order_id: 'o3' })]
  const bulk = (headers?: Record<string, string>, ids = [REC1, REC2, REC3]) => call(F.bulkCommissions, { body: { registroIds: ids, contaBancariaId: 'ba1' }, headers })

  it('3 comissões de 3 OS: 3 eventos (1 por OS), mesmo correlation_id, origem por header', async () => {
    seed({ employee_financial_records: recs() })
    const res = await bulk({ 'x-origin': 'os_detail' })
    expect((res.body as any).data.paidCount).toBe(3)
    const ev = events('commission.paid')
    expect(events()).toHaveLength(3)
    expect(ev.map(e => e.service_order_id).sort()).toEqual(['o1', 'o2', 'o3'])
    expect(new Set(ev.map(e => e.correlation_id))).toEqual(new Set([RID]))
    expect(ev.every(e => e.visibility === 'commission' && e.category === 'commission')).toBe(true)
    expect(new Set(ev.map(e => e.idempotency_key)).size).toBe(3)
    expect(ev.every(e => src(e).join() === 'os_detail,declared,os_detail')).toBe(true)
  })

  it.each([
    [{ 'x-origin': 'os_detail' }, ['os_detail', 'declared']],
    [{}, ['commission_bulk', 'inferred']],
    [{ 'x-origin': 'commission_bulk' }, ['commission_bulk', 'declared']],
    [{ 'x-origin': 'commission_report' }, ['commission_bulk', 'mismatch']],
    [{ 'x-origin': 'financial_bulk' }, ['commission_bulk', 'mismatch']]
  ])('origem %j -> %j', async (headers, [code, trust]) => {
    seed({ employee_financial_records: recs() })
    await bulk(headers as Record<string, string>)
    for (const e of events()) expect([e.source_code, e.source_trust]).toEqual([code, trust])
  })

  it('OSH-124: 2o item falha no passo final -> eventos só dos confirmados', async () => {
    seed({ employee_financial_records: recs() })
    const real = fake.client.from.bind(fake.client)
    let n = 0
    ;(fake.client as any).from = (t: string) => {
      if (t === 'employee_financial_records' && ++n === 4) fake.failNext(t, 'boom') // sel1,upd1,sel2,upd2
      return real(t)
    }
    const res = await bulk()
    expect((res.body as any).data).toMatchObject({ paidCount: 2, failedCount: 1 })
    expect(events().map(e => e.service_order_id).sort()).toEqual(['o1', 'o3'])
  })

  it('itens ignorados (já pago, adiantamento, não comissão de OS, outra org) não geram evento (OSH-162)', async () => {
    seed({ employee_financial_records: [
      rec(REC1, { status: 'paid' }), rec(REC2, { record_type: 'adiantamento' }),
      rec(REC3, { organization_id: 'org-b', service_order_id: 'o-b' }), rec('00000000-0000-4000-8000-0000000000a4', { service_order_id: null })
    ] })
    const res = await bulk(undefined, [REC1, REC2, REC3, '00000000-0000-4000-8000-0000000000a4'])
    expect((res.body as any).data).toMatchObject({ paidCount: 1, skippedCount: 2, failedCount: 1 })
    expect(events()).toHaveLength(0)
  })

  it('OSH-151: falha ao gravar eventos não derruba o lote nem dispara rollback; resposta idêntica', async () => {
    seed({ employee_financial_records: recs() })
    const baseline = await bulk()
    seed({ employee_financial_records: recs() })
    const real = fake.client.from.bind(fake.client)
    ;(fake.client as any).from = (t: string) => { if (t === 'service_order_events') throw new Error('events down'); return real(t) }
    const res = await bulk()
    expect(res.status).toBe(200)
    expect(res.body).toEqual(baseline.body)
    expect((fake.tables.employee_financial_records as Row[]).every(r => r.status === 'paid')).toBe(true)
    expect(fake.writes.some(w => w.op === 'delete')).toBe(false)
    expect((fake.tables.bank_accounts as Row[])[0]!.current_balance).toBe(850)
  })

  it('resposta não vaza dados crus de comissão do histórico', async () => {
    seed({ employee_financial_records: recs() })
    const res = await bulk()
    expect(JSON.stringify(res.body)).not.toContain('commissions')
    expect(JSON.stringify(events())).not.toContain('@')
  })
})

describe('pay-entries-bulk (OSH-126)', () => {
  const entries = () => [
    tx(TX_C, { employee_financial_record_id: REC1 }),
    tx(TX_O, { type: 'income', service_order_id: 'o2' }),
    tx(TX_L)
  ]
  const bulk = (headers?: Record<string, string>) => call(F.bulkEntries, { body: { entryIds: [TX_C, TX_O, TX_L] }, headers })
  const setup = () => seed({ employee_financial_records: [rec(REC1)], financial_transactions: entries() })

  it('comissão -> commission.paid; OS -> entry.paid_outside_os; avulso -> nada; um por OS, mesmo correlation_id', async () => {
    setup()
    const res = await bulk({ 'x-origin': 'financial_entries' })
    expect((res.body as any).data.paidCount).toBe(3)
    expect(events()).toHaveLength(2)
    const c = events('commission.paid')[0]!
    const o = events('entry.paid_outside_os')[0]!
    expect(c).toMatchObject({ service_order_id: 'o1', visibility: 'commission', category: 'commission', idempotency_key: `commission_paid:${REC1}:${TX_C}` })
    expect(c.payload).toMatchObject({ via_entry: true, record_synced: true })
    expect(o).toMatchObject({ service_order_id: 'o2', visibility: 'financial', category: 'payment', entity_id: TX_O, idempotency_key: `entry_paid:${TX_O}:${RID}` })
    expect(o.payload).toEqual({ amount: 50, entry_type: 'income' })
    expect(events().every(e => e.correlation_id === RID)).toBe(true)
    // exclusividade: lançamento de comissão nunca vira entry.* e o de OS nunca vira commission.*
    expect(events().filter(e => e.service_order_id === 'o1').map(e => e.event_type)).toEqual(['commission.paid'])
    expect(events().filter(e => e.service_order_id === 'o2').map(e => e.event_type)).toEqual(['entry.paid_outside_os'])
  })

  it.each([
    [{}, ['financial_bulk', 'inferred']],
    [{ 'x-origin': 'financial_entries' }, ['financial_entries', 'declared']],
    [{ 'x-origin': 'commission_report' }, ['financial_bulk', 'mismatch']]
  ])('origem %j -> %j', async (headers, [code, trust]) => {
    setup()
    await bulk(headers as Record<string, string>)
    for (const e of events()) expect([e.source_code, e.source_trust]).toEqual([code, trust])
  })

  it('já pago / não encontrado / outra org: sem evento', async () => {
    seed({ financial_transactions: [tx(TX_O, { status: 'paid', service_order_id: 'o2', type: 'income' }), tx(TX_C, { organization_id: 'org-b', service_order_id: 'o-b' })] })
    const res = await call(F.bulkEntries, { body: { entryIds: [TX_O, TX_C] } })
    expect((res.body as any).data).toMatchObject({ paidCount: 0, skippedCount: 1, failedCount: 1 })
    expect(events()).toHaveLength(0)
  })

  it('OSH-150: falha ao gravar evento não muda resposta nem estado', async () => {
    setup()
    const baseline = await bulk()
    setup()
    const real = fake.client.from.bind(fake.client)
    ;(fake.client as any).from = (t: string) => { if (t === 'service_order_events') throw new Error('down'); return real(t) }
    const res = await bulk()
    expect(res.body).toEqual(baseline.body)
    expect((fake.tables.financial_transactions as Row[]).every(r => r.status === 'paid')).toBe(true)
  })
})

describe('financial/:id/pay (OSH-127, 130)', () => {
  const pay = (id: string, headers?: Record<string, string>) => call(F.entryPay, { params: { id }, headers })

  it('lançamento de OS -> entry.paid_outside_os (financial), origem financial_entries', async () => {
    seed({ financial_transactions: [tx(TX_O, { type: 'income', service_order_id: 'o2' })] })
    expect((await pay(TX_O)).status).toBe(200)
    expect(events()).toHaveLength(1)
    expect(events()[0]).toMatchObject({ event_type: 'entry.paid_outside_os', visibility: 'financial', category: 'payment', service_order_id: 'o2', idempotency_key: `entry_paid:${TX_O}:${RID}`, correlation_id: RID })
    expect(src(events()[0]!)).toEqual(['financial_entries', 'inferred', null])
  })

  it('lançamento de comissão -> só commission.paid com record_synced=false; a linha da comissão NÃO muda (D13); nunca entry.*', async () => {
    seed({ employee_financial_records: [rec(REC1)], financial_transactions: [tx(TX_C, { employee_financial_record_id: REC1 })] })
    expect((await pay(TX_C)).status).toBe(200)
    expect(events().map(e => e.event_type)).toEqual(['commission.paid'])
    expect(events()[0]!.payload).toMatchObject({ via_entry: true, record_synced: false, employee_name: 'João Mecânico' })
    expect(events()[0]!.visibility).toBe('commission')
    expect((fake.tables.employee_financial_records as Row[])[0]!.status).toBe('pending')
  })

  it('avulso, já pago e outra org: zero eventos', async () => {
    seed({ financial_transactions: [tx(TX_L), tx(TX_O, { status: 'paid', service_order_id: 'o2' }), tx(TX_C, { organization_id: 'org-b', service_order_id: 'o-b' })] })
    expect((await pay(TX_L)).status).toBe(200)
    expect((await pay(TX_O)).status).toBe(400)
    expect((await pay(TX_C)).status).toBe(404)
    expect(events()).toHaveLength(0)
  })

  it('header de outro endpoint vira mismatch sem alterar ator/org/correlation', async () => {
    seed({ financial_transactions: [tx(TX_O, { type: 'income', service_order_id: 'o2' })] })
    await pay(TX_O, { 'x-origin': 'commission_report' })
    expect(src(events()[0]!)).toEqual(['financial_entries', 'mismatch', 'commission_report'])
    expect(events()[0]).toMatchObject({ organization_id: 'org-a', correlation_id: RID })
  })

  it('OSH-150: falha do evento -> mesma resposta, lançamento pago', async () => {
    seed({ financial_transactions: [tx(TX_O, { type: 'income', service_order_id: 'o2' })] })
    const baseline = await pay(TX_O)
    seed({ financial_transactions: [tx(TX_O, { type: 'income', service_order_id: 'o2' })] })
    const real = fake.client.from.bind(fake.client)
    ;(fake.client as any).from = (t: string) => { if (t === 'service_order_events') throw new Error('down'); return real(t) }
    const res = await pay(TX_O)
    expect(res.body).toEqual(baseline.body)
    expect((fake.tables.financial_transactions as Row[])[0]!.status).toBe('paid')
  })
})

describe('financial/:id PUT (OSH-128)', () => {
  const put = (id: string, body: Row, headers?: Record<string, string>) => call(F.entryPut, { method: 'PUT', params: { id }, body, headers })
  const setup = () => seed({
    employee_financial_records: [rec(REC1)],
    financial_transactions: [tx(TX_O, { type: 'income', service_order_id: 'o2' }), tx(TX_C, { employee_financial_record_id: REC1 }), tx(TX_L)]
  })

  it('lançamento de OS: entry.edited com de/para; comissão: commission.entry_edited; avulso: zero e 200', async () => {
    setup()
    expect((await put(TX_O, { amount: 70 })).status).toBe(200)
    expect((await put(TX_C, { amount: 60, due_date: '2026-12-01' })).status).toBe(200)
    expect((await put(TX_L, { amount: 99 })).status).toBe(200)
    expect(events()).toHaveLength(2)
    const o = events('entry.edited')[0]!
    expect(o).toMatchObject({ service_order_id: 'o2', visibility: 'financial', category: 'payment', idempotency_key: `entry_edited:${TX_O}:${RID}` })
    expect(o.payload).toEqual({ changes: [{ field: 'amount', from: 50, to: 70 }] })
    const c = events('commission.entry_edited')[0]!
    expect(c).toMatchObject({ service_order_id: 'o1', visibility: 'commission', category: 'commission', idempotency_key: `commission_entry_edited:${TX_C}:${RID}` })
    expect(c.payload).toEqual({ employee_name: 'João Mecânico', changes: [{ field: 'amount', from: 50, to: 60 }, { field: 'due_date', from: '2026-11-10', to: '2026-12-01' }] })
    expect(src(o)).toEqual(['financial_entries', 'inferred', null])
  })

  it('sem mudança relevante (mesmo valor / campo fora da allowlist): zero eventos', async () => {
    setup()
    expect((await put(TX_O, { amount: 50, notes: 'obs' })).status).toBe(200)
    expect(events()).toHaveLength(0)
  })

  it('conta bancária vira nome, nunca id', async () => {
    setup()
    ;(fake.tables.bank_accounts as Row[]).push({ id: 'ba2', organization_id: 'org-a', current_balance: 0, name: 'Cofre' })
    await put(TX_O, { bank_account_id: 'ba2' })
    expect(events()[0]!.payload.changes).toEqual([{ field: 'bank_account', from: 'Caixa Principal', to: 'Cofre' }])
    expect(JSON.stringify(events())).not.toContain('ba2')
  })

  it('404 e outra org: zero eventos', async () => {
    seed({ financial_transactions: [tx(TX_O, { organization_id: 'org-b', service_order_id: 'o-b' })] })
    expect((await put(TX_O, { amount: 1 })).status).toBe(404)
    expect(events()).toHaveLength(0)
  })

  it('OSH-150: falha do evento -> mesma resposta, valor gravado', async () => {
    setup()
    const baseline = await put(TX_O, { amount: 70 })
    setup()
    const real = fake.client.from.bind(fake.client)
    ;(fake.client as any).from = (t: string) => { if (t === 'service_order_events') throw new Error('down'); return real(t) }
    const res = await put(TX_O, { amount: 70 })
    expect(res.body).toEqual(baseline.body)
    expect((fake.tables.financial_transactions as Row[]).find(r => r.id === TX_O)!.amount).toBe(70)
  })
})

describe('financial/:id DELETE (OSH-129, 108)', () => {
  const del = (id: string, body: Row = { reason: 'duplicado' }, headers?: Record<string, string>) => call(F.entryDelete, { method: 'DELETE', params: { id }, body, headers })

  it('recebimento de OS -> receipt.reversed (financial_entries) com motivo; sem entry.deleted duplicado', async () => {
    seed({
      service_orders: [{ id: 'o2', organization_id: 'org-a', total_amount: 100, payment_status: 'paid', status: 'completed', commission_release_mode: null, items: [], responsible_employees: [] }],
      financial_transactions: [tx(TX_O, { type: 'income', status: 'paid', service_order_id: 'o2', payment_method: 'pix' })]
    })
    const res = await del(TX_O)
    expect(res.status).toBe(200)
    expect(events('receipt.reversed')).toHaveLength(1)
    expect(events('entry.deleted')).toHaveLength(0)
    const e = events('receipt.reversed')[0]!
    expect(e).toMatchObject({ visibility: 'financial', category: 'payment', idempotency_key: `receipt_reversed:${TX_O}` })
    expect(e.payload).toMatchObject({ amount: 50, payment_method: 'pix', reason: 'duplicado' })
    expect(src(e)).toEqual(['financial_entries', 'inferred', null])
  })

  it('lançamento de comissão -> commission.entry_deleted (nunca entry.*), sem tocar na linha da comissão', async () => {
    seed({ employee_financial_records: [rec(REC1)], financial_transactions: [tx(TX_C, { employee_financial_record_id: REC1 })] })
    expect((await del(TX_C)).status).toBe(200)
    expect(events().map(e => e.event_type)).toEqual(['commission.entry_deleted'])
    expect(events()[0]).toMatchObject({ visibility: 'commission', idempotency_key: `commission_entry_deleted:${TX_C}` })
    expect(events()[0]!.payload).toEqual({ employee_name: 'João Mecânico', amount: 50, reason: 'duplicado' })
    expect(fake.tables.employee_financial_records).toHaveLength(1)
  })

  it('avulso, sem motivo (400) e outra org (404): zero eventos', async () => {
    seed({ financial_transactions: [tx(TX_L), tx(TX_O, { organization_id: 'org-b', service_order_id: 'o-b', type: 'income' })] })
    expect((await del(TX_L)).status).toBe(200)
    expect((await del(TX_L, {})).status).toBe(400)
    expect((await del(TX_O)).status).toBe(404)
    expect(events()).toHaveLength(0)
  })

  it('OSH-150: falha do evento -> mesma resposta, lançamento removido', async () => {
    const s = () => seed({ employee_financial_records: [rec(REC1)], financial_transactions: [tx(TX_C, { employee_financial_record_id: REC1 })] })
    s()
    const baseline = await del(TX_C)
    s()
    const real = fake.client.from.bind(fake.client)
    ;(fake.client as any).from = (t: string) => { if (t === 'service_order_events') throw new Error('down'); return real(t) }
    const res = await del(TX_C)
    expect(res.body).toEqual(baseline.body)
    expect(events()).toHaveLength(0)
  })
})

describe('OSH-161: origem não concede nem retira acesso', () => {
  it.each([
    ['commissionPay', { id: REC1 }, {}],
    ['commissionDelete', { id: REC1 }, {}],
    ['bulkCommissions', {}, { registroIds: [REC1] }],
    ['bulkEntries', {}, { entryIds: [TX_L] }],
    ['entryPay', { id: TX_L }, {}],
    ['entryPut', { id: TX_L }, { amount: 1 }],
    ['entryDelete', { id: TX_L }, { reason: 'x' }]
  ])('%s: usuário sem permissão recebe 403 com ou sem x-origin e nenhum evento', async (key, params, body) => {
    seed({ employee_financial_records: [rec(REC1)], financial_transactions: [tx(TX_L)] }, ['financial.update', 'financial.delete'])
    ;(fake.tables.role_actions as Row[]).length = 0
    login('com')
    const file = F[key as keyof typeof F]
    const without = await call(file, { params: params as Record<string, string>, body })
    const withHeader = await call(file, { params: params as Record<string, string>, body, headers: { 'x-origin': 'commission_report' } })
    expect(without.status).toBe(403)
    expect(withHeader.status).toBe(403)
    expect(events()).toHaveLength(0)
  })
})
