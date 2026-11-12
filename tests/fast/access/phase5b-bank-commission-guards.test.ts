// Fase 5 (metade B) do plano de acesso: contas bancárias e pagamento/exclusão de comissão individual.
// Para cada rota: (i) sem o código -> 403 e nenhuma escrita; (ii) com outro código -> 403;
// (iii) com o código -> sucesso; (iv) admin e owner (role_actions vazio) -> sucesso. Usa o requireOrgPermission real.
// A lista GET de contas (usada pelas telas de OS) continua só com organização (D1).
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
  /** status esperado de quem passa no guarda (200 por padrão) */
  okStatus?: number
}

const TABLES = {
  bank_accounts: [{ id: 'ba1', organization_id: 'org-a', account_name: 'Conta', account_type: 'checking', current_balance: 1000, initial_balance: 0, is_active: true, deleted_at: null }],
  employee_financial_records: [{ id: 'ef1', organization_id: 'org-a', employee_id: 'e1', amount: 100, status: 'pending', description: 'Comissão', deleted_at: null }],
  financial_categories: [{ id: 'cat1', organization_id: 'org-a', name: 'Salários', type: 'expense', deleted_at: null }],
  financial_transactions: [],
  bank_account_statements: []
}

const CASES: Case[] = [
  { name: 'bank-accounts POST', file: api('bank-accounts/index.post.ts'), method: 'POST', body: { account_name: 'Nova', account_type: 'checking' }, code: 'bank_accounts.create' },
  { name: 'bank-accounts PUT', file: api('bank-accounts/[id].put.ts'), method: 'PUT', params: { id: 'ba1' }, body: { account_name: 'Outra', current_balance: 5 }, code: 'bank_accounts.update' },
  { name: 'bank-accounts DELETE', file: api('bank-accounts/[id].delete.ts'), method: 'DELETE', params: { id: 'ba1' }, code: 'bank_accounts.delete' },
  { name: 'reports/commissions pay POST', file: api('reports/commissions/[id]/pay.post.ts'), method: 'POST', params: { id: 'ef1' }, body: { bankAccountId: 'ba1' }, code: 'financial.update' },
  { name: 'reports/commissions DELETE', file: api('reports/commissions/[id].delete.ts'), method: 'DELETE', params: { id: 'ef1' }, code: 'financial.delete' }
]

function login(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

beforeEach(() => {
  auth.refreshSession.mockReset()
})

const run = (c: Case) => callHandler(c.file, fakeEvent({ method: c.method ?? 'GET', cookies, params: c.params, body: c.body }))

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

  it('role com outro código -> 403 e nenhuma escrita', async () => {
    fake = createFakeSupabase(guardSeed(['bonuses.read', c.code], { ...TABLES, role_actions: [] }))
    // r-com só recebe bonuses.read (act-0)
    fake.tables.role_actions!.push({ role_id: 'r-com', action_id: 'act-0', is_granted: true })
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

describe('leituras que continuam só com organização (D1)', () => {
  it('GET bank-accounts: role sem nenhuma concessão -> 200', async () => {
    fake = createFakeSupabase(guardSeed([], TABLES))
    login('sem')
    const res = await callHandler(api('bank-accounts/index.get.ts'), fakeEvent({ cookies }))
    expect(res.status).toBe(200)
  })
})
