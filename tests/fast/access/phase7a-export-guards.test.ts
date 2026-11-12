// Fase 7 (metade A) do plano de acesso: as 7 exportações POST exigem o mesmo código que a tela que as chama usa para mostrar o botão (R3).
// `reports/export-employees` também é chamado do detalhe do funcionário (gate employees.read no front); o servidor segue a tela de relatórios (reports.employees, D12; o botão do detalhe é do agente B).
// Para cada rota: (i) sem o código -> 403, nenhuma escrita e tabelas iguais; (ii) role só com um código irmão (não o exigido) -> 403;
// (iii) com o código -> passa do guard e devolve o resultado do handler com o corpo mínimo abaixo; (iv) admin e owner (role_actions vazio) -> mesmo resultado.
// Com tabelas vazias, 6 handlers respondem 'Não há dados para exportar.' (status 400/500/0 conforme o handler: 0 = Error simples, sem statusCode); só export-csv devolve 200.
// Isso já prova que passaram do guard (o 403 do guard sai antes de qualquer leitura); a geração do arquivo em si é coberta pelos testes de cada domínio.
// Usa o requireOrgPermission real. Nenhum dos 6 códigos tem gate de plano em ACTION_PLAN_REQUIREMENTS (só reports.customers/costs/debtors têm), então não há seed de plano.
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

type Case = { name: string, file: string, params: Record<string, string>, body: unknown, code: string, sibling: string, status: number, message?: string }

const CASES: Case[] = [
  { name: 'financial/export', file: 'server/api/financial/export.post.ts', params: {}, body: { format: 'csv' }, code: 'financial.read', status: 400, message: 'Não há dados para exportar.', sibling: 'financial.create' },
  { name: 'reports/export-commissions', file: 'server/api/reports/export-commissions.post.ts', params: {}, body: { format: 'csv' }, code: 'reports.commissions', status: 0, message: 'Não há dados para exportar.', sibling: 'reports.sales' },
  { name: 'reports/export-employees', file: 'server/api/reports/export-employees.post.ts', params: {}, body: { format: 'csv' }, code: 'reports.employees', status: 0, message: 'Não há dados para exportar.', sibling: 'employees.read' },
  { name: 'employees/[id]/export-commissions', file: 'server/api/employees/[id]/export-commissions.post.ts', params: { id: 'e1' }, body: { format: 'csv' }, code: 'employees.read', status: 500, message: 'Não há dados para exportar.', sibling: 'employees.update' },
  { name: 'reports/export-purchases', file: 'server/api/reports/export-purchases.post.ts', params: {}, body: { format: 'csv' }, code: 'reports.purchases', status: 0, message: 'Não há dados para exportar.', sibling: 'reports.commissions' },
  { name: 'reports/export-sales-items', file: 'server/api/reports/export-sales-items.post.ts', params: {}, body: { format: 'csv' }, code: 'reports.sales', status: 0, message: 'Não há dados para exportar.', sibling: 'reports.purchases' },
  { name: 'service-orders/export-csv', file: 'server/api/service-orders/export-csv.post.ts', params: {}, body: { filters: {} }, code: 'orders.read', status: 200, sibling: 'orders.update' }
]

const ALL_CODES = [...new Set(CASES.flatMap(c => [c.code, c.sibling]))]

const TABLES = {
  organizations: [{ id: 'org-a', name: 'Org A' }],
  employees: [{ id: 'e1', organization_id: 'org-a', name: 'Ana', deleted_at: null }],
  service_orders: [],
  financial_transactions: [],
  financial_categories: [],
  clients: [],
  purchases: [],
  suppliers: [],
  employee_financial_records: []
}

function login(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

beforeEach(() => {
  auth.refreshSession.mockReset()
})

const run = (c: Case) => callHandler(c.file, fakeEvent({ method: 'POST', cookies, params: c.params, body: c.body }))
const seed = () => createFakeSupabase(guardSeed(ALL_CODES, structuredClone(TABLES)))
const grantOnly = (code: string) => {
  const id = fake.tables.actions!.find(a => a.code === code)!.id
  fake.tables.role_actions = [{ role_id: 'r-com', action_id: id, is_granted: true }]
}

describe.each(CASES)('$name exige o código da tela', (c) => {
  it('role sem o código -> 403, nenhuma escrita e tabelas iguais', async () => {
    fake = seed()
    fake.tables.role_actions!.length = 0
    const before = structuredClone(fake.tables)
    login('sem')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(fake.writes).toHaveLength(0)
    expect(fake.tables).toEqual(before)
  })

  it('role só com um código irmão -> 403', async () => {
    fake = seed()
    grantOnly(c.sibling)
    expect(c.sibling).not.toBe(c.code)
    login('com')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(fake.writes).toHaveLength(0)
  })

  it('role com o código -> passa do guard (resultado do handler, não 403)', async () => {
    fake = seed()
    grantOnly(c.code)
    login('com')
    const res = await run(c)
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(c.status)
    if (c.message) expect(res.error?.message ?? res.error?.statusMessage).toBe(c.message)
  })

  it.each(['admin', 'owner'] as const)('%s passa sem concessão em role_actions (mesmo resultado)', async (persona) => {
    fake = seed()
    fake.tables.role_actions!.length = 0
    login(persona)
    const res = await run(c)
    expect(res.status).toBe(c.status)
    if (c.message) expect(res.error?.message ?? res.error?.statusMessage).toBe(c.message)
  })
})
