// Histórico da OS (F3): encadeamento ponta a ponta de visibilidade com access.ts REAL (sem mockar allowedVisibilities).
// generate-commissions (ramo manual) grava commission.recalculated; GET history só o devolve a quem tem reports.commissions.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { guardSeed, USERS, type Persona } from '../../support/phase3-guard-fixture'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }
vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))
vi.mock('../../../server/utils/employee-commission-plans', () => ({
  resolveEmployeeCommissionRulesForEmployees: vi.fn(async (_s: unknown, _o: string, ids: string[]) =>
    new Map(ids.map(id => [id, [{ id: 'r', plan_id: 'p', version_id: 'v', name: '10%', commission_type: 'percentage', commission_amount: 10, commission_base: 'revenue', category_ids: [], is_default: true }]]))),
  resolveCommissionPlanRules: vi.fn(async () => []),
  fetchCommissionPlan: vi.fn(async () => null)
}))
installNitroGlobals()
await installServerUtilsGlobals()

const GEN = 'server/api/service-orders/[id]/generate-commissions.post.ts'
const HISTORY = 'server/api/service-orders/[id]/history.get.ts'
const CODES = ['orders.read', 'orders.update', 'orders.pay', 'reports.commissions']
type Row = Record<string, any>

const login = (p: Persona) => auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: USERS[p].id, email: USERS[p].email } }, error: null })
const call = (file: string, o: { body?: unknown, query?: Record<string, unknown> } = {}) => {
  const e = fakeEvent({ method: o.body ? 'POST' : 'GET', cookies: { 'sb-access-token': 'tok' }, params: { id: 'oA' }, body: o.body, query: o.query })
  ;(e as any).context = { audit: { requestId: '66666666-6666-4666-8666-666666666666', userId: USERS.admin.id, actorType: 'user' } }
  return callHandler(file, e)
}
const grant = (codes: string[]) => { (fake.tables.role_actions as Row[]).splice(0, Infinity, ...codes.map(c => ({ role_id: 'r-com', action_id: `act-${CODES.indexOf(c)}`, is_granted: true }))) }

async function setup() {
  fake = createFakeSupabase(guardSeed(CODES, {
    service_orders: [{ id: 'oA', organization_id: 'org-a', number: 'OS1', status: 'completed', total_amount: 1000, discount: 0, total_taxes_amount: 0, entry_date: '2026-11-01', deleted_at: null, commission_release_mode: null, commission_manual_adjustments_log: [], responsible_employees: [{ employee_id: 'e1' }], items: [{ id: 'it1', total_price: 1000, cost_price: 0, quantity: 1, category_id: null }] }],
    employees: [{ id: 'e1', organization_id: 'org-a', name: 'Ana', deleted_at: null }],
    service_order_installments: [{ id: 'ip', organization_id: 'org-a', service_order_id: 'oA', amount: 500, status: 'paid', deleted_at: null }],
    employee_financial_records: [{ id: 'r1', organization_id: 'org-a', service_order_id: 'oA', employee_id: 'e1', record_type: 'commission', status: 'pending', amount: 20, created_at: '2026-11-01T10:00:00Z' }],
    service_order_events: [{ id: 'g1', seq: 1, organization_id: 'org-a', service_order_id: 'oA', occurred_at: '2026-11-01T09:00:00Z', event_type: 'order.created', schema_version: 1, category: 'order', visibility: 'general', actor_name: 'Maria', payload: { order_number: 'OS1' }, correlation_id: 'c', source_code: 'os_form', source_label: 'OS' }]
  }))
  login('admin')
  const r = await call(GEN, { body: { employeeId: 'e1', reason: 'ajuste do gerente' } })
  expect(r.status).toBe(200)
  const rec = (fake.tables.service_order_events as Row[]).filter(e => e.event_type === 'commission.recalculated')
  expect(rec).toHaveLength(1)
  expect(rec[0]).toMatchObject({ visibility: 'commission' })
}
const walk = async () => {
  const items: any[] = []
  let cursor: string | null = null
  for (let i = 0; i < 10; i++) {
    const res: any = await call(HISTORY, { query: { limit: 1, ...(cursor ? { cursor } : {}) } })
    expect(res.status).toBe(200)
    items.push(...res.body.items)
    cursor = res.body.nextCursor
    if (!cursor) break
  }
  return items
}

beforeEach(() => { auth.refreshSession.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('visibilidade ponta a ponta: commission.recalculated (access.ts real)', () => {
  it('só orders.read: não aparece nem no JSON nem na paginação (limit=1)', async () => {
    await setup()
    grant(['orders.read'])
    login('com')
    const res: any = await call(HISTORY)
    expect(res.status).toBe(200)
    expect(res.body.items.map((i: any) => i.title)).toHaveLength(1)
    const all = await walk()
    expect(all).toHaveLength(1)
    for (const j of [JSON.stringify(res.body), JSON.stringify(all)]) {
      expect(j).not.toMatch(/recalculated|ajuste do gerente|Ana|previous_amount/)
    }
  })

  it('orders.read + reports.commissions: devolve o evento de comissão (com motivo) e o geral', async () => {
    await setup()
    grant(['orders.read', 'reports.commissions'])
    login('com')
    // o fake não implementa o cursor `or(...)`; a paginação real é provada no teste de banco
    const res: any = await call(HISTORY)
    expect(res.body.items).toHaveLength(2)
    expect(JSON.stringify(res.body)).toContain('ajuste do gerente')
  })

  it('só reports.commissions, sem orders.read: 403', async () => {
    await setup()
    grant(['reports.commissions'])
    login('com')
    expect((await call(HISTORY)).status).toBe(403)
  })
})
