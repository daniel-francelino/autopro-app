// OS — criar/editar (POST /api/service-orders) e o que a edição faz com pagamento e comissão.
// Cenários E-xx em docs/testing/financial-core-test-analysis.md.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))
vi.mock('../../../server/utils/employee-commission-plans', () => ({
  resolveEmployeeCommissionRulesForEmployees: vi.fn(async (_s: unknown, _o: string, ids: string[]) =>
    new Map(ids.map(id => [id, [{ id: 'r10', plan_id: 'p1', version_id: 'v1', name: '10%', commission_type: 'percentage', commission_amount: 10, commission_base: 'revenue', category_ids: [], is_default: true }]]))),
  resolveCommissionPlanRules: vi.fn(async () => []),
  fetchCommissionPlan: vi.fn(async () => null)
}))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const SAVE = 'server/api/service-orders/index.post.ts'
const PAY = 'server/api/service-orders/[id]/installments/[installmentId]/pay.post.ts'
const DEL_INSTALLMENT = 'server/api/service-orders/[id]/installments/[installmentId].delete.ts'

const item = (total: number) => ({ id: 'it1', description: 'Serviço', quantity: 1, unit_price: total, total_price: total, cost_price: 0 })

function seed(over: Record<string, unknown> = {}) {
  fake = createFakeSupabase({
    user_profiles: [
      { id: 'p1', user_id: 'u1', organization_id: 'org-a', role_id: 'r', is_owner: false, is_active: true, employee_id: null },
      { id: 'p2', user_id: 'u2', organization_id: 'org-b', role_id: 'r', is_owner: false, is_active: true, employee_id: null }
    ],
    service_orders: [
      {
        id: 'o1', organization_id: 'org-a', number: 'OS100', status: 'completed', entry_date: '2026-03-10', total_amount: 1000,
        discount: 0, total_taxes_amount: 0, payment_status: 'pending', deleted_at: null, commission_release_mode: null,
        commission_manual_adjustments_log: [], responsible_employees: [{ employee_id: 'e1' }], items: [item(1000)], ...over
      },
      { id: 'o-b', organization_id: 'org-b', number: '900', status: 'open', total_amount: 10, deleted_at: null }
    ],
    employees: [{ id: 'e1', organization_id: 'org-a', name: 'Ana', deleted_at: null }],
    service_order_installments: [],
    bank_accounts: [{ id: 'acc-a', organization_id: 'org-a', current_balance: 0 }],
    bank_account_statements: [],
    financial_transactions: [],
    financial_categories: [],
    employee_financial_records: [],
    appointments: []
  })
}

const save = (orderId: string | null, orderData: Record<string, unknown>) =>
  callHandler(SAVE, fakeEvent({ method: 'POST', cookies, body: { orderId, orderData } }))
const order = () => fake.tables.service_orders!.find(o => o.id === 'o1')!
const commission = () => Number(fake.tables.employee_financial_records!.reduce((s, r) => s + Number(r.amount), 0).toFixed(2))

beforeEach(() => {
  seed()
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@a.com' } }, error: null })
})

describe('E1–E8: creation and editing', () => {
  it('E1: partial edit keeps the fields not sent', async () => {
    await save('o1', { notes: 'nova observação' })
    expect(order()).toMatchObject({ notes: 'nova observação', total_amount: 1000, status: 'completed', number: 'OS100' })
  })
  // E2 (número duplicado → sugestão via RPC next_service_order_number) exige Postgres real: ver tests/db.
  it('E3: editing OS from another organization → 404 and nothing changes', async () => {
    expect((await save('o-b', { notes: 'x' })).status).toBe(404)
  })
  it('E4: without orderData → 400', async () => {
    expect((await callHandler(SAVE, fakeEvent({ method: 'POST', cookies, body: {} }))).status).toBe(400)
  })
  it('E5: when saving with responsibles and items, stores the OS commission entitlement (commission_amount)', async () => {
    await save('o1', { items: [item(2000)], total_amount: 2000 })
    expect(order().commission_amount).toBe(200)
  })
  it('E6: without responsibles, commission_amount resets to zero', async () => {
    await save('o1', { responsible_employees: [] })
    expect(order().commission_amount).toBe(0)
  })
  it('E7: organization_id in the body is ignored', async () => {
    await save('o1', { organization_id: 'org-b' })
    expect(order().organization_id).toBe('org-a')
  })
  it('E8: creating a new OS returns the record of the organization of the user', async () => {
    const r = await save(null, { number: '555', client_id: 'c1', total_amount: 0 })
    expect(r.status).toBe(200)
    expect(fake.tables.service_orders!.find(o => o.number === 'OS555')).toMatchObject({ organization_id: 'org-a', status: 'open', payment_status: 'pending' })
  })
})

describe('E9–E12: editing OS that already has payment', () => {
  async function paidHalf() {
    // Plano de 1 parcela de 1000; recebe 500 → comissão 50
    const { default: _ } = { default: 0 }
    fake.tables.service_order_installments!.push({ id: 'i1', organization_id: 'org-a', service_order_id: 'o1', kind: 'installment', installment_number: 1, amount: 1000, status: 'pending', deleted_at: null })
    await callHandler(PAY, fakeEvent({ method: 'POST', cookies, params: { id: 'o1', installmentId: 'i1' }, body: { amount: 500 } }))
  }

  it('E9: reopening/editing the note of a paid OS does not change payment or commission', async () => {
    fake.tables.service_order_installments!.push({ id: 'i1', organization_id: 'org-a', service_order_id: 'o1', amount: 1000, status: 'paid', deleted_at: null })
    order().payment_status = 'paid'
    await save('o1', { notes: 'ok' })
    expect(order().payment_status).toBe('paid')
  })
  it('E10: saved discount/items recalculate the per-item snapshot keeping the active manual override', async () => {
    order().commission_manual_adjustments_log = []
    await save('o1', { discount: 100 })
    expect(order().commission_amount).toBe(90)
  })

  // KF-37: o servidor aceita payment_status vindo do cliente — contraria a regra "payment_status é derivado das parcelas".
  it.fails('KF-37: payment_status sent in the body is ignored (always comes from installments)', async () => {
    await save('o1', { payment_status: 'paid' })
    expect(order().payment_status).toBe('pending')
  })
  // KF-38: editar valor/itens depois de receber não reconcilia as comissões já liberadas (ficam velhas até o próximo pagamento).
  it.fails('KF-38: reducing the OS amount after receiving adjusts the pending commission', async () => {
    await paidHalf()
    expect(commission()).toBe(50)
    await save('o1', { items: [item(400)], total_amount: 400 }) // 500 recebidos ≥ 400 → direito = 40
    expect(commission()).toBe(40)
  })
  // KF-39: aumentar o total de uma OS já quitada mantém payment_status = paid, e ela some dos devedores.
  it.fails('KF-39: increasing the total of a settled OS reverts the status to partial', async () => {
    fake.tables.service_order_installments!.push({ id: 'i1', organization_id: 'org-a', service_order_id: 'o1', amount: 1000, status: 'paid', deleted_at: null })
    order().payment_status = 'paid'
    await save('o1', { items: [item(1500)], total_amount: 1500 })
    expect(order().payment_status).toBe('partial')
  })
})

describe('E13–E16: installments (delete, patch) and effect on status/commission', () => {
  it('E13: deleting a PAID installment restores the balance, recalculates status and reverts pending commission', async () => {
    fake.tables.service_order_installments!.push({ id: 'i1', organization_id: 'org-a', service_order_id: 'o1', kind: 'installment', installment_number: 1, amount: 1000, status: 'pending', deleted_at: null })
    await callHandler(PAY, fakeEvent({ method: 'POST', cookies, params: { id: 'o1', installmentId: 'i1' }, body: { amount: 1000 } }))
    expect(commission()).toBe(100)
    const r = await callHandler(DEL_INSTALLMENT, fakeEvent({ method: 'DELETE', cookies, params: { id: 'o1', installmentId: 'i1' }, body: { reason: 'teste' } }))
    expect(r.status).toBe(200)
    expect(fake.tables.bank_accounts![0]!.current_balance).toBe(0)
    expect(order().payment_status).toBe('pending')
    expect(commission()).toBe(0)
  })
  it('E14: deleting an installment from ANOTHER organization → 404', async () => {
    fake.tables.service_order_installments!.push({ id: 'ib', organization_id: 'org-b', service_order_id: 'o-b', amount: 1, status: 'pending', deleted_at: null })
    const r = await callHandler(DEL_INSTALLMENT, fakeEvent({ method: 'DELETE', cookies, params: { id: 'o-b', installmentId: 'ib' }, body: { reason: 'teste' } }))
    expect(r.status).toBe(404)
  })
})
