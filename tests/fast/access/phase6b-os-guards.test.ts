// Fase 6 (metade B) do plano de acesso: OS fora do recebimento de dinheiro.
// Para cada rota: (i) sem o código -> 403 e nenhuma escrita; (ii) com outro código irmão -> 403;
// (iii) com o código -> sucesso; (iv) admin e owner (role_actions vazio) -> sucesso. Usa o requireOrgPermission real.
// POST service-orders serve criar e editar (V9): sem orderId exige orders.create, com orderId exige orders.update.
// Plano: docs/engineering/access-control-rollout-plan.md, seção 8, Fase 6.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { guardSeed, USERS, type Persona } from '../../support/phase3-guard-fixture'
import { seedOrganizations } from '../../support/organizations-fixture'

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
  method: string
  params?: Record<string, string>
  body?: unknown
  code: string
  /** outro código irmão que NÃO basta para a rota */
  sibling: string
  /** cancelar recusa OS com lançamento/parcela (409): usa tabelas sem eles */
  clean?: boolean
}

const TABLES = {
  organizations: seedOrganizations('full'),
  service_orders: [{ id: 'o1', organization_id: 'org-a', number: 'OS1', status: 'open', payment_status: 'pending', total_amount: 100, discount: 0, total_taxes_amount: 0, items: [], responsible_employees: [], deleted_at: null }],
  service_order_installments: [{ id: 'i1', organization_id: 'org-a', service_order_id: 'o1', status: 'pending', amount: 50, due_date: '2026-12-01', financial_transaction_id: null, deleted_at: null }],
  financial_transactions: [{ id: 't1', organization_id: 'org-a', service_order_id: 'o1', type: 'income', status: 'pending', amount: 10, deleted_at: null }],
  employee_financial_records: [],
  bank_account_statements: [],
  bank_accounts: [],
  appointments: [],
  employees: []
}

const CASES: Case[] = [
  { name: 'service-orders POST (criar)', file: api('service-orders/index.post.ts'), method: 'POST', body: { orderData: { notes: 'nova', number: 'OS-NOVA' } }, code: 'orders.create', sibling: 'orders.update' },
  { name: 'service-orders POST (editar, com orderId)', file: api('service-orders/index.post.ts'), method: 'POST', body: { orderId: 'o1', orderData: { notes: 'editada' } }, code: 'orders.update', sibling: 'orders.create' },
  { name: 'service-orders/:id/cancel POST', file: api('service-orders/[id]/cancel.post.ts'), method: 'POST', params: { id: 'o1' }, code: 'orders.cancel', sibling: 'orders.update', clean: true },
  { name: 'service-orders/:id DELETE', file: api('service-orders/[id].delete.ts'), method: 'DELETE', params: { id: 'o1' }, code: 'orders.delete', sibling: 'orders.cancel' },
  { name: 'service-orders/:id/payment DELETE (estorno)', file: api('service-orders/[id]/payment.delete.ts'), method: 'DELETE', params: { id: 'o1' }, code: 'orders.cancel', sibling: 'orders.update' },
  { name: 'service-orders/:id/financial-transactions/:tid DELETE (desfazer recebimento)', file: api('service-orders/[id]/financial-transactions/[transactionId].delete.ts'), method: 'DELETE', params: { id: 'o1', transactionId: 't1' }, code: 'orders.cancel', sibling: 'orders.update' },
  { name: 'service-orders/:id/installments/:iid PATCH', file: api('service-orders/[id]/installments/[installmentId].patch.ts'), method: 'PATCH', params: { id: 'o1', installmentId: 'i1' }, body: { amount: 60 }, code: 'orders.update', sibling: 'orders.create' },
  { name: 'service-orders/:id/installments/:iid DELETE', file: api('service-orders/[id]/installments/[installmentId].delete.ts'), method: 'DELETE', params: { id: 'o1', installmentId: 'i1' }, body: { reason: 'erro' }, code: 'financial.delete', sibling: 'orders.delete' },
  { name: 'service-orders/:id/generate-commissions POST', file: api('service-orders/[id]/generate-commissions.post.ts'), method: 'POST', params: { id: 'o1' }, body: {}, code: 'orders.update', sibling: 'orders.create' }
]

function login(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

beforeEach(() => {
  auth.refreshSession.mockReset()
})

const run = (c: Case) => callHandler(c.file, fakeEvent({ method: c.method, cookies, params: c.params, body: c.body }))
const tables = (clean = false) => ({ ...structuredClone(TABLES), ...(clean ? { financial_transactions: [], service_order_installments: [] } : {}) })

describe.each(CASES)('$name exige $code', (c) => {
  it('role sem o código -> 403 e nenhuma escrita', async () => {
    fake = createFakeSupabase(guardSeed([c.code], tables(c.clean)))
    const before = structuredClone(fake.tables)
    login('sem')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(fake.writes).toHaveLength(0)
    expect(fake.tables).toEqual(before)
  })

  it('role só com outro código irmão -> 403 e nenhuma escrita', async () => {
    // catálogo com os dois códigos, mas r-com recebe só o irmão (act-1)
    fake = createFakeSupabase(guardSeed([c.code, c.sibling], tables(c.clean)))
    fake.tables.role_actions!.length = 0
    fake.tables.role_actions!.push({ role_id: 'r-com', action_id: 'act-1', is_granted: true })
    const before = structuredClone(fake.tables)
    login('com')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(fake.writes).toHaveLength(0)
    expect(fake.tables).toEqual(before)
  })

  it('role com o código -> sucesso', async () => {
    fake = createFakeSupabase(guardSeed([c.code], tables(c.clean)))
    login('com')
    const res = await run(c)
    expect(res.status).toBe(200)
  })

  it.each(['admin', 'owner'] as const)('%s passa sem concessão em role_actions', async (persona) => {
    fake = createFakeSupabase(guardSeed([c.code], tables(c.clean)))
    fake.tables.role_actions!.length = 0
    login(persona)
    const res = await run(c)
    expect(res.status).toBe(200)
  })
})

describe('D5: cancelar e excluir OS gravam na auditoria o que foi removido', () => {
  type Audit = { changes?: { extra?: { removed?: Record<string, Array<{ id: string, amount?: number }>> } } }
  const withCommission = () => ({
    ...tables(),
    employee_financial_records: [{ id: 'c1', organization_id: 'org-a', service_order_id: 'o1', record_type: 'commission', employee_id: 'e1', amount: 12.5, status: 'pending', financial_transaction_id: null }]
  })

  it('cancel: comissão removida aparece no contexto de auditoria', async () => {
    fake = createFakeSupabase(guardSeed(['orders.cancel'], { ...withCommission(), financial_transactions: [], service_order_installments: [] }))
    login('com')
    const event = fakeEvent({ method: 'POST', cookies, params: { id: 'o1' } })
    const ctx: { audit: Audit } = { audit: {} }
    Object.assign(event, { context: ctx })
    const res = await callHandler(api('service-orders/[id]/cancel.post.ts'), event)
    expect(res.status).toBe(200)
    const removed = ctx.audit.changes?.extra?.removed
    expect(removed?.commissions).toEqual([expect.objectContaining({ id: 'c1', amount: 12.5 })])
  })

  it('delete: comissão, parcela e lançamento removidos aparecem no contexto de auditoria', async () => {
    fake = createFakeSupabase(guardSeed(['orders.delete'], withCommission()))
    login('com')
    const event = fakeEvent({ method: 'DELETE', cookies, params: { id: 'o1' } })
    const ctx: { audit: Audit } = { audit: {} }
    Object.assign(event, { context: ctx })
    const res = await callHandler(api('service-orders/[id].delete.ts'), event)
    expect(res.status).toBe(200)
    const removed = ctx.audit.changes?.extra?.removed
    expect(removed?.commissions?.map(r => r.id)).toEqual(['c1'])
    expect(removed?.installments?.map(r => r.id)).toEqual(['i1'])
    expect(removed?.financial_transactions?.map(r => r.id)).toEqual(['t1'])
  })
})
