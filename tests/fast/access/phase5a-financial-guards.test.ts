// Fase 5 (metade A) do plano de acesso: escritas em server/api/financial/*.
// Para cada rota: (i) sem o código -> 403 e nenhuma escrita; (ii) com outro código -> 403;
// (iii) com o código -> sucesso; (iv) admin e owner (role_actions vazio) -> sucesso. Usa o requireOrgPermission real.
// Código por rota = o que a tela já checa para exibir o botão (R3). Divergências do plano: categorias criar/editar usam
// financial.update (V10) e extend-recurrence usa financial.create. pay-commissions-bulk: financial.update (D12; OS e relatório
// exigem o mesmo código). Ficam fora: export e GETs (Fase 7).
// Plano: docs/engineering/access-control-rollout-plan.md, seção 8, Fase 5.
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

type Case = {
  name: string
  file: string
  method?: string
  params?: Record<string, string>
  body?: unknown
  code: string
  okStatus?: number
}

const CODES = ['financial.create', 'financial.update', 'financial.delete']

const TABLES = {
  bank_accounts: [{ id: 'acc-a', organization_id: 'org-a', current_balance: 1000, is_active: true }],
  bank_account_statements: [],
  financial_categories: [
    { id: 'cat-a', organization_id: 'org-a', deleted_at: null, name: 'Aluguel', type: 'expense', is_default: false },
    { id: 'cat-b', organization_id: 'org-a', deleted_at: null, name: 'Energia', type: 'expense', is_default: false }
  ],
  financial_transactions: [
    { id: 'exp1', organization_id: 'org-a', deleted_at: null, type: 'expense', status: 'pending', amount: 80, due_date: '2026-03-10', description: 'Conta', bank_account_id: 'acc-a', recurrence: 'non_recurring' },
    { id: 'rec1', organization_id: 'org-a', deleted_at: null, type: 'expense', status: 'pending', amount: 50, due_date: '2026-03-10', description: 'Aluguel', category: 'Aluguel', category_id: 'cat-a', bank_account_id: null, recurrence: 'monthly', parent_recurrence_id: null },
    { id: 'rec2', organization_id: 'org-a', deleted_at: null, type: 'expense', status: 'pending', amount: 50, due_date: '2026-04-10', description: 'Aluguel', category: 'Aluguel', category_id: 'cat-a', bank_account_id: null, recurrence: 'monthly', parent_recurrence_id: 'rec1' }
  ],
  employee_financial_records: [
    { id: 'cm1', organization_id: 'org-a', deleted_at: null, employee_id: 'e1', record_type: 'commission', amount: 100, status: 'pending', reference_date: '2026-03-05' }
  ]
}

const CASES: Case[] = [
  { name: 'financial POST', file: api('financial/index.post.ts'), method: 'POST', body: { description: 'Novo', amount: 10, due_date: '2026-05-01', type: 'expense', category_id: 'cat-a' }, code: 'financial.create' },
  { name: 'financial/:id/extend-recurrence POST', file: api('financial/[id]/extend-recurrence.post.ts'), method: 'POST', params: { id: 'rec1' }, body: { additional_count: 2 }, code: 'financial.create' },
  { name: 'financial/:id PUT', file: api('financial/[id].put.ts'), method: 'PUT', params: { id: 'exp1' }, body: { notes: 'x' }, code: 'financial.update' },
  { name: 'financial/:id/pay POST', file: api('financial/[id]/pay.post.ts'), method: 'POST', params: { id: 'exp1' }, code: 'financial.update' },
  { name: 'financial/pay-entries-bulk POST', file: api('financial/pay-entries-bulk.post.ts'), method: 'POST', body: { entryIds: ['exp1'] }, code: 'financial.update' },
  { name: 'financial/pay-commissions-bulk POST', file: api('financial/pay-commissions-bulk.post.ts'), method: 'POST', body: { registroIds: ['cm1'] }, code: 'financial.update' },
  { name: 'financial/update-recurring POST', file: api('financial/update-recurring.post.ts'), method: 'POST', body: { originalEntryId: 'rec1', updateData: { amount: 60 } }, code: 'financial.update' },
  { name: 'financial/:id DELETE', file: api('financial/[id].delete.ts'), method: 'DELETE', params: { id: 'exp1' }, body: { reason: 'teste' }, code: 'financial.delete' },
  { name: 'financial/categories POST', file: api('financial/categories/index.post.ts'), method: 'POST', body: { name: 'Nova', type: 'expense' }, code: 'financial.update' },
  { name: 'financial/categories/:id PUT', file: api('financial/categories/[id].put.ts'), method: 'PUT', params: { id: 'cat-a' }, body: { name: 'Outra' }, code: 'financial.update' },
  { name: 'financial/categories/:id/migrate POST', file: api('financial/categories/[id]/migrate.post.ts'), method: 'POST', params: { id: 'cat-a' }, body: { target_category_id: 'cat-b' }, code: 'financial.update' },
  { name: 'financial/categories/:id DELETE', file: api('financial/categories/[id].delete.ts'), method: 'DELETE', params: { id: 'cat-b' }, code: 'financial.delete' }
]

function login(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

beforeEach(() => {
  auth.refreshSession.mockReset()
})

const run = (c: Case) => callHandler(c.file, fakeEvent({ method: c.method ?? 'GET', cookies, params: c.params, body: c.body }))
const otherCode = (c: Case) => CODES.find(x => x !== c.code)!

describe.each(CASES)('$name exige $code', (c) => {
  it('role sem o código -> 403 e nenhuma escrita', async () => {
    fake = createFakeSupabase(guardSeed([c.code], TABLES))
    const before = structuredClone(fake.tables)
    login('sem')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(fake.writes).toHaveLength(0)
    expect(fake.tables).toEqual(before)
  })

  it('role com outro código financeiro -> 403 e nenhuma escrita', async () => {
    // r-com recebe SOMENTE o outro código (act-1); o código exigido existe no catálogo (act-0) sem concessão
    fake = createFakeSupabase(guardSeed([c.code, otherCode(c)], TABLES))
    fake.tables.role_actions!.length = 0
    fake.tables.role_actions!.push({ role_id: 'r-com', action_id: 'act-1', is_granted: true })
    expect(fake.tables.role_actions!.some(r => r.role_id === 'r-com' && r.action_id === 'act-0')).toBe(false)
    login('com')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(fake.writes).toHaveLength(0)
  })

  it('role com o código -> sucesso', async () => {
    fake = createFakeSupabase(guardSeed([c.code], TABLES))
    login('com')
    const res = await run(c)
    expect(res.status).toBe(c.okStatus ?? 200)
  })

  it.each(['admin', 'owner'] as const)('%s passa sem concessão em role_actions', async (persona) => {
    fake = createFakeSupabase(guardSeed([c.code], TABLES))
    fake.tables.role_actions!.length = 0
    login(persona)
    const res = await run(c)
    expect(res.status).toBe(c.okStatus ?? 200)
  })
})
