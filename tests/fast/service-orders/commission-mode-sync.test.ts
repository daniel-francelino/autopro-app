// SYN-* e CRT-*: modo de comissao herdado da organizacao (criacao de OS e process-payment).
// Plano [100 pago, 900 pendente] numa OS de 1000 com 10% de comissao: proportional libera 10, full libera 100 (FV-7).
// Seeds sempre com a org em modo DIFERENTE da OS (FV-5) e nunca `null` (FV-1).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'

type Mode = 'full' | 'proportional'
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
const PROCESS = 'server/api/service-orders/[id]/process-payment.post.ts'
const SAVE = 'server/api/service-orders/index.post.ts'

function seed(o: { orgA?: Mode, orgB?: Mode, osMode?: Mode, orders?: Record<string, unknown>, extra?: Record<string, Record<string, unknown>[]> } = {}) {
  fake = createFakeSupabase({
    organizations: [
      { id: 'org-a', commission_release_mode: o.orgA ?? 'full' },
      { id: 'org-b', commission_release_mode: o.orgB ?? 'full' }
    ],
    user_profiles: [{ id: 'p1', user_id: 'u1', organization_id: 'org-a', role_id: 'r', is_owner: false, is_active: true, employee_id: null }],
    roles: [{ id: 'r', name: 'operador', is_system_role: false }],
    actions: ['orders.pay', 'orders.create', 'orders.update'].map((code, i) => ({ id: `a${i}`, code, deleted_at: null })),
    role_actions: [0, 1, 2].map(i => ({ role_id: 'r', action_id: `a${i}`, is_granted: true })),
    service_orders: [
      {
        id: 'o1', organization_id: 'org-a', number: '100', status: 'completed', entry_date: '2026-03-10', total_amount: 1000, discount: 0,
        total_taxes_amount: 0, payment_status: 'pending', deleted_at: null, commission_release_mode: o.osMode ?? 'proportional',
        commission_manual_adjustments_log: [], responsible_employees: [{ employee_id: 'e1' }],
        items: [{ id: 'it1', total_price: 1000, cost_price: 0, quantity: 1 }], ...o.orders
      },
      { id: 'o-b', organization_id: 'org-b', number: '900', status: 'completed', total_amount: 500, payment_status: 'pending', deleted_at: null, commission_release_mode: 'proportional' }
    ],
    employees: [{ id: 'e1', organization_id: 'org-a', name: 'Ana', deleted_at: null }],
    service_order_installments: [],
    service_order_events: [],
    bank_accounts: [{ id: 'acc-a', organization_id: 'org-a', current_balance: 1000 }],
    bank_account_statements: [],
    financial_transactions: [],
    financial_categories: [],
    employee_financial_records: [],
    appointments: [],
    ...o.extra
  })
}
beforeEach(() => {
  seed()
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@a.com' } }, error: null })
  auth.refreshSession.mockReset()
})

const plan = (installments: unknown[] = [{ amount: 100, status: 'paid' }, { amount: 900 }], extra: Record<string, unknown> = {}) =>
  ({ paymentMethod: 'pix', bankAccountId: 'acc-a', installments, ...extra })
const pay = (body: unknown, id = 'o1') => callHandler(PROCESS, fakeEvent({ method: 'POST', cookies, params: { id }, body }))
const os = (id = 'o1') => fake.tables.service_orders!.find(o => o.id === id)!
const commission = () => Number(fake.tables.employee_financial_records!.filter(r => r.service_order_id === 'o1' && r.record_type === 'commission').reduce((s, r) => s + Number(r.amount ?? 0), 0).toFixed(2))
const modeWrites = () => fake.writes.filter(w => w.table === 'service_orders' && w.op === 'update' && w.values && 'commission_release_mode' in (w.values as object))
const noModeEvent = () => expect((fake.tables.service_order_events ?? []).filter(e => e.event_type === 'commission.release_mode_changed')).toHaveLength(0)
const row = (over: Record<string, unknown>) => ({ id: `rr-${Math.random()}`, organization_id: 'org-a', employee_id: 'e1', service_order_id: 'o1', record_type: 'commission', status: 'pending', amount: 5, deleted_at: null, ...over })

describe('SYN: process-payment sincroniza o modo da OS com o da org', () => {
  it('SYN-1/12: org full, OS proportional, sem comissao -> OS full e comissao 100 com so 10% recebido', async () => {
    seed({ orgA: 'full', osMode: 'proportional' })
    expect((await pay(plan())).status).toBe(200)
    expect(os().commission_release_mode).toBe('full')
    expect(commission()).toBe(100)
    noModeEvent()
  })
  it('SYN-2: org proportional, OS full, sem comissao -> OS proportional e comissao 10', async () => {
    seed({ orgA: 'proportional', osMode: 'full' })
    expect((await pay(plan())).status).toBe(200)
    expect(os().commission_release_mode).toBe('proportional')
    expect(commission()).toBe(10)
    noModeEvent()
  })
  it.each(['pending', 'paid'])('SYN-3/4: comissao %s existente -> modo da OS nao muda (org diferente)', async (status) => {
    seed({ orgA: 'full', osMode: 'proportional', extra: { employee_financial_records: [row({ status })] } })
    expect((await pay(plan())).status).toBe(200)
    expect(os().commission_release_mode).toBe('proportional')
    expect(modeWrites()).toHaveLength(0)
  })
  it('SYN-5: linha de outra OS, de outra org ou de outro record_type nao conta como liberada', async () => {
    seed({
      orgA: 'full',
      osMode: 'proportional',
      extra: { employee_financial_records: [row({ service_order_id: 'o-b' }), row({ organization_id: 'org-b' }), row({ record_type: 'bonus' }), row({ record_type: 'adiantamento' })] }
    })
    expect((await pay(plan())).status).toBe(200)
    expect(os().commission_release_mode).toBe('full')
    expect(modeWrites()).toHaveLength(1)
  })
  it('SYN-6/18: update condicional (id, organization_id, neq mode, updated_by); sem update quando ja igual', async () => {
    seed({ orgA: 'full', osMode: 'proportional' })
    await pay(plan())
    const w = modeWrites()[0]!
    expect(w.filters).toEqual(expect.arrayContaining(['id=o1', 'organization_id=org-a', 'commission_release_mode!=full']))
    expect(w.values).toMatchObject({ commission_release_mode: 'full', updated_by: 'a@a.com' })
    seed({ orgA: 'full', osMode: 'full' })
    expect((await pay(plan())).status).toBe(200)
    expect(modeWrites()).toHaveLength(0)
    expect(commission()).toBe(100)
  })
  it('SYN-8: releaseCommissionsInFull no body e ignorado (org proportional)', async () => {
    seed({ orgA: 'proportional', osMode: 'proportional' })
    expect((await pay(plan(undefined, { releaseCommissionsInFull: true }))).status).toBe(200)
    expect(os().commission_release_mode).toBe('proportional')
    expect(commission()).toBe(10)
    seed({ orgA: 'proportional', osMode: 'full' })
    expect((await pay(plan(undefined, { releaseCommissionsInFull: true }))).status).toBe(200)
    expect(os().commission_release_mode).toBe('proportional')
    expect(commission()).toBe(10)
  })

  const failures: Array<[string, () => void, string, number]> = [
    ['404 OS inexistente', () => {}, 'nope', 404],
    ['404 OS de outra org', () => {}, 'o-b', 404],
    ['409 status nao concluido', () => { os().status = 'in_progress' }, 'o1', 409],
    ['409 plano existente', () => { fake.tables.service_order_installments!.push({ id: 'i', organization_id: 'org-a', service_order_id: 'o1', kind: 'installment', amount: 1000, deleted_at: null }) }, 'o1', 409],
    ['409 adiantamento maior que o total', () => { fake.tables.service_order_installments!.push({ id: 'i', organization_id: 'org-a', service_order_id: 'o1', kind: 'down_payment', amount: 1500, deleted_at: null }) }, 'o1', 409],
    ['400 soma das linhas', () => {}, 'o1', 400]
  ]
  it.each(failures)('SYN-9: %s nao grava o modo (org full difere da OS proportional)', async (name, mutate, id, status) => {
    seed({ orgA: 'full', osMode: 'proportional' })
    mutate()
    expect(fake.tables.organizations![0]!.commission_release_mode).not.toBe(os().commission_release_mode)
    const body = name.startsWith('400') ? plan([{ amount: 10, status: 'paid' }]) : plan()
    expect((await pay(body, id)).status).toBe(status)
    expect(os().commission_release_mode).toBe('proportional')
    expect(modeWrites()).toHaveLength(0)
    noModeEvent()
  })

  it.each<[Mode, Mode]>([['full', 'proportional'], ['proportional', 'full']])('SYN-10: reconciliacao (sinal cobre o total) sincroniza antes de liberar: org %s, OS %s', async (orgMode, osMode) => {
    seed({ orgA: orgMode, osMode, extra: { service_order_installments: [{ id: 'dp', organization_id: 'org-a', service_order_id: 'o1', kind: 'down_payment', installment_number: 1, amount: 1000, amount_paid: 1000, status: 'paid', deleted_at: null }] } })
    expect((await pay(plan([]))).status).toBe(200)
    expect(os().commission_release_mode).toBe(orgMode)
    expect(commission()).toBe(100) // recebido 100%: os dois modos liberam o total
  })
  it('SYN-10b: reconciliacao com recebido parcial: proportional libera so o recebido', async () => {
    seed({
      orgA: 'proportional',
      osMode: 'full',
      extra: { service_order_installments: [{ id: 'dp', organization_id: 'org-a', service_order_id: 'o1', kind: 'down_payment', installment_number: 1, amount: 1000, amount_paid: 100, status: 'partial', deleted_at: null }] }
    })
    expect((await pay(plan([]))).status).toBe(200)
    expect(os().commission_release_mode).toBe('proportional')
    expect(modeWrites()).toHaveLength(1)
  })
  it('SYN-13: org sem linha ou leitura falha -> 500 e nenhuma parcela criada (sem default)', async () => {
    seed()
    fake.tables.organizations!.length = 0
    expect((await pay(plan())).status).toBe(500)
    expect(fake.tables.service_order_installments).toHaveLength(0)
    expect(modeWrites()).toHaveLength(0)
    seed()
    fake.failNext('organizations')
    expect((await pay(plan())).status).toBe(500)
    expect(fake.tables.service_order_installments).toHaveLength(0)
  })
  it('SYN-14: falha na contagem de comissoes -> 500 e nada gravado', async () => {
    seed({ orgA: 'full', osMode: 'proportional' })
    fake.failNext('employee_financial_records')
    expect((await pay(plan())).status).toBe(500)
    expect(fake.tables.service_order_installments).toHaveLength(0)
    expect(modeWrites()).toHaveLength(0)
    expect(os().commission_release_mode).toBe('proportional')
  })
  it('SYN-15: isolamento: usa o modo da org-a; org-b e a OS dela intocadas', async () => {
    seed({ orgA: 'proportional', orgB: 'full', osMode: 'full' })
    expect((await pay(plan())).status).toBe(200)
    expect(os().commission_release_mode).toBe('proportional')
    expect(os('o-b').commission_release_mode).toBe('proportional')
    expect(fake.tables.organizations!.find(o => o.id === 'org-b')!.commission_release_mode).toBe('full')
    expect(commission()).toBe(10)
  })
  it('SYN-17: org muda entre criacao e pagamento, sem comissao: vale o modo da org no pagamento', async () => {
    seed({ orgA: 'full', osMode: 'full' })
    fake.tables.organizations![0]!.commission_release_mode = 'proportional'
    expect((await pay(plan())).status).toBe(200)
    expect(os().commission_release_mode).toBe('proportional')
    expect(commission()).toBe(10)
  })
})

describe('CRT: criacao de OS herda o modo da org', () => {
  const create = (orderData: Record<string, unknown> = {}, orderId: string | null = null) =>
    callHandler(SAVE, fakeEvent({ method: 'POST', cookies, body: { orderId, orderData: { number: '777', client_id: 'c1', total_amount: 0, ...orderData } } }))
  const created = () => fake.tables.service_orders!.find(o => o.number === 'OS777')!
  const insertsOs = () => fake.writes.filter(w => w.table === 'service_orders' && w.op === 'insert')

  it.each<Mode>(['full', 'proportional'])('CRT-1/2: org %s -> OS nasce %s', async (mode) => {
    seed({ orgA: mode, orgB: mode === 'full' ? 'proportional' : 'full' })
    expect((await create()).status).toBe(200)
    expect(created().commission_release_mode).toBe(mode)
    expect(created().organization_id).toBe('org-a')
  })
  it('CRT-3: org-a proportional e org-b full: OS nasce proportional e a leitura da org e feita', async () => {
    seed({ orgA: 'proportional', orgB: 'full' })
    const from = vi.spyOn(fake.client, 'from')
    await create()
    expect(created().commission_release_mode).toBe('proportional')
    expect(from.mock.calls.filter(c => c[0] === 'organizations').length).toBeGreaterThan(0)
  })
  it('CRT-4: org sem linha ou leitura falha -> 500 e nenhum insert em service_orders', async () => {
    seed()
    fake.tables.organizations!.length = 0
    expect((await create()).status).toBe(500)
    expect(insertsOs()).toHaveLength(0)
    seed()
    fake.failNext('organizations')
    expect((await create()).status).toBe(500)
    expect(insertsOs()).toHaveLength(0)
  })
  it('CRT-5/7: editar OS existente nao le/escreve a org nem muda o modo, mesmo com a org diferente', async () => {
    seed({ orgA: 'full', osMode: 'proportional' })
    const from = vi.spyOn(fake.client, 'from')
    expect((await create({ notes: 'editada' }, 'o1')).status).toBe(200)
    expect(os().commission_release_mode).toBe('proportional')
    expect(from.mock.calls.filter(c => c[0] === 'organizations')).toHaveLength(0)
    expect(fake.tables.employee_financial_records).toHaveLength(0)
  })
  it('CRT-6: commission_release_mode enviado pelo cliente e ignorado', async () => {
    seed({ orgA: 'proportional' })
    expect((await create({ commission_release_mode: 'full' })).status).toBe(200)
    expect(created().commission_release_mode).toBe('proportional')
  })
})
