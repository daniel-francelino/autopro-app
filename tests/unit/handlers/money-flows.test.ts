// L3-lite — fluxo de dinheiro de OS (F2/F3/F4 do plano) nos handlers reais com banco em memória.
// Limitação: gatilhos/RPC/índices do Postgres NÃO existem aqui; o que depende deles fica para o
// projeto `api` (Supabase local). Ver docs/testing/known-failures.md.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../helpers/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fake-supabase'

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
const PAY = 'server/api/financial/[id]/pay.post.ts'

function seed() {
  fake = createFakeSupabase({
    user_profiles: [
      { id: 'p1', user_id: 'u1', organization_id: 'org-a', role_id: 'r', is_owner: false, is_active: true, employee_id: null },
      { id: 'p2', user_id: 'u2', organization_id: 'org-b', role_id: 'r', is_owner: false, is_active: true, employee_id: null }
    ],
    service_orders: [
      { id: 'o1', organization_id: 'org-a', number: 'OS1', status: 'completed', total_amount: 300, payment_status: 'pending', deleted_at: null },
      { id: 'o-open', organization_id: 'org-a', number: 'OS2', status: 'open', total_amount: 100, payment_status: 'pending', deleted_at: null },
      { id: 'o-b', organization_id: 'org-b', number: 'OS9', status: 'completed', total_amount: 500, payment_status: 'pending', deleted_at: null }
    ],
    service_order_installments: [],
    bank_accounts: [
      { id: 'acc-a', organization_id: 'org-a', current_balance: 1000 },
      { id: 'acc-b', organization_id: 'org-b', current_balance: 50 }
    ],
    bank_account_statements: [],
    financial_transactions: [
      { id: 'ft-a', organization_id: 'org-a', status: 'pending', type: 'expense', amount: 80, deleted_at: null },
      { id: 'ft-b', organization_id: 'org-b', status: 'pending', type: 'expense', amount: 80, deleted_at: null }
    ],
    financial_categories: [],
    employee_financial_records: []
  })
}

const processPayment = (orderId: string, body: unknown) =>
  callHandler(PROCESS, fakeEvent({ method: 'POST', cookies, params: { id: orderId }, body }))

beforeEach(() => {
  seed()
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@a.com' } }, error: null })
  auth.refreshSession.mockReset()
})

const income = () => fake.tables.financial_transactions!.filter(t => t.type === 'income')
const balance = (id: string) => fake.tables.bank_accounts!.find(a => a.id === id)!.current_balance
const order = (id: string) => fake.tables.service_orders!.find(o => o.id === id)!

describe('F2: OS paid in full', () => {
  const body = { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 300, status: 'paid' }] }

  it('settles the OS: 1 income transaction, balance +total and 1 statement line with before/after', async () => {
    const r = await processPayment('o1', body)
    expect(r.status).toBe(200)
    expect(income()).toHaveLength(1)
    expect(income()[0]).toMatchObject({ amount: 300, status: 'paid', organization_id: 'org-a', service_order_id: 'o1' })
    expect(balance('acc-a')).toBe(1300)
    expect(fake.tables.bank_account_statements).toHaveLength(1)
    expect(fake.tables.bank_account_statements![0]).toMatchObject({ previous_balance: 1000, balance_after: 1300, amount: 300 })
    expect(order('o1').payment_status).toBe('paid')
  })
  it('repeating process-payment → 409 and the balance does not change', async () => {
    await processPayment('o1', body)
    const again = await processPayment('o1', body)
    expect(again.status).toBe(409)
    expect(balance('acc-a')).toBe(1300)
    expect(income()).toHaveLength(1)
  })
  it('invariant: sum of the statement == balance change', async () => {
    await processPayment('o1', body)
    const sum = fake.tables.bank_account_statements!.reduce((s, x) => s + x.amount, 0)
    expect(balance('acc-a') - 1000).toBe(sum)
  })
})

describe('F3: installment OS', () => {
  it('3 installments with the 1st paid → OS partial; only the paid one moves the balance', async () => {
    const r = await processPayment('o1', {
      paymentMethod: 'pix',
      bankAccountId: 'acc-a',
      installments: [{ amount: 100, status: 'paid' }, { amount: 100 }, { amount: 100 }]
    })
    expect(r.status).toBe(200)
    expect(fake.tables.service_order_installments).toHaveLength(3)
    expect(fake.tables.service_order_installments!.map(i => i.installment_number)).toEqual([1, 2, 3])
    expect(income()).toHaveLength(1)
    expect(balance('acc-a')).toBe(1100)
    expect(order('o1').payment_status).toBe('partial')
  })
  it('server refuses installment sum different from total (400) without storing anything', async () => {
    const r = await processPayment('o1', { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 100, status: 'paid' }, { amount: 100 }] })
    expect(r.status).toBe(400)
    expect(fake.tables.service_order_installments).toHaveLength(0)
    expect(balance('acc-a')).toBe(1000)
  })
  it('no payment lines → 400', async () => {
    expect((await processPayment('o1', { paymentMethod: 'pix', installments: [] })).status).toBe(400)
  })
  it('down payment greater than OS total → 409', async () => {
    fake.tables.service_order_installments!.push({ id: 'dp', organization_id: 'org-a', service_order_id: 'o1', kind: 'down_payment', amount: 400, status: 'paid', deleted_at: null })
    expect((await processPayment('o1', { installments: [{ amount: 1 }] })).status).toBe(409)
  })
  it('down payment already covers the total → only reconciles the status', async () => {
    fake.tables.service_order_installments!.push({ id: 'dp', organization_id: 'org-a', service_order_id: 'o1', kind: 'down_payment', amount: 300, status: 'paid', deleted_at: null })
    const r = await processPayment('o1', {})
    expect(r.status).toBe(200)
    expect(order('o1').payment_status).toBe('paid')
    expect(income()).toHaveLength(0)
  })
})

describe('process-payment: validations and isolation', () => {
  const body = { paymentMethod: 'pix', bankAccountId: 'acc-a', installments: [{ amount: 300, status: 'paid' }] }

  it('only completed OS receives payment (409)', async () => {
    expect((await processPayment('o-open', { ...body, installments: [{ amount: 100, status: 'paid' }] })).status).toBe(409)
  })
  it('nonexistent OS → 404', async () => {
    expect((await processPayment('nao-existe', body)).status).toBe(404)
  })
  it('M7: org A user does not pay org B OS (404) and nothing changes', async () => {
    const r = await processPayment('o-b', { ...body, bankAccountId: 'acc-b', installments: [{ amount: 500, status: 'paid' }] })
    expect(r.status).toBe(404)
    expect(balance('acc-b')).toBe(50)
    expect(order('o-b').payment_status).toBe('pending')
  })
  it('M7: bank account from ANOTHER organization is refused and rolled back', async () => {
    const r = await processPayment('o1', { ...body, bankAccountId: 'acc-b' })
    expect(r.status).toBe(500)
    expect(balance('acc-b')).toBe(50)
    expect(income().every(t => t.deleted_at)).toBe(true)
  })
  it('M8: organization_id in the body is ignored', async () => {
    await processPayment('o1', { ...body, organization_id: 'org-b', organizationId: 'org-b' })
    expect(income().every(t => t.organization_id === 'org-a')).toBe(true)
    expect(fake.tables.service_order_installments!.every(i => i.organization_id === 'org-a')).toBe(true)
  })
  it('M1: no session → 401', async () => {
    const r = await callHandler(PROCESS, fakeEvent({ method: 'POST', params: { id: 'o1' }, body }))
    expect(r.status).toBe(401)
  })
  it.fails('M4: employee without OS permission should not receive payment (R2)', async () => {
    // Hoje o handler só usa resolveOrganizationId; não chama requireOrgPermission.
    fake.tables.user_profiles![0]!.role_id = null
    fake.tables.user_profiles![0]!.is_owner = false
    const r = await processPayment('o1', body)
    expect(r.status).toBe(403)
  })
})

describe('financial/:id/pay', () => {
  const pay = (id: string) => callHandler(PAY, fakeEvent({ method: 'POST', cookies, params: { id } }))

  it('marks as paid', async () => {
    const r = await pay('ft-a')
    expect(r.status).toBe(200)
    expect(fake.tables.financial_transactions!.find(t => t.id === 'ft-a')!.status).toBe('paid')
  })
  it('paying twice is refused', async () => {
    await pay('ft-a')
    expect((await pay('ft-a')).status).toBe(400)
  })
  it('M7: entry from another organization → 404 and untouched', async () => {
    expect((await pay('ft-b')).status).toBe(404)
    expect(fake.tables.financial_transactions!.find(t => t.id === 'ft-b')!.status).toBe('pending')
  })
  it('M10: deleted entry → 404', async () => {
    fake.tables.financial_transactions!.find(t => t.id === 'ft-a')!.deleted_at = '2026-01-01'
    expect((await pay('ft-a')).status).toBe(404)
  })
  // KF-18: marcar como pago não toca no saldo nem no extrato da conta bancária.
  it('paying an entry with a bank account moves the balance and creates a statement', async () => {
    const t = fake.tables.financial_transactions!.find(x => x.id === 'ft-a')!
    t.bank_account_id = 'acc-a'
    await pay('ft-a')
    expect(balance('acc-a')).toBe(920)
    expect(fake.tables.bank_account_statements).toHaveLength(1)
  })
})
