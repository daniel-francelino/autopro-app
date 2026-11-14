// L4 / F4 — pagar e desfazer, conferindo o ESTADO FINAL (saldo, extrato, transações), não só o HTTP.
// Handlers reais + banco em memória (roda no projeto `unit`, sem Docker). Os mesmos fluxos contra
// Postgres real ficam para tests/db quando o Supabase local estiver configurado (KF-00).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { seedOrganizations } from '../../support/organizations-fixture'

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
const PROCESS = 'server/api/service-orders/[id]/process-payment.post.ts'
const UNDO = 'server/api/service-orders/[id]/payment.delete.ts'

beforeEach(() => {
  fake = createFakeSupabase({
    organizations: seedOrganizations('proportional'),
    user_profiles: [{ id: 'p1', user_id: 'u1', organization_id: 'org-a', role_id: 'r', is_owner: false, is_active: true, employee_id: null }],
    // role r com orders.pay (process-payment) e orders.cancel (payment.delete, financial-transactions/*.delete): guards da Fase 6
    roles: [{ id: 'r', name: 'operador', is_system_role: false }],
    actions: [
      { id: 'act-op', code: 'orders.pay', deleted_at: null },
      { id: 'act-oc', code: 'orders.cancel', deleted_at: null }
    ],
    role_actions: [
      { role_id: 'r', action_id: 'act-op', is_granted: true },
      { role_id: 'r', action_id: 'act-oc', is_granted: true }
    ],
    service_orders: [{ id: 'o1', organization_id: 'org-a', number: 'OS1', status: 'completed', total_amount: 300, payment_status: 'pending', deleted_at: null }],
    service_order_installments: [],
    bank_accounts: [{ id: 'acc', organization_id: 'org-a', current_balance: 1000 }],
    bank_account_statements: [],
    financial_transactions: [],
    financial_categories: [],
    employee_financial_records: []
  })
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@a.com' } }, error: null })
})

const balance = () => fake.tables.bank_accounts![0]!.current_balance
const activeTx = () => fake.tables.financial_transactions!.filter(t => !t.deleted_at)
const pay = (installments: unknown[]) =>
  callHandler(PROCESS, fakeEvent({ method: 'POST', cookies, params: { id: 'o1' }, body: { paymentMethod: 'pix', bankAccountId: 'acc', installments } }))
const undo = () => callHandler(UNDO, fakeEvent({ method: 'DELETE', cookies, params: { id: 'o1' } }))

describe('F4: undo payment', () => {
  it('paid in full: balance returns to initial, statement disappears, transactions become soft-deleted', async () => {
    await pay([{ amount: 300, status: 'paid' }])
    expect(balance()).toBe(1300)

    const r = await undo()
    expect(r.status).toBe(200)
    expect(balance()).toBe(1000)
    expect(fake.tables.bank_account_statements).toHaveLength(0)
    expect(activeTx()).toHaveLength(0)
    expect(fake.tables.financial_transactions!.length).toBeGreaterThan(0) // nunca hard delete
    expect(fake.tables.service_order_installments).toHaveLength(0)
    expect(fake.tables.service_orders![0]!.payment_status).toBe('pending')
  })

  // KF-19: cada extrato restaura o próprio previous_balance; com várias parcelas na mesma conta,
  // vence o último processado e o saldo final fica errado.
  it('3 installments paid in the same account: undo restores the balance to the initial value', async () => {
    await pay([{ amount: 100, status: 'paid' }, { amount: 100, status: 'paid' }, { amount: 100, status: 'paid' }])
    expect(balance()).toBe(1300)

    await undo()
    expect(balance()).toBe(1000)
  })

  it('invariant after paying: sum of the statement == balance change == sum of paid transactions', async () => {
    await pay([{ amount: 100, status: 'paid' }, { amount: 200, status: 'paid' }])
    const statements = fake.tables.bank_account_statements!.reduce((s, x) => s + x.amount, 0)
    const paid = activeTx().filter(t => t.status === 'paid').reduce((s, t) => s + t.amount, 0)
    expect(statements).toBe(300)
    expect(balance() - 1000).toBe(statements)
    expect(paid).toBe(statements)
  })

  it('commission already paid blocks undo (409) and does not touch the balance', async () => {
    await pay([{ amount: 300, status: 'paid' }])
    fake.tables.employee_financial_records!.push({ id: 'c', organization_id: 'org-a', service_order_id: 'o1', record_type: 'commission', status: 'paid', amount: 30 })
    expect((await undo()).status).toBe(409)
    expect(balance()).toBe(1300)
  })

  it('M7: user from another organization cannot undo a payment of another organization', async () => {
    await pay([{ amount: 300, status: 'paid' }])
    fake.tables.user_profiles!.push({ id: 'p2', user_id: 'u2', organization_id: 'org-b', role_id: 'r', is_owner: false, is_active: true, employee_id: null })
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u2', email: 'b@b.com' } }, error: null })
    expect((await undo()).status).toBe(404)
    expect(balance()).toBe(1300)
  })

  it('nonexistent OS → 404', async () => {
    const r = await callHandler(UNDO, fakeEvent({ method: 'DELETE', cookies, params: { id: 'nao-existe' } }))
    expect(r.status).toBe(404)
  })
})
