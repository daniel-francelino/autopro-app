// Fase 3 do plano de acesso (configuração): guardas por código nas rotas de maquininhas, impostos, autorização de compras,
// organização/logo, usuários e roles. Para cada rota: (i) sem o código -> 403 e nenhuma escrita;
// (ii) com o código -> sucesso; (iii) admin e owner -> sucesso. Os GET de lista continuam só com organização (D1/D14).
// Plano: docs/engineering/access-control-rollout-plan.md, seção 8, Fase 3.
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
  payment_terminals: [{ id: 'pt1', organization_id: 'org-a', terminal_name: 'Stone', is_active: true, rates: null, deleted_at: null }],
  taxes: [{ id: 't1', organization_id: 'org-a', name: 'ISS', type: 'municipal', rate: 5, deleted_at: null }],
  purchase_requests: [{ id: 'rq-w', organization_id: 'org-a', status: 'waiting', request_number: 'SOL-1', items: [], deleted_at: null }],
  organizations: [{ id: 'org-a', name: 'Oficina A' }],
  employees: [{ id: 'e1', organization_id: 'org-a', name: 'Ana', email: null, deleted_at: null }],
  subscriptions: []
}

const CASES: Case[] = [
  { name: 'payment-terminals POST', file: api('payment-terminals/index.post.ts'), method: 'POST', body: { terminal_name: 'Nova' }, code: 'payment_machines.update' },
  { name: 'payment-terminals PUT', file: api('payment-terminals/[id].put.ts'), method: 'PUT', params: { id: 'pt1' }, body: { is_active: false }, code: 'payment_machines.update' },
  { name: 'payment-terminals DELETE', file: api('payment-terminals/[id].delete.ts'), method: 'DELETE', params: { id: 'pt1' }, code: 'payment_machines.update' },
  { name: 'taxes POST', file: api('taxes/index.post.ts'), method: 'POST', body: { name: 'PIS', type: 'federal', rate: 1 }, code: 'taxes.update' },
  { name: 'taxes PUT', file: api('taxes/[id].put.ts'), method: 'PUT', params: { id: 't1' }, body: { rate: 6 }, code: 'taxes.update' },
  { name: 'taxes DELETE', file: api('taxes/[id].delete.ts'), method: 'DELETE', params: { id: 't1' }, code: 'taxes.update' },
  { name: 'purchase-requests authorize', file: api('purchase-requests/[id]/authorize.post.ts'), method: 'POST', params: { id: 'rq-w' }, code: 'authorizations.approve' },
  { name: 'purchase-requests reject', file: api('purchase-requests/[id]/reject.post.ts'), method: 'POST', params: { id: 'rq-w' }, body: { rejection_reason: 'x' }, code: 'authorizations.approve' },
  { name: 'organizations PUT', file: api('organizations/index.put.ts'), method: 'PUT', body: { name: 'Nova razão' }, code: 'settings.update' },
  // O harness não tem multipart: quem passa no guarda chega ao 400 "Arquivo não fornecido" (o upload em si não é objeto deste teste).
  { name: 'organizations/logo POST', file: api('organizations/logo.post.ts'), method: 'POST', code: 'settings.update', okStatus: 400 },
  { name: 'users/employee-auth-status', file: api('users/employee-auth-status.post.ts'), method: 'POST', body: { employee_id: 'e1' }, code: 'employees.read' },
  { name: 'users/list-organization', file: api('users/list-organization.post.ts'), method: 'POST', code: 'members.view' },
  { name: 'roles/:id GET', file: api('roles/[id].get.ts'), params: { id: 'r-sem' }, code: 'roles.read' },
  { name: 'roles/:id/actions GET', file: api('roles/[id]/actions.get.ts'), params: { id: 'r-sem' }, code: 'roles.read' }
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

  it('role com outro código (não o exigido) -> 403', async () => {
    fake = createFakeSupabase(guardSeed(['bonuses.read', c.code], { ...TABLES, role_actions: [] }))
    // r-com só recebe bonuses.read
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

describe('leituras que continuam só com organização (D1, D14)', () => {
  const LISTS = [
    { name: 'GET payment-terminals', file: api('payment-terminals/index.get.ts') },
    { name: 'GET taxes', file: api('taxes/index.get.ts') },
    { name: 'GET roles (lista)', file: api('roles/index.get.ts') },
    { name: 'GET organizations', file: api('organizations/index.get.ts') }
  ]
  it.each(LISTS)('$name: role sem nenhuma concessão -> 200', async ({ file }) => {
    fake = createFakeSupabase(guardSeed([], TABLES))
    login('sem')
    const res = await callHandler(file, fakeEvent({ cookies }))
    expect(res.status).toBe(200)
  })
})
