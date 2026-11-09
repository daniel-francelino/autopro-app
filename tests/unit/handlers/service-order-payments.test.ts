// OS → pagamentos → comissão, ponta a ponta nos handlers reais (banco em memória).
// Aqui a liberação de comissão NÃO é mockada: só a busca das regras (employee-commission-plans).
// Cenários P-xx documentados em docs/testing/financial-core-test-analysis.md.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../helpers/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fake-supabase'

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
  process: 'server/api/service-orders/[id]/process-payment.post.ts',
  down: 'server/api/service-orders/[id]/down-payment.post.ts',
  extra: 'server/api/service-orders/[id]/receive-extra-payment.post.ts',
  pay: 'server/api/service-orders/[id]/installments/[installmentId]/pay.post.ts',
  undo: 'server/api/service-orders/[id]/payment.delete.ts',
  cancel: 'server/api/service-orders/[id]/cancel.post.ts'
}

function seed(orderOverrides: Record<string, unknown> = {}) {
  fake = createFakeSupabase({
    user_profiles: [
      { id: 'p1', user_id: 'u1', organization_id: 'org-a', role_id: 'r', is_owner: false, is_active: true, employee_id: null },
      { id: 'p2', user_id: 'u2', organization_id: 'org-b', role_id: 'r', is_owner: false, is_active: true, employee_id: null }
    ],
    service_orders: [
      {
        id: 'o1', organization_id: 'org-a', number: '100', status: 'completed', entry_date: '2026-03-10', total_amount: 1000,
        discount: 0, total_taxes_amount: 0, payment_status: 'pending', deleted_at: null, commission_release_mode: null,
        commission_manual_adjustments_log: [], responsible_employees: [{ employee_id: 'e1' }],
        items: [{ id: 'it1', total_price: 1000, cost_price: 0, quantity: 1 }], ...orderOverrides
      },
      { id: 'o-open', organization_id: 'org-a', number: '101', status: 'in_progress', entry_date: '2026-03-10', total_amount: 500, payment_status: 'pending', deleted_at: null },
      { id: 'o-b', organization_id: 'org-b', number: '900', status: 'completed', total_amount: 500, payment_status: 'pending', deleted_at: null }
    ],
    employees: [{ id: 'e1', organization_id: 'org-a', name: 'Ana', deleted_at: null }],
    service_order_installments: [],
    bank_accounts: [
      { id: 'acc-a', organization_id: 'org-a', current_balance: 1000 },
      { id: 'acc-b', organization_id: 'org-b', current_balance: 50 }
    ],
    bank_account_statements: [],
    financial_transactions: [],
    financial_categories: [],
    employee_financial_records: []
  })
}

const call = (file: string, params: Record<string, string>, body?: unknown, method = 'POST') =>
  callHandler(file, fakeEvent({ method, cookies, params, body }))
const processPayment = (id: string, body: unknown) => call(H.process, { id }, body)
const down = (id: string, body: unknown) => call(H.down, { id }, body)
const extra = (id: string, body: unknown) => call(H.extra, { id }, body)
const payInst = (id: string, installmentId: string, body?: unknown) => call(H.pay, { id, installmentId }, body ?? {})

beforeEach(() => {
  seed()
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@a.com' } }, error: null })
  auth.refreshSession.mockReset()
})

const order = (id = 'o1') => fake.tables.service_orders!.find(o => o.id === id)!
const balance = (id = 'acc-a') => fake.tables.bank_accounts!.find(a => a.id === id)!.current_balance as number
const incomes = () => fake.tables.financial_transactions!.filter(t => t.type === 'income' && !t.deleted_at)
const paidIncome = () => Number(incomes().filter(t => t.status === 'paid').reduce((s, t) => s + Number(t.amount), 0).toFixed(2))
const commission = () => Number(fake.tables.employee_financial_records!.filter(r => r.record_type === 'commission').reduce((s, r) => s + Number(r.amount), 0).toFixed(2))
const inst = () => fake.tables.service_order_installments!.filter(i => !i.deleted_at)

/** Invariante central: o que a OS diz que recebeu == transações pagas == variação do saldo == extrato. */
function expectMoneyConsistent(startingBalance = 1000) {
  const stmtSum = Number(fake.tables.bank_account_statements!.reduce((s, x) => s + Number(x.amount), 0).toFixed(2))
  expect(Number((balance() - startingBalance).toFixed(2))).toBe(stmtSum)
  expect(stmtSum).toBe(paidIncome())
}

describe('P1–P8: sinal (down-payment)', () => {
  const body = { amount: 200, bankAccountId: 'acc-a', paymentMethod: 'pix' }

  it('P1: sinal em OS aberta movimenta saldo/extrato e NÃO altera o payment_status', async () => {
    const r = await down('o-open', body)
    expect(r.status).toBe(200)
    expect(balance()).toBe(1200)
    expect(order('o-open').payment_status).toBe('pending')
    expect(inst()[0]).toMatchObject({ kind: 'down_payment', status: 'paid', amount: 200 })
    expectMoneyConsistent()
  })
  it('P2: sinal em OS concluída é recusado (409)', async () => {
    expect((await down('o1', body)).status).toBe(409)
    expect(balance()).toBe(1000)
  })
  it.each([0, -10, 'abc', null, undefined])('P3: valor inválido (%s) → 400 e nada muda', async (amount) => {
    expect((await down('o-open', { ...body, amount })).status).toBe(400)
    expect(inst()).toHaveLength(0)
    expect(balance()).toBe(1000)
  })
  it('P4: sem conta bancária → 400', async () => {
    expect((await down('o-open', { amount: 100 })).status).toBe(400)
  })
  it('P5: conta de outra organização é recusada e não deixa lançamento órfão ativo', async () => {
    const r = await down('o-open', { ...body, bankAccountId: 'acc-b' })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(balance('acc-b')).toBe(50)
    expect(incomes().filter(t => t.status === 'paid')).toHaveLength(0)
  })
  it('P6: OS de outra organização → 404', async () => {
    expect((await down('o-b', body)).status).toBe(404)
  })
  it('P7: dois sinais seguidos numeram as parcelas 1 e 2', async () => {
    await down('o-open', body)
    await down('o-open', { ...body, amount: 50 })
    expect(inst().map(i => i.installment_number)).toEqual([1, 2])
    expect(balance()).toBe(1250)
  })
  it('P8: sinal + conclusão: o plano cobre só o restante e a soma recebida fecha no total da OS', async () => {
    await down('o-open', body) // sinal de 200 em OS aberta (total 500)
    order('o-open').status = 'completed' // conclusão da OS
    const r = await processPayment('o-open', { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 100, status: 'paid' }, { amount: 200 }] })
    expect(r.status).toBe(200)
    expect(paidIncome()).toBe(300) // sinal 200 + 1ª parcela 100; faltam 200
    expect(order('o-open').payment_status).toBe('partial')
    expectMoneyConsistent()
  })
})

describe('P9–P16: process-payment (plano de pagamento)', () => {
  const plan = (installments: unknown[]) => ({ paymentMethod: 'pix', bankAccountId: 'acc-a', installments })

  it('P9: à vista quita, comissão cheia liberada', async () => {
    await processPayment('o1', plan([{ amount: 1000, status: 'paid' }]))
    expect(order().payment_status).toBe('paid')
    expect(commission()).toBe(100)
    expectMoneyConsistent()
  })
  it('P10: parcelado com 1ª paga → comissão proporcional (10%)', async () => {
    await processPayment('o1', plan([{ amount: 250, status: 'paid' }, { amount: 750 }]))
    expect(order().payment_status).toBe('partial')
    expect(commission()).toBe(25)
  })
  it('P11: tudo pendente → nenhuma comissão e saldo intacto', async () => {
    await processPayment('o1', plan([{ amount: 500 }, { amount: 500 }]))
    expect(commission()).toBe(0)
    expect(balance()).toBe(1000)
    expect(order().payment_status).toBe('pending')
  })
  it('P12: "liberar comissão integral" libera tudo mesmo sem receber', async () => {
    await processPayment('o1', { ...plan([{ amount: 1000 }]), releaseCommissionsInFull: true })
    expect(commission()).toBe(100)
    expect(order().commission_release_mode).toBe('full')
  })
  it('P13: soma das linhas com diferença de 1 centavo é aceita (tolerância); 2 centavos não', async () => {
    expect((await processPayment('o1', plan([{ amount: 999.99, status: 'paid' }]))).status).toBe(200)
    seed()
    expect((await processPayment('o1', plan([{ amount: 999.98, status: 'paid' }]))).status).toBe(400)
  })
  it('P14: parcelas com centavos (333,33 + 333,33 + 333,34) fecham no total', async () => {
    const r = await processPayment('o1', plan([{ amount: 333.33, status: 'paid' }, { amount: 333.33, status: 'paid' }, { amount: 333.34, status: 'paid' }]))
    expect(r.status).toBe(200)
    expect(order().payment_status).toBe('paid')
    expect(paidIncome()).toBe(1000)
    expect(commission()).toBe(100)
    expectMoneyConsistent()
  })
  it('P15: linha com kind inválido vira "installment"', async () => {
    await processPayment('o1', plan([{ amount: 1000, kind: 'hack' }]))
    expect(inst()[0]!.kind).toBe('installment')
  })
  it('P16: OS cancelada/orçamento não recebe pagamento', async () => {
    order().status = 'cancelled'
    expect((await processPayment('o1', plan([{ amount: 1000, status: 'paid' }]))).status).toBe(409)
    expect(balance()).toBe(1000)
  })
})

describe('P17–P28: pagamento de parcela (inclui parcial)', () => {
  async function withPlan(lines: unknown[] = [{ amount: 400 }, { amount: 600 }]) {
    await processPayment('o1', { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: lines })
    return inst()
  }

  it('P17: pagar a parcela inteira → paga, saldo sobe, OS vira partial e a comissão acompanha', async () => {
    const [p1] = await withPlan()
    expect((await payInst('o1', String(p1!.id))).status).toBe(200)
    expect(inst()[0]!.status).toBe('paid')
    expect(order().payment_status).toBe('partial')
    expect(balance()).toBe(1400)
    expect(commission()).toBe(40)
    expectMoneyConsistent()
  })
  it('P18: pagar todas as parcelas → OS paga, comissão cheia', async () => {
    const [p1, p2] = await withPlan()
    await payInst('o1', String(p1!.id))
    await payInst('o1', String(p2!.id))
    expect(order().payment_status).toBe('paid')
    expect(commission()).toBe(100)
    expectMoneyConsistent()
  })
  it('P19: pagar parcela já paga → 409 e saldo não muda', async () => {
    const [p1] = await withPlan()
    await payInst('o1', String(p1!.id))
    expect((await payInst('o1', String(p1!.id))).status).toBe(409)
    expect(balance()).toBe(1400)
  })
  it('P20: parcela de OUTRA OS (id da parcela não pertence à OS da URL) → 404', async () => {
    const [p1] = await withPlan()
    expect((await payInst('o-open', String(p1!.id))).status).toBe(404)
    expect(balance()).toBe(1000)
  })
  it('P21: parcela de outra organização → 404', async () => {
    fake.tables.service_order_installments!.push({ id: 'ib', organization_id: 'org-b', service_order_id: 'o-b', amount: 100, status: 'pending', deleted_at: null })
    expect((await payInst('o-b', 'ib')).status).toBe(404)
  })

  describe('parcela sem lançamento prévio (recebimento em partes)', () => {
    // process-payment nunca cria lançamento para parcela pendente; o pagamento parcial vale para elas.
    it('P22: 3 recebimentos parciais (100 + 150 + 150) quitam uma parcela de 400', async () => {
      const [p1] = await withPlan()
      const id = String(p1!.id)
      await payInst('o1', id, { amount: 100 })
      expect(inst()[0]!.status).toBe('partial')
      expect(order().payment_status).toBe('partial')
      await payInst('o1', id, { amount: 150 })
      expect(inst()[0]!.status).toBe('partial')
      await payInst('o1', id, { amount: 150 })
      expect(inst()[0]!.status).toBe('paid')
      expect(balance()).toBe(1400)
      expectMoneyConsistent()
    })
    it('P23: valor maior que o saldo restante da parcela → 400 e nada muda', async () => {
      const [p1] = await withPlan()
      await payInst('o1', String(p1!.id), { amount: 300 })
      const r = await payInst('o1', String(p1!.id), { amount: 150 })
      expect(r.status).toBe(400)
      expect(balance()).toBe(1300)
    })
    it.each([0, -5, 'abc'])('P24: valor inválido (%s) → 400', async (amount) => {
      const [p1] = await withPlan()
      expect((await payInst('o1', String(p1!.id), { amount })).status).toBe(400)
      expect(balance()).toBe(1000)
    })
    it('P25: parcela totalmente recebida em partes não aceita novo recebimento (409)', async () => {
      const [p1] = await withPlan()
      await payInst('o1', String(p1!.id), { amount: 200 })
      await payInst('o1', String(p1!.id), { amount: 200 })
      expect((await payInst('o1', String(p1!.id), { amount: 1 })).status).toBe(409)
    })
    it.fails('KF-24 · P26: recebimento parcial gera comissão proporcional ao valor efetivamente recebido', async () => {
      const [p1] = await withPlan([{ amount: 1000 }])
      await payInst('o1', String(p1!.id), { amount: 500 })
      expect(commission()).toBe(50)
    })
  })

  it('P27: parcela com lançamento prévio recusa pagamento parcial (400)', async () => {
    seed()
    fake.tables.service_order_installments!.push({ id: 'ix', organization_id: 'org-a', service_order_id: 'o1', amount: 400, status: 'pending', financial_transaction_id: 'tx1', bank_account_id: 'acc-a', deleted_at: null })
    fake.tables.financial_transactions!.push({ id: 'tx1', organization_id: 'org-a', type: 'income', status: 'pending', amount: 400, description: 'x', deleted_at: null })
    expect((await payInst('o1', 'ix', { amount: 100 })).status).toBe(400)
    expect(balance()).toBe(1000)
  })
  it('P28: parcela com lançamento prévio paga integralmente e movimenta o saldo', async () => {
    seed()
    fake.tables.service_order_installments!.push({ id: 'ix', organization_id: 'org-a', service_order_id: 'o1', amount: 400, status: 'pending', financial_transaction_id: 'tx1', bank_account_id: 'acc-a', deleted_at: null })
    fake.tables.financial_transactions!.push({ id: 'tx1', organization_id: 'org-a', type: 'income', status: 'pending', amount: 400, description: 'x', deleted_at: null })
    expect((await payInst('o1', 'ix')).status).toBe(200)
    expect(balance()).toBe(1400)
    expect(fake.tables.bank_account_statements).toHaveLength(1)
  })
})

describe('P29–P34: recebimento avulso (extra)', () => {
  const body = { amount: 100, bankAccountId: 'acc-a', paymentMethod: 'cash' }

  it('P29: cria parcela kind=extra paga, movimenta saldo e recalcula o status', async () => {
    const r = await extra('o1', body)
    expect(r.status).toBe(200)
    expect(inst()[0]).toMatchObject({ kind: 'extra', status: 'paid', amount: 100 })
    expect(balance()).toBe(1100)
    expect(commission()).toBe(10)
  })
  it('P30: só OS concluída (409); valor inválido e sem conta (400)', async () => {
    expect((await extra('o-open', body)).status).toBe(409)
    expect((await extra('o1', { ...body, amount: 0 })).status).toBe(400)
    expect((await extra('o1', { amount: 10 })).status).toBe(400)
  })
  it('P31: OS de outra organização → 404', async () => {
    expect((await extra('o-b', body)).status).toBe(404)
  })
  // KF-27: o avulso não é limitado ao saldo da OS: dá para "receber" mais do que a OS vale.
  it.fails('KF-27: recebimento avulso acima do saldo em aberto é recusado', async () => {
    const r = await extra('o1', { ...body, amount: 5000 })
    expect(r.status).toBe(400)
  })
  // KF-28: avulso antes do plano bloqueia process-payment ("já tem plano"), embora nenhum plano exista.
  it.fails('KF-28: avulso antes do plano não impede de gerar o plano do restante', async () => {
    await extra('o1', body)
    const r = await processPayment('o1', { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 900, status: 'paid' }] })
    expect(r.status).toBe(200)
  })
})

describe('P35–P44: desfazer pagamento / cancelar', () => {
  it('P35: desfazer devolve saldo ao valor inicial, apaga parcelas/comissão e a OS volta a pending', async () => {
    await processPayment('o1', { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 400, status: 'paid' }, { amount: 600, status: 'paid' }] })
    const r = await call(H.undo, { id: 'o1' }, undefined, 'DELETE')
    expect(r.status).toBe(200)
    expect(balance()).toBe(1000)
    expect(inst()).toHaveLength(0)
    expect(commission()).toBe(0)
    expect(order().payment_status).toBe('pending')
    expect(incomes()).toHaveLength(0)
  })
  it('P36: desfazer com comissão já paga é bloqueado e nada é revertido', async () => {
    await processPayment('o1', { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 1000, status: 'paid' }] })
    fake.tables.employee_financial_records![0]!.status = 'paid'
    const r = await call(H.undo, { id: 'o1' }, undefined, 'DELETE')
    expect(r.status).toBe(409)
    expect(balance()).toBe(2000)
    expect(incomes()).toHaveLength(1)
  })
  it('P37: desfazer recebimentos parciais (3 partes) devolve o saldo exato', async () => {
    await processPayment('o1', { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 1000 }] })
    const id = String(inst()[0]!.id)
    await payInst('o1', id, { amount: 100 })
    await payInst('o1', id, { amount: 200 })
    await payInst('o1', id, { amount: 300 })
    await call(H.undo, { id: 'o1' }, undefined, 'DELETE')
    expect(balance()).toBe(1000)
    expect(incomes()).toHaveLength(0)
  })
  it('P38: desfazer pagamento de OS de outra organização → 404 e nada muda', async () => {
    expect((await call(H.undo, { id: 'o-b' }, undefined, 'DELETE')).status).toBe(404)
  })
  it('P39: desfazer pagamento e pagar de novo reproduz o mesmo resultado (idempotência do ciclo)', async () => {
    const body = { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 1000, status: 'paid' }] }
    await processPayment('o1', body)
    await call(H.undo, { id: 'o1' }, undefined, 'DELETE')
    const r = await processPayment('o1', body)
    expect(r.status).toBe(200)
    expect(balance()).toBe(2000)
    expect(commission()).toBe(100)
    expect(order().payment_status).toBe('paid')
  })
  it('P40: saldo nunca vira NaN/undefined em nenhum fluxo', async () => {
    await processPayment('o1', { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 333.33, status: 'paid' }, { amount: 666.67, status: 'paid' }] })
    expect(Number.isFinite(balance())).toBe(true)
  })
})

describe('Pontas soltas conhecidas (KF-27 a KF-30) — o teste descreve o comportamento correto', () => {
  // KF-24 (parcial recebida não libera comissão) está em commissions-release.test.ts e aqui em P26 (via it.fails abaixo).
  it.fails('KF-24 (E2E): recebimento parcial de 500/1000 libera 50 de comissão', async () => {
    await processPayment('o1', { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 1000 }] })
    await payInst('o1', String(inst()[0]!.id), { amount: 500 })
    expect(commission()).toBe(50)
  })
  // KF-31: payment_status olha só as LINHAS de parcela, não os valores: um avulso de 100 numa OS de 1000 a deixa "paga".
  it.fails('KF-31: recebimento avulso menor que o total deixa a OS como parcial (não paga)', async () => {
    await extra('o1', { amount: 100, bankAccountId: 'acc-a' })
    expect(order().payment_status).toBe('partial')
  })
  // KF-29: o plano aceita linhas negativas/zeradas desde que a soma feche (ex.: 1300 + (-300)).
  it.fails('KF-29: linha de pagamento com valor negativo ou zero é recusada', async () => {
    const r = await processPayment('o1', { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 1300, status: 'paid' }, { amount: -300 }] })
    expect(r.status).toBe(400)
  })
  // KF-30: saldo = saldo + valor sem arredondar → deriva em ponto flutuante (0,1 + 0,2 ≠ 0,3).
  it.fails('KF-30: dez recebimentos de R$ 0,10 somam exatamente R$ 1,00 no saldo', async () => {
    fake.tables.bank_accounts![0]!.current_balance = 0
    fake.tables.service_orders![0]!.total_amount = 1
    fake.tables.service_orders![0]!.items = [{ id: 'it1', total_price: 1, quantity: 1 }]
    await processPayment('o1', { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: Array.from({ length: 10 }, () => ({ amount: 0.1, status: 'paid' })) })
    expect(balance()).toBe(1)
  })
})
