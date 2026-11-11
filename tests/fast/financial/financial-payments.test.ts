// Pagamentos fora da OS, pagamento de comissão, cancelamento e geração manual de comissões.
// Cenários P45–P48, C37, C38, C42, C43, E18, E19 de docs/testing/financial-core-test-analysis.md.
// Banco em memória (sem gatilhos/RPC/concorrência): ver §6 do documento.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))
vi.mock('../../../server/utils/employee-commission-plans', () => ({
  resolveEmployeeCommissionRulesForEmployees: vi.fn(async (_s: unknown, _o: string, ids: string[]) =>
    new Map(ids.map(id => [id, [{ id: 'r10', plan_id: 'p1', version_id: 'v1', name: '10%', commission_type: 'percentage', commission_amount: 10, commission_base: 'revenue', category_ids: [], is_default: true }]]))),
  resolveCommissionPlanRules: vi.fn(async () => []),
  fetchCommissionPlan: vi.fn(async () => null)
}))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const H = {
  finPay: 'server/api/financial/[id]/pay.post.ts',
  finDelete: 'server/api/financial/[id].delete.ts',
  bulk: 'server/api/financial/pay-entries-bulk.post.ts',
  commBulk: 'server/api/financial/pay-commissions-bulk.post.ts',
  commPay: 'server/api/reports/commissions/[id]/pay.post.ts',
  purchasePay: 'server/api/purchases/[id]/pay.post.ts',
  cancel: 'server/api/service-orders/[id]/cancel.post.ts',
  generate: 'server/api/service-orders/[id]/generate-commissions.post.ts',
  process: 'server/api/service-orders/[id]/process-payment.post.ts'
}

const org = (organization_id: string) => ({ organization_id, deleted_at: null })

function seed() {
  fake = createFakeSupabase({
    user_profiles: [
      { id: 'p1', user_id: 'u1', organization_id: 'org-a', role_id: 'r', is_owner: false, is_active: true, employee_id: null },
      { id: 'p2', user_id: 'u2', organization_id: 'org-b', role_id: 'r', is_owner: false, is_active: true, employee_id: null }
    ],
    bank_accounts: [
      { id: 'acc-a', organization_id: 'org-a', current_balance: 1000, is_active: true },
      { id: 'acc-b', organization_id: 'org-b', current_balance: 50, is_active: true }
    ],
    bank_account_statements: [],
    financial_categories: [
      { id: 'cat-sal', ...org('org-a'), name: 'Salários', type: 'expense', is_default: true },
      { id: 'cat-sal-b', ...org('org-b'), name: 'Salários', type: 'expense', is_default: true },
      { id: 'cat-srv', ...org('org-a'), name: 'Serviços', type: 'income', is_default: true }
    ],
    financial_transactions: [
      { id: 'exp1', ...org('org-a'), type: 'expense', status: 'pending', amount: 80, due_date: '2026-03-10', bank_account_id: 'acc-a', description: 'Aluguel' },
      { id: 'inc1', ...org('org-a'), type: 'income', status: 'pending', amount: 120, due_date: '2026-03-11', bank_account_id: 'acc-a', description: 'Venda balcão' },
      { id: 'paid1', ...org('org-a'), type: 'expense', status: 'paid', amount: 10, due_date: '2026-03-01', bank_account_id: 'acc-a' },
      { id: 'noacc', ...org('org-a'), type: 'expense', status: 'pending', amount: 30, due_date: '2026-03-12', bank_account_id: null },
      { id: 'exp-b', ...org('org-b'), type: 'expense', status: 'pending', amount: 20, due_date: '2026-03-10', bank_account_id: 'acc-b' }
    ],
    employees: [{ id: 'e1', ...org('org-a'), name: 'Ana' }],
    employee_financial_records: [
      { id: 'cm1', ...org('org-a'), employee_id: 'e1', record_type: 'commission', amount: 100, status: 'pending', service_order_id: 'o1', reference_date: '2026-03-05', description: 'Comissão OS 1' },
      { id: 'cm2', ...org('org-a'), employee_id: 'e1', record_type: 'commission', amount: 40, status: 'pending', service_order_id: 'o1', reference_date: '2026-03-06', description: 'Comissão OS 1 (b)' },
      { id: 'cm-paid', ...org('org-a'), employee_id: 'e1', record_type: 'commission', amount: 60, status: 'paid', service_order_id: 'o1', reference_date: '2026-03-07' },
      { id: 'adv1', ...org('org-a'), employee_id: 'e1', record_type: 'adiantamento', amount: 70, status: 'pending', reference_date: '2026-03-08' },
      { id: 'cm-b', ...org('org-b'), employee_id: 'e9', record_type: 'commission', amount: 500, status: 'pending', reference_date: '2026-03-05' }
    ],
    service_orders: [
      {
        id: 'o1', ...org('org-a'), number: '100', status: 'completed', entry_date: '2026-03-10', total_amount: 1000,
        discount: 0, total_taxes_amount: 0, payment_status: 'pending', commission_release_mode: null,
        commission_manual_adjustments_log: [], responsible_employees: [{ employee_id: 'e1' }],
        items: [{ id: 'it1', total_price: 1000, cost_price: 0, quantity: 1 }]
      },
      { id: 'o-b', ...org('org-b'), number: '900', status: 'completed', total_amount: 500, payment_status: 'pending' }
    ],
    service_order_installments: [],
    purchases: [
      { id: 'pu1', ...org('org-a'), total_amount: 700, payment_status: 'pending', bank_account_id: 'acc-a', purchase_date: '2026-03-10' },
      { id: 'pu-b', ...org('org-b'), total_amount: 90, payment_status: 'pending', bank_account_id: 'acc-b', purchase_date: '2026-03-10' }
    ]
  })
}

beforeEach(() => {
  seed()
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@a.com' } }, error: null })
  auth.refreshSession.mockReset()
})

const post = (file: string, params: Record<string, string> = {}, body: unknown = {}, method = 'POST') =>
  callHandler(file, fakeEvent({ method, cookies, params, body }))

const balance = (id = 'acc-a') => fake.tables.bank_accounts!.find(a => a.id === id)!.current_balance as number
const tx = (id: string) => fake.tables.financial_transactions!.find(t => t.id === id)!
const rec = (id: string) => fake.tables.employee_financial_records!.find(r => r.id === id)
const statements = (acc = 'acc-a') => fake.tables.bank_account_statements!.filter(s => s.bank_account_id === acc)
/** I10: Σ extrato (com sinal) == Δ saldo. */
const signed = (acc = 'acc-a') => Number(statements(acc).reduce((s, x) => s + (x.transaction_type === 'income' ? 1 : -1) * Number(x.amount), 0).toFixed(2))
const expectI10 = (start: number, acc = 'acc-a') => expect(Number((balance(acc) - start).toFixed(2))).toBe(signed(acc))

describe('P45 / KF-43: pay purchase (product decision)', () => {
  it('today it only changes the purchase status: does not create an entry, statement or touch the balance', async () => {
    const r = await post(H.purchasePay, { id: 'pu1' }, { payment_date: '2026-03-15' })
    expect(r.status).toBe(200)
    expect(fake.tables.purchases!.find(p => p.id === 'pu1')).toMatchObject({ payment_status: 'paid', payment_date: '2026-03-15' })
    expect(balance()).toBe(1000)
    expect(statements()).toHaveLength(0)
    expect(fake.tables.financial_transactions!.filter(t => t.purchase_id === 'pu1')).toHaveLength(0)
  })
  it('paying twice → 400', async () => {
    await post(H.purchasePay, { id: 'pu1' }, {})
    expect((await post(H.purchasePay, { id: 'pu1' }, {})).status).toBe(400)
  })
  it('purchase from another organization → 404 and nothing changes', async () => {
    expect((await post(H.purchasePay, { id: 'pu-b' }, {})).status).toBe(404)
    expect(fake.tables.purchases!.find(p => p.id === 'pu-b')!.payment_status).toBe('pending')
  })
})

describe('P46: financial/:id/pay (KF-18 regression)', () => {
  it('expense: balance −amount, 1 statement with before/after, entry paid', async () => {
    const r = await post(H.finPay, { id: 'exp1' })
    expect(r.status).toBe(200)
    expect(balance()).toBe(920)
    expect(statements()).toHaveLength(1)
    expect(statements()[0]).toMatchObject({ previous_balance: 1000, balance_after: 920, amount: 80, transaction_type: 'expense', financial_transaction_id: 'exp1' })
    expect(tx('exp1').status).toBe('paid')
    expectI10(1000)
  })
  it('income: balance +amount', async () => {
    await post(H.finPay, { id: 'inc1' })
    expect(balance()).toBe(1120)
    expectI10(1000)
  })
  it('already paid → 400 and balance does not move; paying twice moves it only once', async () => {
    expect((await post(H.finPay, { id: 'paid1' })).status).toBe(400)
    await post(H.finPay, { id: 'exp1' })
    expect((await post(H.finPay, { id: 'exp1' })).status).toBe(400)
    expect(balance()).toBe(920)
    expect(statements()).toHaveLength(1)
  })
  it('entry from another organization → 404', async () => {
    expect((await post(H.finPay, { id: 'exp-b' })).status).toBe(404)
    expect(balance('acc-b')).toBe(50)
    expect(tx('exp-b').status).toBe('pending')
  })
  it('no bank account: marks as paid and creates no statement', async () => {
    await post(H.finPay, { id: 'noacc' })
    expect(tx('noacc').status).toBe('paid')
    expect(statements()).toHaveLength(0)
    expect(balance()).toBe(1000)
  })
  it('if the statement already exists (created by another flow), does not duplicate it or touch the balance', async () => {
    fake.tables.bank_account_statements!.push({ id: 's0', organization_id: 'org-a', bank_account_id: 'acc-a', financial_transaction_id: 'exp1', amount: 80, transaction_type: 'expense' })
    await post(H.finPay, { id: 'exp1' })
    expect(statements()).toHaveLength(1)
    expect(balance()).toBe(1000)
  })
})

describe('P47: financial/pay-entries-bulk', () => {
  const bulk = (entryIds: unknown) => post(H.bulk, {}, { entryIds })

  it('mixed batch (expense + income): counters, balance and statement reconcile (I10)', async () => {
    const r = await bulk(['exp1', 'inc1'])
    expect((r.body as any).data).toMatchObject({ paidCount: 2, skippedCount: 0, failedCount: 0 })
    expect(balance()).toBe(1040) // −80 + 120
    expect(statements()).toHaveLength(2)
    expectI10(1000)
  })
  it('paid, nonexistent and other-organization items do not break the batch; only the valid one moves', async () => {
    const r = await bulk(['exp1', 'paid1', 'nao-existe', 'exp-b'])
    expect((r.body as any).data).toMatchObject({ paidCount: 1, skippedCount: 1, failedCount: 2 })
    expect(balance()).toBe(920)
    expect(balance('acc-b')).toBe(50)
    expect(tx('exp-b').status).toBe('pending')
  })
  it('repeated ids count once; repeating the whole batch does not pay again', async () => {
    await bulk(['exp1', 'exp1', 'exp1'])
    expect(balance()).toBe(920)
    const again = await bulk(['exp1'])
    expect((again.body as any).data).toMatchObject({ paidCount: 0, skippedCount: 1 })
    expect(balance()).toBe(920)
    expect(statements()).toHaveLength(1)
  })
  it('empty list or more than 200 → 400', async () => {
    expect((await bulk([])).status).toBe(400)
    expect((await bulk(Array.from({ length: 201 }, (_, i) => `x${i}`))).status).toBe(400)
  })
  it('entry without account is paid without statement; with a prior statement it is not duplicated', async () => {
    fake.tables.bank_account_statements!.push({ id: 's0', organization_id: 'org-a', bank_account_id: 'acc-a', financial_transaction_id: 'exp1', amount: 80, transaction_type: 'expense' })
    const r = await bulk(['noacc', 'exp1'])
    expect((r.body as any).data).toMatchObject({ paidCount: 2, extratoSkippedCount: 1 })
    expect(statements()).toHaveLength(1)
    expect(balance()).toBe(1000)
  })
  it('linked commission (employee_financial_record_id) is marked as paid together', async () => {
    Object.assign(tx('exp1'), { employee_financial_record_id: 'cm1' })
    await bulk(['exp1'])
    expect(rec('cm1')!.status).toBe('paid')
  })
  // KF-41: igual ao KF-30, mas no pagamento em lote — o saldo é somado sem arredondar.
  it.fails('KF-41: 10 incomes of R$ 0,10 paid in a batch sum exactly R$ 1,00 in the balance', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `c${i}`)
    for (const id of ids) fake.tables.financial_transactions!.push({ id, ...org('org-a'), type: 'income', status: 'pending', amount: 0.1, due_date: '2026-03-10', bank_account_id: 'acc-a' })
    await bulk(ids)
    expect(balance()).toBe(1001)
  })
})

describe('P48 / KF-42: delete already paid entry', () => {
  // Pago pelo fluxo normal (saldo e extrato movidos); depois o usuário exclui o lançamento.
  it.fails('KF-42: deleting a paid expense restores the balance and removes/reverses the statement (I10)', async () => {
    await post(H.finPay, { id: 'exp1' })
    expect(balance()).toBe(920)
    const r = await post(H.finDelete, { id: 'exp1' }, { reason: 'lançado por engano' }, 'DELETE')
    expect(r.status).toBe(200)
    expect(tx('exp1').deleted_at).toBeTruthy()
    expect(balance()).toBe(1000)
  })
  it('deleting requires a reason (400) and an entry from another organization is 404', async () => {
    expect((await post(H.finDelete, { id: 'exp1' }, {}, 'DELETE')).status).toBe(400)
    expect((await post(H.finDelete, { id: 'exp-b' }, { reason: 'x' }, 'DELETE')).status).toBe(404)
  })
  it('deleting a still-pending expense does not touch the balance', async () => {
    expect((await post(H.finDelete, { id: 'exp1' }, { reason: 'duplicada' }, 'DELETE')).status).toBe(200)
    expect(tx('exp1').deleted_at).toBeTruthy()
    expect(balance()).toBe(1000)
  })
})

describe('C37 / C38: pay a commission (reports/commissions/:id/pay)', () => {
  const pay = (id: string, body: unknown = {}) => post(H.commPay, { id }, body)

  it('C37: creates a paid "Salários" expense, statement, reduces the balance and links the record to the transaction', async () => {
    const r = await pay('cm1', { paymentDate: '2026-03-20' })
    expect(r.status).toBe(200)
    const t = fake.tables.financial_transactions!.find(x => x.employee_financial_record_id === 'cm1')!
    expect(t).toMatchObject({ type: 'expense', status: 'paid', amount: 100, category: 'Salários', category_id: 'cat-sal', organization_id: 'org-a', due_date: '2026-03-20' })
    expect(rec('cm1')).toMatchObject({ status: 'paid', financial_transaction_id: t.id, payment_date: '2026-03-20' })
    expect(balance()).toBe(900)
    expect(statements()[0]).toMatchObject({ previous_balance: 1000, balance_after: 900, amount: 100, transaction_type: 'expense' })
    expectI10(1000)
  })
  it('C38: paying twice (double click) → 400 and the balance drops only once', async () => {
    await pay('cm1')
    expect((await pay('cm1')).status).toBe(400)
    expect(balance()).toBe(900)
    expect(fake.tables.financial_transactions!.filter(x => x.employee_financial_record_id === 'cm1')).toHaveLength(1)
  })
  it('commission already paid → 400, from another organization → 404', async () => {
    expect((await pay('cm-paid')).status).toBe(400)
    expect((await pay('cm-b')).status).toBe(404)
    expect(rec('cm-b')!.status).toBe('pending')
    expect(balance()).toBe(1000)
  })
  it('bank account from another organization is refused and nothing is stored', async () => {
    const r = await pay('cm1', { bankAccountId: 'acc-b' })
    expect(r.status).toBe(400)
    expect(balance('acc-b')).toBe(50)
    expect(rec('cm1')!.status).toBe('pending')
    expect(fake.tables.financial_transactions!.filter(x => x.employee_financial_record_id === 'cm1')).toHaveLength(0)
  })
  it('without an account, uses the first active account of the own organization', async () => {
    await pay('cm1')
    expect(balance('acc-a')).toBe(900)
    expect(balance('acc-b')).toBe(50)
  })
  it('no active account → 400 and the commission stays pending', async () => {
    fake.tables.bank_accounts = fake.tables.bank_accounts!.filter(a => a.organization_id !== 'org-a')
    expect((await pay('cm1')).status).toBe(400)
    expect(rec('cm1')!.status).toBe('pending')
  })
})

describe('C42: pay-commissions-bulk', () => {
  const bulk = (registroIds: unknown, extra: Record<string, unknown> = {}) => post(H.commBulk, {}, { registroIds, ...extra })

  it('mixed batch: pays only the valid pending one; paid and advance are ignored; other org and nonexistent fail', async () => {
    const r = await bulk(['cm1', 'cm-paid', 'adv1', 'cm-b', 'nao-existe'])
    expect((r.body as any).data).toMatchObject({ paidCount: 1, skippedCount: 2, failedCount: 2 })
    expect(balance()).toBe(900)
    expect(rec('cm1')!.status).toBe('paid')
    expect(rec('adv1')!.status).toBe('pending')
    expect(rec('cm-b')!.status).toBe('pending')
    expectI10(1000)
  })
  it('multiple records: one "Salários" expense and one statement per record; balance drops by the sum', async () => {
    await bulk(['cm1', 'cm2'])
    expect(balance()).toBe(860)
    const exp = fake.tables.financial_transactions!.filter(t => t.employee_financial_record_id)
    expect(exp).toHaveLength(2)
    expect(exp.every(t => t.category === 'Salários' && t.status === 'paid' && t.type === 'expense')).toBe(true)
    expect(statements()).toHaveLength(2)
    expectI10(1000)
  })
  it('repeating the batch does not pay again (idempotent)', async () => {
    await bulk(['cm1'])
    const again = await bulk(['cm1'])
    expect((again.body as any).data).toMatchObject({ paidCount: 0, skippedCount: 1 })
    expect(balance()).toBe(900)
  })
  it('account from another organization → 400 and nothing is paid', async () => {
    const r = await bulk(['cm1'], { contaBancariaId: 'acc-b' })
    expect(r.status).toBe(400)
    expect(balance('acc-b')).toBe(50)
    expect(rec('cm1')!.status).toBe('pending')
  })
  it('failure in the middle of the record rolls back balance, statement and transaction (rollback)', async () => {
    // o registro "some" entre a leitura e a escrita final: o update devolve 0 linhas
    const original = fake.client.from.bind(fake.client)
    ;(fake.client as any).from = (table: string) => {
      const b = original(table)
      if (table !== 'employee_financial_records') return b
      const upd = b.update.bind(b)
      b.update = (values: any) => {
        const q = upd(values)
        if (values?.status === 'paid') fake.tables.employee_financial_records = fake.tables.employee_financial_records!.filter(r => r.id !== 'cm1')
        return q
      }
      return b
    }
    const r = await bulk(['cm1'])
    expect((r.body as any).data).toMatchObject({ paidCount: 0, failedCount: 1 })
    expect(balance()).toBe(1000)
    expect(statements()).toHaveLength(0)
    const t = fake.tables.financial_transactions!.find(x => x.employee_financial_record_id === 'cm1')
    expect(t?.deleted_at).toBeTruthy()
  })
  it('empty list or more than 200 → 400', async () => {
    expect((await bulk([])).status).toBe(400)
    expect((await bulk(Array.from({ length: 201 }, (_, i) => `x${i}`))).status).toBe(400)
  })
})

describe('E18: cancel OS (cancel.post)', () => {
  const cancel = (id: string) => post(H.cancel, { id })

  it('OS without payment: cancels, resets the snapshot and reverts pending commissions', async () => {
    const r = await cancel('o1')
    expect(r.status).toBe(200)
    const o = fake.tables.service_orders!.find(x => x.id === 'o1')!
    expect(o).toMatchObject({ status: 'cancelled', commission_amount: 0 })
    expect(fake.tables.employee_financial_records!.filter(x => x.service_order_id === 'o1' && x.status === 'pending')).toHaveLength(0)
    expect((r.body as any).data.deleted.commissions).toBeGreaterThan(0)
  })
  it('with payment (partial or full) is refused (409): the user must undo the payment first', async () => {
    Object.assign(fake.tables.service_orders!.find(x => x.id === 'o1')!, { payment_status: 'partial' })
    expect((await cancel('o1')).status).toBe(409)
    expect(fake.tables.service_orders!.find(x => x.id === 'o1')!.status).toBe('completed')
  })
  it('with a registered installment, even "pending", is refused (409)', async () => {
    fake.tables.service_order_installments!.push({ id: 'i1', ...org('org-a'), service_order_id: 'o1', amount: 1000, status: 'pending', kind: 'installment' })
    expect((await cancel('o1')).status).toBe(409)
  })
  it('with a one-off receipt recorded in the description "OS #número" is refused (409)', async () => {
    fake.tables.financial_transactions!.push({ id: 'x', ...org('org-a'), type: 'income', status: 'paid', amount: 10, description: 'Recebimento OS #100' })
    expect((await cancel('o1')).status).toBe(409)
  })
  it('already cancelled is idempotent; OS from another organization → 404', async () => {
    await cancel('o1')
    const again = await cancel('o1')
    expect(again.status).toBe(200)
    expect((again.body as any).data.deleted).toEqual({ statements: 0, transactions: 0, commissions: 0 })
    expect((await cancel('o-b')).status).toBe(404)
  })
  // KF-40: viola a invariante I3. Possível com liberação integral (commission_release_mode='full'): a comissão
  // é paga antes de a OS receber qualquer valor, e o cancelamento apaga o registro pago e estorna o dinheiro.
  it.fails('KF-40: commission already paid is not deleted or reversed when the OS is cancelled', async () => {
    fake.tables.financial_transactions!.push({ id: 'ftc', ...org('org-a'), type: 'expense', status: 'paid', amount: 60, employee_financial_record_id: 'cm-paid', bank_account_id: 'acc-a' })
    fake.tables.bank_account_statements!.push({ id: 'sc', organization_id: 'org-a', bank_account_id: 'acc-a', financial_transaction_id: 'ftc', amount: 60, transaction_type: 'expense', previous_balance: 1060, balance_after: 1000 })
    Object.assign(rec('cm-paid')!, { financial_transaction_id: 'ftc' })
    await cancel('o1')
    expect(rec('cm-paid')).toBeTruthy()
    expect(balance()).toBe(1000)
  })
})

describe('E19 / C43: manual generate-commissions', () => {
  const generate = (body: unknown = {}) => post(H.generate, { id: 'o1' }, body)
  const pendingTotal = () => Number(fake.tables.employee_financial_records!.filter(r => r.service_order_id === 'o1' && r.record_type === 'commission' && r.status === 'pending' && ['cm1', 'cm2', 'cm-paid'].indexOf(String(r.id)) < 0).reduce((s, r) => s + Number(r.amount), 0).toFixed(2))

  beforeEach(() => {
    // zera as comissões do cenário base para isolar a geração
    fake.tables.employee_financial_records = fake.tables.employee_financial_records!.filter(r => r.service_order_id !== 'o1')
  })

  it('E19: calling twice does not duplicate records or amounts', async () => {
    fake.tables.service_order_installments!.push({ id: 'i1', ...org('org-a'), service_order_id: 'o1', kind: 'installment', installment_number: 1, amount: 1000, status: 'paid' })
    await generate()
    const first = fake.tables.employee_financial_records!.filter(r => r.service_order_id === 'o1' && r.record_type === 'commission')
    await generate()
    const second = fake.tables.employee_financial_records!.filter(r => r.service_order_id === 'o1' && r.record_type === 'commission')
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(Number(second[0]!.amount)).toBe(100)
  })
  it('nothing received does not release commission', async () => {
    await generate()
    expect(fake.tables.employee_financial_records!.filter(r => r.service_order_id === 'o1' && r.record_type === 'commission' && Number(r.amount) > 0)).toHaveLength(0)
  })
  it('C43: with 40% received, the manual result equals the automatic flow (R$ 40 of R$ 100)', async () => {
    // fluxo automático
    await post(H.process, { id: 'o1' }, { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 400, status: 'paid' }, { amount: 600 }] })
    expect(pendingTotal()).toBe(40)
    const automatic = fake.tables.employee_financial_records!.filter(r => r.service_order_id === 'o1' && r.record_type === 'commission').map(r => ({ e: r.employee_id, a: Number(r.amount) }))
    await generate()
    const manual = fake.tables.employee_financial_records!.filter(r => r.service_order_id === 'o1' && r.record_type === 'commission').map(r => ({ e: r.employee_id, a: Number(r.amount) }))
    expect(manual).toEqual(automatic)
  })
  it('OS from another organization → error and no commission created', async () => {
    const r = await post(H.generate, { id: 'o-b' }, {})
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(fake.tables.employee_financial_records!.filter(x => x.service_order_id === 'o-b')).toHaveLength(0)
  })
})

describe('E16: PATCH installments/:id (reschedule / adjust amount)', () => {
  const patch = (installmentId: string, body: unknown, orderId = 'o1') =>
    post('server/api/service-orders/[id]/installments/[installmentId].patch.ts', { id: orderId, installmentId }, body, 'PATCH')
  const inst = (id: string) => fake.tables.service_order_installments!.find(i => i.id === id)!

  beforeEach(() => {
    fake.tables.service_order_installments!.push(
      { id: 'ip', ...org('org-a'), service_order_id: 'o1', kind: 'installment', installment_number: 1, amount: 400, status: 'pending', due_date: '2026-04-10' },
      { id: 'ipart', ...org('org-a'), service_order_id: 'o1', kind: 'installment', installment_number: 2, amount: 300, status: 'partial', due_date: '2026-04-20' },
      { id: 'ipaid', ...org('org-a'), service_order_id: 'o1', kind: 'installment', installment_number: 3, amount: 300, status: 'paid', due_date: '2026-04-30' }
    )
  })

  it('pending installment: changes date and amount without touching balance, statement or OS status', async () => {
    const r = await patch('ip', { due_date: '2026-05-05', amount: 450 })
    expect(r.status).toBe(200)
    expect(inst('ip')).toMatchObject({ due_date: '2026-05-05', amount: 450 })
    expect(balance()).toBe(1000)
    expect(statements()).toHaveLength(0)
    expect(fake.tables.service_orders!.find(o => o.id === 'o1')!.payment_status).toBe('pending')
  })
  it('partial or paid installment is locked (409): fix it by cancelling the receipt', async () => {
    expect((await patch('ipart', { amount: 100 })).status).toBe(409)
    expect((await patch('ipaid', { due_date: '2026-06-01' })).status).toBe(409)
    expect(inst('ipart').amount).toBe(300)
    expect(inst('ipaid').due_date).toBe('2026-04-30')
  })
  it.each([0, -5, 'abc'])('valor inválido (%s) → 400 e nada muda', async (amount) => {
    expect((await patch('ip', { amount })).status).toBe(400)
    expect(inst('ip').amount).toBe(400)
  })
  it('body without date or amount → 400', async () => {
    expect((await patch('ip', {})).status).toBe(400)
  })
  it('installment from another OS or another organization → 404', async () => {
    expect((await patch('ip', { amount: 10 }, 'o-b')).status).toBe(404)
    fake.tables.service_order_installments!.push({ id: 'ib', ...org('org-b'), service_order_id: 'o-b', amount: 50, status: 'pending' })
    expect((await patch('ib', { amount: 10 }, 'o-b')).status).toBe(404)
    expect(inst('ib').amount).toBe(50)
  })
})

describe('P41: commission_release_mode="full" is a one-way street (by design)', () => {
  // Decisão de produto registrada no código ("One-way switch"). O teste documenta a consequência:
  // depois de desfazer o pagamento, a próxima entrada de dinheiro ainda libera 100% da comissão.
  const plan = (releaseCommissionsInFull?: boolean) => post(H.process, { id: 'o1' }, {
    paymentMethod: 'pix', bankAccountId: 'acc-a', releaseCommissionsInFull,
    installments: [{ amount: 100, status: 'paid' }, { amount: 900 }]
  })
  const commissions = () => Number(fake.tables.employee_financial_records!.filter(r => r.service_order_id === 'o1' && r.record_type === 'commission' && r.status === 'pending' && !['cm1', 'cm2', 'cm-paid'].includes(String(r.id))).reduce((s, r) => s + Number(r.amount), 0).toFixed(2))

  beforeEach(() => {
    fake.tables.employee_financial_records = fake.tables.employee_financial_records!.filter(r => r.service_order_id !== 'o1')
  })

  it('with the option on, 10% received releases 100% of the commission and the order stays in "full" mode', async () => {
    await plan(true)
    expect(commissions()).toBe(100)
    expect(fake.tables.service_orders!.find(o => o.id === 'o1')!.commission_release_mode).toBe('full')
  })
  it('after undoing the payment the mode stays "full" and the next receipt releases everything again', async () => {
    await plan(true)
    const undo = await post('server/api/service-orders/[id]/payment.delete.ts', { id: 'o1' }, {}, 'DELETE')
    expect(undo.status).toBe(200)
    expect(commissions()).toBe(0)
    expect(fake.tables.service_orders!.find(o => o.id === 'o1')!.commission_release_mode).toBe('full')
    await plan()
    expect(commissions()).toBe(100)
  })
})

describe('Audit (Layer 2): before/after on commission routes and cancellation', () => {
  /** Chama o handler com um contexto de auditoria e devolve o que o plugin anexaria à linha. */
  async function audited(file: string, params: Record<string, string>, body: unknown = {}, method = 'POST') {
    const event = fakeEvent({ method, cookies, params, body }) as ReturnType<typeof fakeEvent> & { context: { audit: Record<string, any> } }
    event.context = { audit: { requestId: 'req-1', startedAt: 0 } }
    const res = await callHandler(file, event)
    return { res, audit: event.context.audit }
  }

  it('paying commission: stores status before/after, transaction, account and balance', async () => {
    const { res, audit } = await audited(H.commPay, { id: 'cm1' }, { paymentDate: '2026-03-20' })
    expect(res.status).toBe(200)
    expect(audit.resourceType).toBe('employee_financial_record')
    expect(audit.resourceId).toBe('cm1')
    expect(audit.changes.changed_fields).toContain('status')
    expect(audit.changes.diff.status).toEqual({ from: 'pending', to: 'paid' })
    expect(audit.changes.extra).toMatchObject({ bank_account_id: 'acc-a', balance: { from: 1000, to: 900 } })
  })
  it('paying a commission that fails (already paid) leaves no before/after', async () => {
    const { res, audit } = await audited(H.commPay, { id: 'cm-paid' })
    expect(res.status).toBe(400)
    expect(audit.changes).toBeUndefined()
  })
  it('deleting commission: stores the deleted record (amount, employee, OS)', async () => {
    const { res, audit } = await audited('server/api/reports/commissions/[id].delete.ts', { id: 'cm1' }, {}, 'DELETE')
    expect(res.status).toBe(200)
    expect(audit.resourceId).toBe('cm1')
    expect(audit.changes.before).toMatchObject({ id: 'cm1', amount: 100, employee_id: 'e1', service_order_id: 'o1' })
  })
  it('generate-commissions: stores the commission per employee before and after the recalculation', async () => {
    fake.tables.employee_financial_records = fake.tables.employee_financial_records!.filter(r => r.service_order_id !== 'o1')
    fake.tables.employee_financial_records!.push({ id: 'old', ...org('org-a'), employee_id: 'e1', record_type: 'commission', amount: 5, status: 'pending', service_order_id: 'o1' })
    fake.tables.service_order_installments!.push({ id: 'i1', ...org('org-a'), service_order_id: 'o1', kind: 'installment', installment_number: 1, amount: 1000, status: 'paid' })
    const { res, audit } = await audited(H.generate, { id: 'o1' }, {})
    expect(res.status).toBe(200)
    expect(audit.resourceType).toBe('service_order')
    expect(audit.resourceId).toBe('o1')
    expect(audit.changes.diff.e1.from).toEqual([{ amount: 5, status: 'pending' }])
    // o recálculo complementa (R$ 5 já existentes + R$ 95), e o total do funcionário fecha o direito de R$ 100
    expect(audit.changes.diff.e1.to).toEqual([{ amount: 5, status: 'pending' }, { amount: 95, status: 'pending' }])
  })
  it('cancelling OS: stores status before/after and what was reverted', async () => {
    const { res, audit } = await audited(H.cancel, { id: 'o1' })
    expect(res.status).toBe(200)
    expect(audit.changes.diff.status).toEqual({ from: 'completed', to: 'cancelled' })
    expect(audit.changes.extra.deleted.commissions).toBeGreaterThan(0)
  })
})

describe('KF-44: delete already paid commission (reports/commissions/:id DELETE)', () => {
  // A rota apaga o registro sem olhar o status: a despesa "Salários" e o saldo continuam, e a comissão some do relatório.
  it.fails('KF-44: already paid commission cannot be deleted (I3)', async () => {
    const res = await post('server/api/reports/commissions/[id].delete.ts', { id: 'cm-paid' }, {}, 'DELETE')
    expect(res.status).toBe(409)
    expect(rec('cm-paid')).toBeTruthy()
  })
  it('pending commission can be deleted; from another organization → 404', async () => {
    expect((await post('server/api/reports/commissions/[id].delete.ts', { id: 'cm1' }, {}, 'DELETE')).status).toBe(200)
    expect(rec('cm1')).toBeUndefined()
    expect((await post('server/api/reports/commissions/[id].delete.ts', { id: 'cm-b' }, {}, 'DELETE')).status).toBe(404)
    expect(rec('cm-b')).toBeTruthy()
  })
})
