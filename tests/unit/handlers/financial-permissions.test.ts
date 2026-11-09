// Permissão e isolamento nas ESCRITAS financeiras (invariante I8). Cenários S1–S6 de
// docs/testing/financial-core-test-analysis.md.
//  S1 (sem login → 401) já é coberto para todo handler por guard-matrix.test.ts (M1); aqui só conferimos
//     que as rotas financeiras estão dentro dessa matriz.
//  S2 é a face comportamental do KF-09: usuário sem papel financeiro consegue mexer em dinheiro.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../helpers/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fake-supabase'
import { PERMISSION_GUARDS, listHandlers, WRITE_METHODS } from '../../helpers/source-scan'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))
vi.mock('../../../server/utils/service-order-commissions', () => ({
  releaseServiceOrderCommissions: vi.fn(async () => ({ commissions: [], totalCommission: 0, warnings: [] }))
}))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const SO = 'server/api/service-orders/[id]'

interface Route { name: string, file: string, params?: Record<string, string>, body?: unknown, query?: Record<string, unknown>, method?: string }

/** Escritas que movimentam dinheiro, com um corpo válido para a org A (para provar que SÓ a permissão as barraria). */
const MONEY_ROUTES: Route[] = [
  { name: 'financial/:id/pay', file: 'server/api/financial/[id]/pay.post.ts', params: { id: 'exp1' } },
  { name: 'financial/pay-entries-bulk', file: 'server/api/financial/pay-entries-bulk.post.ts', body: { entryIds: ['exp1'] } },
  { name: 'financial/pay-commissions-bulk', file: 'server/api/financial/pay-commissions-bulk.post.ts', body: { registroIds: ['cm1'] } },
  { name: 'reports/commissions/:id/pay', file: 'server/api/reports/commissions/[id]/pay.post.ts', params: { id: 'cm1' } },
  { name: 'service-orders/:id/down-payment', file: `${SO}/down-payment.post.ts`, params: { id: 'o-open' }, body: { amount: 50, bankAccountId: 'acc-a', paymentMethod: 'pix' } },
  { name: 'service-orders/:id/process-payment', file: `${SO}/process-payment.post.ts`, params: { id: 'o1' }, body: { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 300, status: 'paid' }] } },
  { name: 'service-orders/:id/receive-extra-payment', file: `${SO}/receive-extra-payment.post.ts`, params: { id: 'o1' }, body: { amount: 10, bankAccountId: 'acc-a', paymentMethod: 'pix' } },
  { name: 'service-orders/:id/cancel', file: `${SO}/cancel.post.ts`, params: { id: 'o1' } },
  { name: 'purchases/:id/pay', file: 'server/api/purchases/[id]/pay.post.ts', params: { id: 'pu1' }, body: {} },
  { name: 'financial/:id (excluir)', file: 'server/api/financial/[id].delete.ts', params: { id: 'exp1' }, body: { reason: 'teste' }, method: 'DELETE' }
]

function seed(role: 'sem-papel' | 'owner' = 'sem-papel') {
  fake = createFakeSupabase({
    user_profiles: [
      { id: 'p1', user_id: 'u1', organization_id: 'org-a', role_id: 'r-operador', is_owner: role === 'owner', is_active: true, employee_id: null },
      { id: 'p2', user_id: 'u2', organization_id: 'org-b', role_id: 'r-operador', is_owner: false, is_active: true, employee_id: null }
    ],
    // papel comum, sem nenhuma permissão concedida
    roles: [{ id: 'r-operador', name: 'operador', is_system_role: false }],
    actions: [],
    role_actions: [],
    bank_accounts: [
      { id: 'acc-a', organization_id: 'org-a', current_balance: 1000, is_active: true },
      { id: 'acc-b', organization_id: 'org-b', current_balance: 50, is_active: true }
    ],
    bank_account_statements: [],
    financial_categories: [
      { id: 'cat-sal', organization_id: 'org-a', deleted_at: null, name: 'Salários', type: 'expense', is_default: true },
      { id: 'cat-srv', organization_id: 'org-a', deleted_at: null, name: 'Serviços', type: 'income', is_default: true }
    ],
    financial_transactions: [
      { id: 'exp1', organization_id: 'org-a', deleted_at: null, type: 'expense', status: 'pending', amount: 80, due_date: '2026-03-10', bank_account_id: 'acc-a' },
      { id: 'exp-xacc', organization_id: 'org-a', deleted_at: null, type: 'expense', status: 'pending', amount: 25, due_date: '2026-03-10', bank_account_id: 'acc-b' },
      { id: 'exp-b', organization_id: 'org-b', deleted_at: null, type: 'expense', status: 'pending', amount: 20, due_date: '2026-03-10', bank_account_id: 'acc-b' }
    ],
    employees: [],
    employee_financial_records: [
      { id: 'cm1', organization_id: 'org-a', deleted_at: null, employee_id: 'e1', record_type: 'commission', amount: 100, status: 'pending', reference_date: '2026-03-05' },
      { id: 'cm-b', organization_id: 'org-b', deleted_at: null, employee_id: 'e9', record_type: 'commission', amount: 500, status: 'pending', reference_date: '2026-03-05' }
    ],
    service_orders: [
      { id: 'o1', organization_id: 'org-a', deleted_at: null, number: '100', status: 'completed', total_amount: 300, payment_status: 'pending' },
      { id: 'o-open', organization_id: 'org-a', deleted_at: null, number: '101', status: 'in_progress', total_amount: 100, payment_status: 'pending' },
      { id: 'o-b', organization_id: 'org-b', deleted_at: null, number: '900', status: 'completed', total_amount: 500, payment_status: 'pending' }
    ],
    service_order_installments: [],
    purchases: [{ id: 'pu1', organization_id: 'org-a', deleted_at: null, total_amount: 700, payment_status: 'pending', bank_account_id: 'acc-a' }]
  })
}

beforeEach(() => {
  seed()
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@a.com' } }, error: null })
  auth.refreshSession.mockReset()
})

const run = (r: Route, extra: Partial<Route> = {}) =>
  callHandler(r.file, fakeEvent({ method: r.method ?? 'POST', cookies, params: r.params, body: r.body, query: r.query, ...extra }))

const balanceB = () => fake.tables.bank_accounts!.find(a => a.id === 'acc-b')!.current_balance as number
const stmtB = () => fake.tables.bank_account_statements!.filter(s => s.bank_account_id === 'acc-b')

describe('S1: as rotas financeiras estão dentro da matriz M1 (sem login → 401)', () => {
  it('todas existem e respondem 401 sem sessão', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } })
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { status: 401 } })
    for (const r of MONEY_ROUTES) {
      const res = await callHandler(r.file, fakeEvent({ method: r.method ?? 'POST', params: r.params, body: r.body }))
      expect(res.status, r.name).toBe(401)
    }
  })
})

describe('S2 / KF-09: usuário sem papel financeiro não mexe em dinheiro', () => {
  // Enquanto o KF-09 existir, cada rota abaixo responde 200 para um usuário sem nenhuma permissão.
  // Ao corrigir uma rota (requireOrgPermission), o Vitest acusa "unexpected pass": troque it.fails por it.
  for (const r of MONEY_ROUTES) {
    it.fails(`${r.name} → 403 para papel sem permissão`, async () => {
      const res = await run(r)
      expect(res.status, `${r.name} respondeu ${res.status} (${res.error?.message ?? 'ok'})`).toBe(403)
    })
  }
  it('o dono da oficina continua podendo (controle: a permissão não pode ser a única barreira de uso)', async () => {
    seed('owner')
    const res = await run(MONEY_ROUTES[0]!)
    expect(res.status).toBe(200)
  })
})

describe('S3: organization_id vindo do cliente é ignorado', () => {
  it('query ?organization_id=org-b não dá acesso a lançamento da outra oficina (404)', async () => {
    const res = await callHandler('server/api/financial/[id]/pay.post.ts', fakeEvent({ method: 'POST', cookies, params: { id: 'exp-b' }, query: { organization_id: 'org-b' } }))
    expect(res.status).toBe(404)
    expect(balanceB()).toBe(50)
  })
  it('body.organization_id=org-b no recebimento avulso grava na org A da sessão', async () => {
    const res = await callHandler(`${SO}/receive-extra-payment.post.ts`, fakeEvent({ method: 'POST', cookies, params: { id: 'o1' }, body: { amount: 10, bankAccountId: 'acc-a', paymentMethod: 'pix', organization_id: 'org-b' } }))
    expect(res.status).toBe(200)
    const created = [...fake.tables.service_order_installments!, ...fake.tables.financial_transactions!.filter(t => t.service_order_id === 'o1')]
    expect(created.length).toBeGreaterThan(0)
    expect(created.every(x => x.organization_id === 'org-a')).toBe(true)
    expect(balanceB()).toBe(50)
  })
  it('body.organization_id no pagamento de comissão em lote não paga registro da outra oficina', async () => {
    const res = await callHandler('server/api/financial/pay-commissions-bulk.post.ts', fakeEvent({ method: 'POST', cookies, body: { registroIds: ['cm-b'], organization_id: 'org-b' } }))
    expect((res.body as any).data).toMatchObject({ paidCount: 0, failedCount: 1 })
    expect(fake.tables.employee_financial_records!.find(r => r.id === 'cm-b')!.status).toBe('pending')
  })
})

describe('S4: conta bancária de outra organização nunca é movimentada', () => {
  const FOREIGN: Route[] = [
    { name: 'down-payment', file: `${SO}/down-payment.post.ts`, params: { id: 'o-open' }, body: { amount: 50, bankAccountId: 'acc-b', paymentMethod: 'pix' } },
    { name: 'process-payment', file: `${SO}/process-payment.post.ts`, params: { id: 'o1' }, body: { paymentMethod: 'pix', bankAccountId: 'acc-b', installments: [{ amount: 300, status: 'paid' }] } },
    { name: 'receive-extra-payment', file: `${SO}/receive-extra-payment.post.ts`, params: { id: 'o1' }, body: { amount: 10, bankAccountId: 'acc-b', paymentMethod: 'pix' } },
    { name: 'reports/commissions/:id/pay', file: 'server/api/reports/commissions/[id]/pay.post.ts', params: { id: 'cm1' }, body: { bankAccountId: 'acc-b' } },
    { name: 'pay-commissions-bulk', file: 'server/api/financial/pay-commissions-bulk.post.ts', body: { registroIds: ['cm1'], contaBancariaId: 'acc-b' } },
    // lançamento da org A apontando para conta da org B (dado já inconsistente): pagar não pode tocar a conta alheia
    { name: 'financial/:id/pay (lançamento → conta alheia)', file: 'server/api/financial/[id]/pay.post.ts', params: { id: 'exp-xacc' } },
    { name: 'pay-entries-bulk (lançamento → conta alheia)', file: 'server/api/financial/pay-entries-bulk.post.ts', body: { entryIds: ['exp-xacc'] } }
  ]
  for (const r of FOREIGN) {
    it(`${r.name}: saldo e extrato da org B ficam intactos`, async () => {
      seed('owner')
      await run(r)
      expect(balanceB()).toBe(50)
      expect(stmtB()).toHaveLength(0)
    })
  }
})

describe('S6: varredura estática das escritas financeiras', () => {
  const TOUCHES_MONEY = /from\(\s*['"](financial_transactions|bank_accounts|bank_account_statements|service_order_installments|employee_financial_records)['"]\s*\)/
  const moneyWriters = listHandlers().filter(h => h.size > 0 && h.method && WRITE_METHODS.has(h.method) && TOUCHES_MONEY.test(h.source))

  it('há escritas financeiras para analisar', () => {
    expect(moneyWriters.length).toBeGreaterThan(15)
  })
  it('as rotas de dinheiro listadas neste arquivo existem (a lista não envelhece)', () => {
    const files = new Set(listHandlers().map(h => h.file))
    for (const r of MONEY_ROUTES) expect(files.has(r.file), r.file).toBe(true)
  })
  it('toda escrita financeira resolve a organização da sessão (resolveOrganizationId/requireOrgPermission/requireOwner)', () => {
    const missing = moneyWriters.filter(h => !/\b(resolveOrganizationId|requireOrgPermission|requireOwner)\b/.test(h.source)).map(h => h.file)
    expect(missing, `Sem organização da sessão:\n${missing.join('\n')}`).toEqual([])
  })
  it('nenhuma escrita financeira lê organization_id do corpo/query da requisição', () => {
    const leaky = moneyWriters.filter(h => /(body|query)\??\.(organization_id|organizationId)\b/.test(h.source)).map(h => h.file)
    expect(leaky, `Confia no organization_id do cliente:\n${leaky.join('\n')}`).toEqual([])
  })
  // Mesma causa do KF-09, visão focada em dinheiro: lista o que ainda não pede permissão por papel.
  it.fails('KF-09 (foco financeiro): toda escrita que mexe em dinheiro exige requireOrgPermission/requireOwner', () => {
    const open = moneyWriters.filter(h => !PERMISSION_GUARDS.test(h.source)).map(h => h.file)
    expect(open, `Sem permissão por papel (${open.length}):\n${open.join('\n')}`).toEqual([])
  })
})
