// Fase 4 (metade A) do plano de acesso: escrita em compras, devoluções, solicitações (criar/editar/excluir), fornecedores,
// agendamentos e funcionários. Para cada rota: (i) sem o código -> 403 e nenhuma escrita; (ii) com outro código -> 403;
// (iii) com o código -> sucesso; (iv) admin e owner (role_actions vazio) -> sucesso. Usa o requireOrgPermission real.
// Plano: docs/engineering/access-control-rollout-plan.md, seção 8, Fase 4.
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

type Case = { name: string, file: string, method: string, params?: Record<string, string>, body?: unknown, code: string }

const TABLES = {
  purchases: [{ id: 'pu1', organization_id: 'org-a', supplier_id: 'sup1', bank_account_id: 'ba1', purchase_date: '2026-03-10', total_amount: 300, payment_status: 'pending', items: null, deleted_at: null }],
  purchase_returns: [{ id: 'pr1', organization_id: 'org-a', purchase_id: 'pu1', supplier_id: 'sup1', return_date: '2026-03-12', reason: 'warranty', status: 'pending', total_returned_amount: 10, returned_items: [], deleted_at: null }],
  purchase_requests: [{ id: 'rq1', organization_id: 'org-a', status: 'waiting', request_number: 'SOL-00001', supplier_id: 'sup1', items: [{ description: 'Filtro', quantity: 1, estimated_total_price: 10 }], deleted_at: null }],
  suppliers: [{ id: 'sup1', organization_id: 'org-a', name: 'Forn', person_type: 'pj', phone: '1', is_active: true, deleted_at: null }],
  appointments: [{ id: 'ap1', organization_id: 'org-a', client_id: 'c1', vehicle_id: 'v1', appointment_date: '2026-03-10', time: '10:00', service_type: 'Revisão', status: 'scheduled', deleted_at: null }],
  employees: [{ id: 'e1', organization_id: 'org-a', name: 'Ana', person_type: 'pf', tax_id: '1', phone: '1', email: null, termination_date: null, deleted_at: null }],
  subscriptions: []
}

const CASES: Case[] = [
  { name: 'purchases POST', file: api('purchases/index.post.ts'), method: 'POST', body: { supplier_id: 'sup1', bank_account_id: 'ba1', purchase_date: '2026-04-01', total_amount: 10 }, code: 'purchases.create' },
  { name: 'purchases PUT', file: api('purchases/[id].put.ts'), method: 'PUT', params: { id: 'pu1' }, body: { notes: 'x' }, code: 'purchases.update' },
  { name: 'purchases DELETE', file: api('purchases/[id].delete.ts'), method: 'DELETE', params: { id: 'pu1' }, code: 'purchases.delete' },
  { name: 'purchases/:id/pay POST', file: api('purchases/[id]/pay.post.ts'), method: 'POST', params: { id: 'pu1' }, body: {}, code: 'purchases.update' },
  { name: 'purchase-returns POST', file: api('purchase-returns/index.post.ts'), method: 'POST', body: { purchase_id: 'pu1', supplier_id: 'sup1', return_date: '2026-04-01', reason: 'warranty', total_returned_amount: 10, returned_items: [{ description: 'P', quantity: 1, unit_price: 10 }] }, code: 'returns.create' },
  { name: 'purchase-returns PUT', file: api('purchase-returns/[id].put.ts'), method: 'PUT', params: { id: 'pr1' }, body: { notes: 'x' }, code: 'returns.update' },
  { name: 'purchase-returns DELETE', file: api('purchase-returns/[id].delete.ts'), method: 'DELETE', params: { id: 'pr1' }, code: 'returns.delete' },
  { name: 'purchase-requests POST', file: api('purchase-requests/index.post.ts'), method: 'POST', body: { supplier_id: 'sup1', items: [{ description: 'Filtro', quantity: 1, estimated_total_price: 10 }] }, code: 'authorizations.create' },
  { name: 'purchase-requests PUT', file: api('purchase-requests/[id].put.ts'), method: 'PUT', params: { id: 'rq1' }, body: { notes: 'x' }, code: 'authorizations.update' },
  { name: 'purchase-requests DELETE', file: api('purchase-requests/[id].delete.ts'), method: 'DELETE', params: { id: 'rq1' }, code: 'authorizations.delete' },
  { name: 'suppliers POST', file: api('suppliers/index.post.ts'), method: 'POST', body: { name: 'Novo', person_type: 'pj', phone: '11' }, code: 'suppliers.create' },
  { name: 'suppliers PUT', file: api('suppliers/[id].put.ts'), method: 'PUT', params: { id: 'sup1' }, body: { name: 'Renomeado' }, code: 'suppliers.update' },
  { name: 'suppliers DELETE', file: api('suppliers/[id].delete.ts'), method: 'DELETE', params: { id: 'sup1' }, code: 'suppliers.delete' },
  { name: 'suppliers/import POST', file: api('suppliers/import.post.ts'), method: 'POST', body: { rows: [{ name: 'Imp', phone: '1' }] }, code: 'suppliers.create' },
  { name: 'appointments POST', file: api('appointments/index.post.ts'), method: 'POST', body: { client_id: 'c1', vehicle_id: 'v1', appointment_date: '2026-04-01', time: '09:00', service_type: 'Revisão' }, code: 'appointments.create' },
  { name: 'appointments PUT', file: api('appointments/[id].put.ts'), method: 'PUT', params: { id: 'ap1' }, body: { notes: 'x' }, code: 'appointments.update' },
  { name: 'appointments DELETE', file: api('appointments/[id].delete.ts'), method: 'DELETE', params: { id: 'ap1' }, code: 'appointments.delete' },
  { name: 'employees POST', file: api('employees/index.post.ts'), method: 'POST', body: { name: 'Novo', person_type: 'pf', tax_id: '2', phone: '11' }, code: 'employees.create' },
  { name: 'employees PUT', file: api('employees/[id].put.ts'), method: 'PUT', params: { id: 'e1' }, body: { phone: '22' }, code: 'employees.update' },
  { name: 'employees DELETE', file: api('employees/[id].delete.ts'), method: 'DELETE', params: { id: 'e1' }, code: 'employees.delete' }
]

function login(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

beforeEach(() => {
  auth.refreshSession.mockReset()
})

const run = (c: Case) => callHandler(c.file, fakeEvent({ method: c.method, cookies, params: c.params, body: c.body }))

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
    fake.tables.role_actions!.push({ role_id: 'r-com', action_id: 'act-0', is_granted: true })
    const before = structuredClone(fake.tables)
    login('com')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(fake.writes).toHaveLength(0)
    expect(fake.tables).toEqual(before)
  })

  it('role com o código -> sucesso', async () => {
    fake = createFakeSupabase(guardSeed([c.code], TABLES))
    login('com')
    const res = await run(c)
    expect(res.status).toBe(200)
  })

  it.each(['admin', 'owner'] as const)('%s passa sem concessão em role_actions', async (persona) => {
    fake = createFakeSupabase(guardSeed([c.code], TABLES))
    fake.tables.role_actions!.length = 0
    login(persona)
    const res = await run(c)
    expect(res.status).toBe(200)
  })
})
