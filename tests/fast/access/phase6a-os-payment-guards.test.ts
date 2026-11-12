// Fase 6 (metade A) do plano de acesso: recebimento de OS exige `orders.pay` (D4).
// Para cada rota: (i) sem o código -> 403, nenhuma escrita e tabelas iguais; (ii) role com `orders.update` (o gate antigo do front)
// mas sem `orders.pay` -> 403; (iii) com o código -> sucesso; (iv) admin e owner (role_actions vazio) -> sucesso. Usa o requireOrgPermission real.
// Plano: docs/engineering/access-control-rollout-plan.md, seção 8, Fase 6.
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
const api = (p: string) => `server/api/service-orders/${p}`

type Case = { name: string, file: string, params: Record<string, string>, body: unknown }

const PAY = { bankAccountId: 'ba1', paymentMethod: 'pix' }

const TABLES = {
  service_orders: [
    { id: 'o1', organization_id: 'org-a', number: 'OS1', status: 'completed', entry_date: '2026-03-10', total_amount: 300, discount: 0, total_taxes_amount: 0, payment_status: 'pending', deleted_at: null, commission_release_mode: null, commission_manual_adjustments_log: [], responsible_employees: [], items: [] },
    { id: 'o2', organization_id: 'org-a', number: 'OS3', status: 'completed', entry_date: '2026-03-10', total_amount: 100, discount: 0, total_taxes_amount: 0, payment_status: 'pending', deleted_at: null, commission_release_mode: null, commission_manual_adjustments_log: [], responsible_employees: [], items: [] },
    { id: 'o-open', organization_id: 'org-a', number: 'OS2', status: 'open', entry_date: '2026-03-10', total_amount: 500, payment_status: 'pending', deleted_at: null }
  ],
  service_order_installments: [
    { id: 'i1', organization_id: 'org-a', service_order_id: 'o2', kind: 'installment', installment_number: 1, amount: 100, amount_paid: 0, status: 'pending', due_date: '2026-04-10', deleted_at: null }
  ],
  bank_accounts: [{ id: 'ba1', organization_id: 'org-a', current_balance: 1000 }],
  bank_account_statements: [],
  financial_transactions: [],
  financial_categories: [],
  employees: [],
  employee_financial_records: []
}

const CASES: Case[] = [
  { name: 'process-payment POST', file: api('[id]/process-payment.post.ts'), params: { id: 'o1' }, body: { ...PAY, installments: [{ amount: 300, status: 'paid' }] } },
  { name: 'down-payment POST', file: api('[id]/down-payment.post.ts'), params: { id: 'o-open' }, body: { ...PAY, amount: 200 } },
  { name: 'receive-extra-payment POST', file: api('[id]/receive-extra-payment.post.ts'), params: { id: 'o1' }, body: { ...PAY, amount: 50 } },
  { name: 'installments pay POST', file: api('[id]/installments/[installmentId]/pay.post.ts'), params: { id: 'o2', installmentId: 'i1' }, body: { ...PAY } }
]

function login(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

beforeEach(() => {
  auth.refreshSession.mockReset()
})

const run = (c: Case) => callHandler(c.file, fakeEvent({ method: 'POST', cookies, params: c.params, body: c.body }))
const seed = () => createFakeSupabase(guardSeed(['orders.update', 'orders.pay'], structuredClone(TABLES)))

describe.each(CASES)('$name exige orders.pay', (c) => {
  it('role sem o código -> 403, nenhuma escrita e tabelas iguais', async () => {
    fake = seed()
    fake.tables.role_actions!.length = 0
    const before = structuredClone(fake.tables)
    login('sem')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(fake.writes).toHaveLength(0)
    expect(fake.tables).toEqual(before)
  })

  it('role com orders.update e sem orders.pay -> 403 e nenhuma escrita', async () => {
    fake = seed()
    // r-com só recebe orders.update (act-0); orders.pay (act-1) fica fora
    fake.tables.role_actions = [{ role_id: 'r-com', action_id: 'act-0', is_granted: true }]
    expect(fake.tables.actions!.find(a => a.id === 'act-0')!.code).toBe('orders.update')
    login('com')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(fake.writes).toHaveLength(0)
  })

  it('role com orders.pay -> sucesso', async () => {
    fake = seed()
    fake.tables.role_actions = [{ role_id: 'r-com', action_id: 'act-1', is_granted: true }]
    login('com')
    const res = await run(c)
    expect(res.status).toBe(200)
  })

  it.each(['admin', 'owner'] as const)('%s passa sem concessão em role_actions', async (persona) => {
    fake = seed()
    fake.tables.role_actions!.length = 0
    login(persona)
    const res = await run(c)
    expect(res.status).toBe(200)
  })
})
