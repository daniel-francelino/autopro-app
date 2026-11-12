// Fase 7 (metade B) do plano de acesso: leitura em telas PRÓPRIAS do domínio (financial/*, reports/*, employees/:id/commissions).
// Para cada GET guardado: (i) sem o código -> 403 e sem dados sensíveis; (ii) com outro código -> 403;
// (iii) com o código -> 200; (iv) admin e owner (role_actions vazio) -> 200. Usa o requireOrgPermission real.
// Rotas que ficam SÓ ORG (D1, D13 e decisão de escopo da Fase 7B): role sem concessão -> não é 403.
// Gates de plano (enforceReportAccess) continuam valendo: o seed tem plano pro ativo.
// Plano: docs/engineering/access-control-rollout-plan.md, seção 8, Fase 7.
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
const api = (p: string) => `server/api/${p}`
const range = { dateFrom: '2026-03-01', dateTo: '2026-03-31' }

type Case = { name: string, file: string, params?: Record<string, string>, query?: Record<string, unknown>, code: string }

const TABLES = {
  subscriptions: [{ id: 's1', organization_id: 'org-a', plan_key: 'pro', status: 'active', deleted_at: null }],
  clients: [{ id: 'c1', organization_id: 'org-a', deleted_at: null, name: 'SEGREDO-CLIENTE' }],
  employees: [{ id: 'e1', organization_id: 'org-a', deleted_at: null, name: 'Ana' }],
  financial_categories: [{ id: 'cat-a', organization_id: 'org-a', deleted_at: null, name: 'Aluguel', type: 'expense', is_default: false }],
  employee_financial_records: [
    { id: 'cm1', organization_id: 'org-a', deleted_at: null, employee_id: 'e1', record_type: 'commission', amount: 100, status: 'pending', reference_date: '2026-03-05', service_order_id: null }
  ],
  financial_transactions: [
    { id: 'exp1', organization_id: 'org-a', deleted_at: null, type: 'expense', status: 'pending', amount: 80, due_date: '2026-03-10', description: 'SEGREDO-LANCAMENTO', category_id: 'cat-a' }
  ]
}

const CODES = ['financial.read', 'reports.view', 'reports.commissions', 'reports.costs', 'reports.customers', 'reports.debtors',
  'reports.profit', 'reports.purchases', 'reports.sales', 'reports.suppliers', 'reports.employees', 'employees.read']

const GUARDED: Case[] = [
  { name: 'financial GET', file: api('financial/index.get.ts'), code: 'financial.read' },
  { name: 'financial/summary GET', file: api('financial/summary.get.ts'), code: 'financial.read' },
  { name: 'financial/:id GET', file: api('financial/[id].get.ts'), params: { id: 'exp1' }, code: 'financial.read' },
  { name: 'financial/categories GET', file: api('financial/categories/index.get.ts'), code: 'financial.read' },
  { name: 'reports/commissions GET', file: api('reports/commissions.get.ts'), query: range, code: 'reports.commissions' },
  { name: 'reports/costs-profit GET', file: api('reports/costs-profit.get.ts'), query: range, code: 'reports.costs' },
  { name: 'reports/customers GET', file: api('reports/customers.get.ts'), query: range, code: 'reports.customers' },
  { name: 'reports/debtors GET', file: api('reports/debtors.get.ts'), query: range, code: 'reports.debtors' },
  { name: 'reports/overview GET', file: api('reports/overview.get.ts'), query: range, code: 'reports.view' },
  { name: 'reports/profit-by-order GET', file: api('reports/profit-by-order.get.ts'), query: range, code: 'reports.profit' },
  { name: 'reports/profit-cash-flow GET', file: api('reports/profit-cash-flow.get.ts'), query: range, code: 'reports.profit' },
  { name: 'reports/purchases GET', file: api('reports/purchases.get.ts'), query: range, code: 'reports.purchases' },
  { name: 'reports/sales-items GET', file: api('reports/sales-items.get.ts'), query: range, code: 'reports.sales' },
  { name: 'reports/suppliers GET', file: api('reports/suppliers.get.ts'), query: range, code: 'reports.suppliers' },
  { name: 'reports/employees GET', file: api('reports/employees.get.ts'), query: { ...range, employeeId: 'e1' }, code: 'reports.employees' },
  { name: 'reports/commissions/:id GET', file: api('reports/commissions/[id].get.ts'), params: { id: 'cm1' }, code: 'reports.commissions' },
  { name: 'employees/:id/commissions GET', file: api('employees/[id]/commissions.get.ts'), params: { id: 'e1' }, query: range, code: 'employees.read' }
]

// Ficam só org: chamadas de outras telas ou decisão explícita (D1, D13).
const ORG_ONLY: Case[] = [
  { name: 'reports/dashboard-stats GET (home, D13)', file: api('reports/dashboard-stats.get.ts'), query: range, code: '' },
  { name: 'employees GET (lista usada em criação de OS)', file: api('employees/index.get.ts'), code: '' }
]

function login(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

beforeEach(() => {
  auth.refreshSession.mockReset()
})

const run = (c: Case) => callHandler(c.file, fakeEvent({ method: 'GET', cookies, params: c.params, query: c.query }))
const otherCode = (c: Case) => CODES.find(x => x !== c.code)!

describe.each(GUARDED)('$name exige $code', (c) => {
  it('role sem o código -> 403 e sem dados sensíveis', async () => {
    fake = createFakeSupabase(guardSeed([c.code], TABLES))
    login('sem')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body ?? {})).not.toContain('SEGREDO')
  })

  it('role com outro código -> 403', async () => {
    fake = createFakeSupabase(guardSeed([c.code, otherCode(c)], TABLES))
    fake.tables.role_actions!.length = 0
    fake.tables.role_actions!.push({ role_id: 'r-com', action_id: 'act-1', is_granted: true })
    login('com')
    expect((await run(c)).status).toBe(403)
  })

  it('role com o código -> 200', async () => {
    fake = createFakeSupabase(guardSeed([c.code], TABLES))
    login('com')
    expect((await run(c)).status).toBe(200)
  })

  it.each(['admin', 'owner'] as const)('%s passa sem concessão em role_actions', async (persona) => {
    fake = createFakeSupabase(guardSeed([c.code], TABLES))
    fake.tables.role_actions!.length = 0
    login(persona)
    expect((await run(c)).status).toBe(200)
  })
})

describe.each(ORG_ONLY)('$name continua só org', (c) => {
  it('role sem nenhuma concessão -> não é 403', async () => {
    fake = createFakeSupabase(guardSeed(CODES, TABLES))
    fake.tables.role_actions!.length = 0
    login('sem')
    const res = await run(c)
    expect(res.status).not.toBe(403)
  })
})
