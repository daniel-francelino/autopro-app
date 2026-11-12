// DELETE /api/bonuses/:id/financial-records/:recordId (estorno de bônus pago) e isolamento do GET financial-records.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 3 (BON-02a/b/c/d/e, BON-06k, BON-06h).
// Padrão de referência: tests/fast/bank-accounts/handlers.test.ts.
//  - Caminho real do estorno: revertStatementOnAccount (server/utils/bank-balance.ts), sem mock.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { baseSeed, USERS, MONTH, type Persona } from '../../support/bonuses-fixture'
import { FINANCIAL_TRANSACTION_DELETION_SOURCES } from '../../../server/utils/financial-transaction-deletion'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const REMOVE = 'server/api/bonuses/[id]/financial-records/[recordId].delete.ts'
const LIST = 'server/api/bonuses/[id]/financial-records.get.ts'
const GENERATE = 'server/api/bonuses/[id]/generate.post.ts'

/** Saldo da conta A antes do pagamento do bônus (1000,00) e valor pago (350,10): cobre arredondamento de centavos. */
const BALANCE_BEFORE_PAYMENT = 1000
const PAID_AMOUNT = 350.1
const BALANCE_AFTER_PAYMENT = 649.9

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

function seed() {
  const s = baseSeed()
  s.bank_accounts = [
    { id: 'acc-a', organization_id: 'org-a', account_name: 'Caixa A', initial_balance: 0, current_balance: BALANCE_AFTER_PAYMENT, deleted_at: null },
    { id: 'acc-b', organization_id: 'org-b', account_name: 'Caixa B', initial_balance: 0, current_balance: 300, deleted_at: null }
  ]
  s.financial_transactions = [
    { id: 'ft-1', organization_id: 'org-a', deleted_at: null },
    { id: 'ft-b', organization_id: 'org-b', deleted_at: null }
  ]
  s.bank_account_statements = [
    { id: 's-open', organization_id: 'org-a', bank_account_id: 'acc-a', financial_transaction_id: null, transaction_type: 'income', amount: 1000, previous_balance: 0, balance_after: 1000 },
    { id: 's-pay', organization_id: 'org-a', bank_account_id: 'acc-a', financial_transaction_id: 'ft-1', transaction_type: 'expense', amount: PAID_AMOUNT, previous_balance: BALANCE_BEFORE_PAYMENT, balance_after: BALANCE_AFTER_PAYMENT },
    { id: 'sb-open', organization_id: 'org-b', bank_account_id: 'acc-b', financial_transaction_id: null, transaction_type: 'income', amount: 500, previous_balance: 0, balance_after: 500 },
    { id: 'sb-pay', organization_id: 'org-b', bank_account_id: 'acc-b', financial_transaction_id: 'ft-b', transaction_type: 'expense', amount: 200, previous_balance: 500, balance_after: 300 }
  ]
  s.employee_financial_records = [
    { id: 'efr-paid', organization_id: 'org-a', bonus_id: 'bon-a', employee_id: 'e1', record_type: 'bonus', status: 'paid', amount: PAID_AMOUNT, reference_date: '2026-09-10', payment_date: '2026-09-11', financial_transaction_id: 'ft-1', deleted_at: null },
    { id: 'efr-pend', organization_id: 'org-a', bonus_id: 'bon-a', employee_id: 'e1', record_type: 'bonus', status: 'pending', amount: 500.25, reference_date: '2026-10-15', payment_date: null, financial_transaction_id: null, deleted_at: null },
    { id: 'efr-gone', organization_id: 'org-a', bonus_id: 'bon-a', employee_id: 'e2', record_type: 'bonus', status: 'pending', amount: 10, reference_date: '2026-10-15', payment_date: null, financial_transaction_id: null, deleted_at: '2026-10-20T00:00:00.000Z', deletion_reason: 'antigo' },
    { id: 'efr-other', organization_id: 'org-a', bonus_id: 'bon-a2', employee_id: 'e2', record_type: 'bonus', status: 'pending', amount: 20, reference_date: '2026-10-15', payment_date: null, financial_transaction_id: null, deleted_at: null },
    { id: 'efr-b-paid', organization_id: 'org-b', bonus_id: 'bon-b', employee_id: 'e-b1', record_type: 'bonus', status: 'paid', amount: 200, reference_date: '2026-10-10', payment_date: '2026-10-11', financial_transaction_id: 'ft-b', deleted_at: null }
  ]
  s.bonus_generations = [
    { id: 'gen-paid', bonus_id: 'bon-a', employee_id: 'e1', reference_month: '2026-09-01', goal_met: true, financial_record_id: 'efr-paid' },
    { id: 'gen-pend', bonus_id: 'bon-a', employee_id: 'e1', reference_month: MONTH, goal_met: true, financial_record_id: 'efr-pend' },
    { id: 'gen-b-paid', bonus_id: 'bon-b', employee_id: 'e-b1', reference_month: MONTH, goal_met: true, financial_record_id: 'efr-b-paid' }
  ]
  fake = createFakeSupabase(s)
}

beforeEach(() => {
  seed()
  loginAs('owner')
  auth.refreshSession.mockReset()
})

const table = (name: string) => fake.tables[name]!
const byId = (name: string, id: string) => table(name).find(r => r.id === id)
const snap = (...names: string[]) => structuredClone(Object.fromEntries(names.map(n => [n, table(n)])))
const ALL_TABLES = ['bank_accounts', 'bank_account_statements', 'financial_transactions', 'employee_financial_records', 'bonus_generations']
const MONEY_TABLES = ['bank_accounts', 'bank_account_statements', 'financial_transactions']
const writesTo = (...names: string[]) => fake.writes.filter(w => names.includes(w.table))
const round2 = (n: number) => Math.round(n * 100) / 100

const remove = (bonusId: string, recordId: string, body?: unknown) =>
  callHandler(REMOVE, fakeEvent({ method: 'DELETE', cookies, params: { id: bonusId, recordId }, body }))
const listRecords = (bonusId: string, query: Record<string, unknown> = {}) =>
  callHandler(LIST, fakeEvent({ cookies, params: { id: bonusId }, query }))
const generate = (bonusId: string, body: Record<string, unknown>) =>
  callHandler(GENERATE, fakeEvent({ method: 'POST', cookies, params: { id: bonusId }, body }))

/** Saldo de uma conta menos (saldo inicial + soma assinada dos extratos). 0 = coerente (I1). */
function statementDivergence(accountId: string) {
  const acc = byId('bank_accounts', accountId)!
  const sum = table('bank_account_statements')
    .filter(s => s.bank_account_id === accountId)
    .reduce((t, s) => t + (s.transaction_type === 'income' ? s.amount : -s.amount), 0)
  return round2(Number(acc.current_balance) - (Number(acc.initial_balance) + sum))
}

/** Extratos da conta ligados a uma transação inexistente ou já deletada. */
function orphanStatements(accountId: string) {
  const liveTx = new Set(table('financial_transactions').filter(t => !t.deleted_at).map(t => t.id))
  return table('bank_account_statements')
    .filter(s => s.bank_account_id === accountId && s.financial_transaction_id && !liveTx.has(s.financial_transaction_id))
    .map(s => s.id)
}

/** Asserções do estorno do bônus pago. Exatas ao centavo: nada de toBeCloseTo. */
function expectPaidBonusFullyReverted(expectedBalance: number) {
  expect(byId('bank_accounts', 'acc-a')!.current_balance).toBe(expectedBalance)
  expect(statementDivergence('acc-a')).toBe(0)
  expect(orphanStatements('acc-a')).toEqual([])
  expect(byId('bank_account_statements', 's-pay')).toBeUndefined()
}

describe('BON-02a: DELETE de registro pago estorna o saldo', () => {
  it('BON-02a: 200; saldo volta ao valor exato anterior ao pagamento; sem extrato órfão; soma de extratos == saldo', async () => {
    const orgB = snap('bank_accounts', 'bank_account_statements', 'financial_transactions')
    const res = await remove('bon-a', 'efr-paid', { reason: '  lançado errado  ' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })

    expectPaidBonusFullyReverted(BALANCE_BEFORE_PAYMENT)
    expect(byId('bank_account_statements', 's-open')).toBeDefined()
    expect(table('bank_account_statements').filter(s => s.bank_account_id === 'acc-a')).toHaveLength(1)

    // Registro: soft delete com motivo (aparado), origem e autor.
    const record = byId('employee_financial_records', 'efr-paid')!
    expect(typeof record.deleted_at).toBe('string')
    expect(record.deletion_reason).toBe('lançado errado')
    expect(record.deletion_source).toBe(FINANCIAL_TRANSACTION_DELETION_SOURCES.EMPLOYEE_FINANCIAL_RECORD_DELETE)
    expect(record.deleted_by).toBe('owner@a.com')

    // Transação vinculada: soft delete com origem, nunca delete físico.
    const tx = byId('financial_transactions', 'ft-1')!
    expect(typeof tx.deleted_at).toBe('string')
    expect(tx.deletion_reason).toBe('lançado errado')
    expect(tx.deletion_source).toBe(FINANCIAL_TRANSACTION_DELETION_SOURCES.EMPLOYEE_FINANCIAL_RECORD_DELETE)
    expect(writesTo('financial_transactions').every(w => w.op === 'update')).toBe(true)

    // A geração do pagamento some; as demais permanecem.
    expect(byId('bonus_generations', 'gen-paid')).toBeUndefined()
    expect(table('bonus_generations').map(g => g.id).sort()).toEqual(['gen-b-paid', 'gen-pend'])

    // Org B intacta, só a conta de A recebeu escrita.
    expect(snap('bank_accounts', 'bank_account_statements', 'financial_transactions').bank_accounts.find((a: any) => a.id === 'acc-b'))
      .toEqual(orgB.bank_accounts.find((a: any) => a.id === 'acc-b'))
    expect(table('bank_account_statements').filter(s => s.organization_id === 'org-b')).toEqual(orgB.bank_account_statements.filter((s: any) => s.organization_id === 'org-b'))
    expect(byId('financial_transactions', 'ft-b')).toEqual(orgB.financial_transactions.find((t: any) => t.id === 'ft-b'))
    expect(writesTo('bank_accounts').every(w => w.filters.includes('id=acc-a') || w.filters.includes('bank_account_id=acc-a'))).toBe(true)
  })

  // Controle de sensibilidade (mutante dentro do teste): o mesmo conjunto de asserções TEM que falhar
  // se o saldo final divergir um centavo, para cima ou para baixo, ou se o extrato do pagamento continuar lá.
  describe('controle: as asserções do estorno reprovam divergência de 1 centavo', () => {
    const mutations: Array<[string, () => void]> = [
      ['saldo +0,01', () => { byId('bank_accounts', 'acc-a')!.current_balance = round2(BALANCE_BEFORE_PAYMENT + 0.01) }],
      ['saldo -0,01', () => { byId('bank_accounts', 'acc-a')!.current_balance = round2(BALANCE_BEFORE_PAYMENT - 0.01) }],
      ['extrato do pagamento reinserido (órfão) com saldo correto', () => {
        table('bank_account_statements').push({ id: 's-pay', organization_id: 'org-a', bank_account_id: 'acc-a', financial_transaction_id: 'ft-1', transaction_type: 'expense', amount: PAID_AMOUNT, previous_balance: 1000, balance_after: 649.9 })
      }]
    ]
    for (const [label, mutate] of mutations) {
      it(`mutante "${label}" é detectado`, async () => {
        expect((await remove('bon-a', 'efr-paid', { reason: 'x' })).status).toBe(200)
        expect(() => expectPaidBonusFullyReverted(BALANCE_BEFORE_PAYMENT)).not.toThrow() // estado real passa
        mutate()
        expect(() => expectPaidBonusFullyReverted(BALANCE_BEFORE_PAYMENT)).toThrow()
      })
    }
  })
})

describe('BON-02b: DELETE de registro pendente', () => {
  it('BON-02b: 200; nenhum saldo, extrato ou transação muda; geração liberada para reprocessar', async () => {
    // Controle: antes do DELETE, gerar de novo é barrado.
    const blocked = await generate('bon-a', { referenceMonth: MONTH, employeeId: 'e1' })
    expect((blocked.body as any).data.results[0].status).toBe('already_generated')

    const money = snap(...MONEY_TABLES)
    const writesBefore = fake.writes.length
    const res = await remove('bon-a', 'efr-pend', { reason: 'duplicado' })
    expect(res.status).toBe(200)

    expect(snap(...MONEY_TABLES)).toEqual(money)
    expect(fake.writes.slice(writesBefore).filter(w => MONEY_TABLES.includes(w.table))).toEqual([])
    const record = byId('employee_financial_records', 'efr-pend')!
    expect(typeof record.deleted_at).toBe('string')
    expect(record.deletion_reason).toBe('duplicado')
    expect(byId('bonus_generations', 'gen-pend')).toBeUndefined()
    expect(byId('bonus_generations', 'gen-paid')).toBeDefined() // geração do registro pago não é tocada

    // Liberada: gera de novo, e agora cria um registro novo (e1 atinge a meta em outubro).
    const again = await generate('bon-a', { referenceMonth: MONTH, employeeId: 'e1' })
    expect((again.body as any).data.results[0].status).toBe('generated')
    const live = table('employee_financial_records').filter(r => r.bonus_id === 'bon-a' && r.employee_id === 'e1' && r.reference_date === '2026-10-15' && !r.deleted_at)
    expect(live).toHaveLength(1)
    expect(live[0]!.id).not.toBe('efr-pend')
  })
})

describe('BON-02c: registro pago cuja transação vinculada não existe (G1-SD-11, KF-48)', () => {
  // Solução-agnóstico: rejeitar (4xx, registro intacto) ou estornar mesmo assim satisfazem. O defeito é apagar o registro
  // pago e deixar o extrato/saldo do pagamento em pé, sem erro e sem estorno (o bloco de estorno é pulado em silêncio).
  const SCENARIOS: Array<[string, () => void]> = [
    ['transação já deletada (soft)', () => { byId('financial_transactions', 'ft-1')!.deleted_at = '2026-09-12T00:00:00.000Z' }],
    ['transação ausente', () => { fake.tables.financial_transactions = table('financial_transactions').filter(t => t.id !== 'ft-1') }]
  ]
  for (const [label, arrange] of SCENARIOS) {
    it.fails(`BON-02c: ${label} -> não apaga o registro pago deixando o pagamento sem estorno [KF-48, G1-SD-11]`, async () => {
      arrange()
      const res = await remove('bon-a', 'efr-paid', { reason: 'erro' })
      const recordGone = !!byId('employee_financial_records', 'efr-paid')!.deleted_at
      const paymentEffectStillStanding = !!byId('bank_account_statements', 's-pay')
      expect(recordGone && paymentEffectStillStanding, `status ${res.status}: registro pago apagado com o extrato/saldo do pagamento ainda em pé`).toBe(false)
      expect(statementDivergence('acc-a')).toBe(0)
    })
  }
})

describe('BON-02d: validação e idempotência', () => {
  const untouched = () => snap(...ALL_TABLES)

  it.each([
    ['sem reason', { }],
    ['reason só com espaços', { reason: '   ' }],
    ['reason vazio', { reason: '' }],
    ['reason não string', { reason: 123 }],
    ['sem corpo', undefined]
  ])('BON-02d: %s -> 400, nada alterado (nem saldo)', async (_label, body) => {
    const before = untouched()
    const res = await remove('bon-a', 'efr-paid', body)
    expect(res.status).toBe(400)
    expect(untouched()).toEqual(before)
    expect(fake.writes).toEqual([])
  })

  it('BON-02d: recordId de outro bônus (mesma org) -> 404, registro do outro bônus intacto', async () => {
    const before = untouched()
    const res = await remove('bon-a', 'efr-other', { reason: 'x' })
    expect(res.status).toBe(404)
    expect(untouched()).toEqual(before)
    expect(fake.writes).toEqual([])
  })

  it('BON-02d: recordId inexistente -> 404', async () => {
    const res = await remove('bon-a', 'nope', { reason: 'x' })
    expect(res.status).toBe(404)
    expect(fake.writes).toEqual([])
  })

  it('BON-02d: registro já deletado desde o seed -> 404, deleted_at original preservado', async () => {
    const original = byId('employee_financial_records', 'efr-gone')!.deleted_at
    const res = await remove('bon-a', 'efr-gone', { reason: 'x' })
    expect(res.status).toBe(404)
    expect(byId('employee_financial_records', 'efr-gone')!.deleted_at).toBe(original)
    expect(fake.writes).toEqual([])
  })

  it('BON-02d: segunda chamada sobre registro pago -> 404 e o saldo não é estornado de novo', async () => {
    expect((await remove('bon-a', 'efr-paid', { reason: 'primeira' })).status).toBe(200)
    expectPaidBonusFullyReverted(BALANCE_BEFORE_PAYMENT)
    const afterFirst = snap(...ALL_TABLES)
    const writesBefore = fake.writes.length

    const second = await remove('bon-a', 'efr-paid', { reason: 'segunda' })
    expect(second.status).toBe(404)
    expect(byId('bank_accounts', 'acc-a')!.current_balance).toBe(BALANCE_BEFORE_PAYMENT) // 1000, não 1350,10
    expect(snap(...ALL_TABLES)).toEqual(afterFirst)
    expect(fake.writes.slice(writesBefore)).toEqual([])
    expect(byId('employee_financial_records', 'efr-paid')!.deletion_reason).toBe('primeira')
  })
})

describe('BON-02e / BON-06h: isolamento de tenant (A logado, B é dono)', () => {
  it('BON-02e: DELETE de registro pago de B -> 404; saldo, extratos, transação, registro e geração de B intactos', async () => {
    const before = snap(...ALL_TABLES)
    const res = await remove('bon-b', 'efr-b-paid', { reason: 'tentativa' })
    expect(res.status).toBe(404)
    expect(byId('bank_accounts', 'acc-b')!.current_balance).toBe(300)
    expect(snap(...ALL_TABLES)).toEqual(before)
    expect(fake.writes).toEqual([])
  })

  it('BON-02e: bônus de A com recordId de B -> 404; B intacto', async () => {
    const before = snap(...ALL_TABLES)
    const res = await remove('bon-a', 'efr-b-paid', { reason: 'tentativa' })
    expect(res.status).toBe(404)
    expect(snap(...ALL_TABLES)).toEqual(before)
    expect(fake.writes).toEqual([])
  })

  it('BON-06h: GET financial-records do bônus de B logado em A -> 404', async () => {
    const res = await listRecords('bon-b', { referenceMonth: MONTH })
    expect(res.status).toBe(404)
    expect(res.body).toBeUndefined()
  })

  it('BON-06h: controle - GET do bônus de A (owner) devolve só registros de A', async () => {
    const res = await listRecords('bon-a', { referenceMonth: '2026-09-01' })
    expect(res.status).toBe(200)
    const ids = (res.body as { items: Array<{ id: string }> }).items.map(i => i.id)
    expect(ids).toEqual(['efr-paid'])
  })

  it('BON-06h: emp-sem e emp-upd (sem bonuses.read) -> 403', async () => {
    for (const persona of ['emp-sem', 'emp-upd'] as const) {
      loginAs(persona)
      const res = await listRecords('bon-a', { referenceMonth: '2026-09-01' })
      expect(res.status, persona).toBe(403)
      expect(res.error?.statusMessage).toContain('Acesso negado')
    }
  })
})

describe('BON-06k: permissão bonuses.delete no DELETE', () => {
  it.each(['emp-sem', 'emp-upd'] as const)('BON-06k: %s (sem bonuses.delete) -> 403; saldo, registro e extratos intactos', async (persona) => {
    loginAs(persona)
    const before = snap(...ALL_TABLES)
    const res = await remove('bon-a', 'efr-paid', { reason: 'x' })
    expect(res.status).toBe(403)
    expect(res.error?.statusMessage).toContain('Acesso negado')
    expect(byId('bank_accounts', 'acc-a')!.current_balance).toBe(BALANCE_AFTER_PAYMENT)
    expect(snap(...ALL_TABLES)).toEqual(before)
    expect(fake.writes).toEqual([])
  })

  it('BON-06k: controle - admin tem acesso (200) e estorna', async () => {
    loginAs('admin')
    const res = await remove('bon-a', 'efr-paid', { reason: 'x' })
    expect(res.status).toBe(200)
    expectPaidBonusFullyReverted(BALANCE_BEFORE_PAYMENT)
    expect(byId('employee_financial_records', 'efr-paid')!.deleted_by).toBe('admin@a.com')
  })

  it('BON-06k: controle - role com bonuses.delete concedido (emp-com) -> 200 e estorna', async () => {
    table('role_actions').push({ role_id: 'r-upd', action_id: 'act-delete', is_granted: true })
    loginAs('emp-upd')
    const res = await remove('bon-a', 'efr-paid', { reason: 'x' })
    expect(res.status).toBe(200)
    expectPaidBonusFullyReverted(BALANCE_BEFORE_PAYMENT)
  })
})

describe('BON-14: DELETE de bônus com pagamentos gerados', () => {
  it.todo('BON-14: DELETE /api/bonuses/:id com pagamentos já gerados. Efeito sobre os pagamentos aguarda G1-OQ-07; fica para a PR 6 (arquivo crud)')
})
