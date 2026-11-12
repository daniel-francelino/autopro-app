// Handler de GET /api/employees/:id/commissions contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 4 (EMP-02a, 02b, 16, 06h).
//  - 401 sem sessão já é provado por guard-matrix.test.ts; não se repete aqui.
//  - Os cálculos de comissão (liberação, recálculo, pagamento) são de commissions-*.test.ts e financial-*.test.ts; aqui só se prova
//    a PARIDADE do total do funcionário com o relatório (reports/commissions.get.ts) usado como oráculo, e o 404/isolamento.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md, KF-32).
//    Ao corrigir o handler o Vitest acusa "unexpected pass": troque it.fails por it.
//  - Limitações do fake: `or()` é no-op, `range()` só limita, `select(cols)` devolve todas as colunas.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { employeesSeed, USERS } from './employees-seed'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const COMMISSIONS = 'server/api/employees/[id]/commissions.get.ts'
const REPORT = 'server/api/reports/commissions.get.ts'

beforeEach(() => {
  fake = createFakeSupabase(employeesSeed())
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: USERS.owner.id, email: USERS.owner.email } }, error: null })
  auth.refreshSession.mockReset()
})

type Summary = { totalCommissions: number, totalPaid: number, totalPending: number, itemsCount: number, orderCount: number }
type CommissionsBody = { data: { summary: Summary, items: Array<{ id: string }>, employee: { id: string, name: string }, period: { dateFrom: string | null, dateTo: string | null } } }
type ReportBody = { data: { summary: { totalCommissions: number, totalPaid: number, totalPending: number }, items: Array<{ id: string }> } }

const commissions = (id: string, query: Record<string, unknown> = {}) => callHandler(COMMISSIONS, fakeEvent({ cookies, params: { id }, query }))
const report = (employeeId: string, query: Record<string, unknown> = {}) => callHandler(REPORT, fakeEvent({ cookies, query: { employeeId, pageSize: 100, ...query } }))
const MARCH = { dateFrom: '2026-03-01', dateTo: '2026-03-31' }

describe('EMP-02a: totais do funcionário == relatório de comissões filtrado pelo mesmo funcionário e período', () => {
  const periods: Array<[string, Record<string, string>, { total: number, paid: number, pending: number, items: string[] }]> = [
    ['março/2026', MARCH, { total: 150.5, paid: 100, pending: 50.5, items: ['fr-1', 'fr-2'] }],
    ['sem período', {}, { total: 180.5, paid: 100, pending: 80.5, items: ['fr-1', 'fr-2', 'fr-3'] }]
  ]
  for (const [label, period, expected] of periods) {
    it(`${label}: totais pagos, pendentes e total iguais aos do relatório, e aos valores semeados`, async () => {
      const mine = await commissions('e-a1', period)
      const oracle = await report('e-a1', period)
      expect(mine.status).toBe(200)
      expect(oracle.status).toBe(200)
      const m = (mine.body as CommissionsBody).data.summary
      const r = (oracle.body as ReportBody).data.summary
      expect(m.totalCommissions).toBe(r.totalCommissions)
      expect(m.totalPaid).toBe(r.totalPaid)
      expect(m.totalPending).toBe(r.totalPending)
      // âncora independente do oráculo: os valores vêm do seed
      expect(m).toMatchObject({ totalCommissions: expected.total, totalPaid: expected.paid, totalPending: expected.pending, itemsCount: expected.items.length })
      expect((mine.body as CommissionsBody).data.items.map(i => i.id).sort()).toEqual(expected.items)
    })
  }

  it('bônus não entra no total de comissões (nem no do funcionário, nem no do relatório) e não vira item', async () => {
    const mine = await commissions('e-a1', MARCH)
    const oracle = await report('e-a1', MARCH)
    // fr-4 é um bônus pago de 200 em março: com ele o total seria 350,5
    expect((mine.body as CommissionsBody).data.summary.totalCommissions).toBe(150.5)
    expect((oracle.body as ReportBody).data.summary.totalCommissions).toBe(150.5)
    expect((mine.body as CommissionsBody).data.items.map(i => i.id)).not.toContain('fr-4')
  })

  it('só o funcionário pedido: comissão de outro funcionário de A (fr-5) e de B (fr-b) nunca entram', async () => {
    const mine = (await commissions('e-a1')).body as CommissionsBody
    const ids = mine.data.items.map(i => i.id)
    expect(ids).not.toContain('fr-5')
    expect(ids).not.toContain('fr-b')
    expect(mine.data.employee).toMatchObject({ id: 'e-a1', name: 'Ana Ativa' })
  })

  it('devolve o período pedido e não grava nada', async () => {
    const res = await commissions('e-a1', MARCH)
    expect((res.body as CommissionsBody).data.period).toEqual(MARCH)
    expect(fake.writes).toHaveLength(0)
  })
})

describe('EMP-02b: comissão pendente de OS excluída (KF-32)', () => {
  // fr-kf32: pendente de 70 em março, de uma OS excluída (so-del). Fica em employee_financial_records.
  beforeEach(() => {
    fake.tables.employee_financial_records!.push(
      { id: 'fr-kf32', organization_id: 'org-a', employee_id: 'e-a1', service_order_id: 'so-del', record_type: 'commission', status: 'pending', amount: 70, reference_date: '2026-03-12', payment_date: null, description: 'OS 104 - Item', item_name: 'Item', item_amount: 500, item_cost: 0, deleted_at: null }
    )
  })

  it('controle: sem o registro de OS excluída, funcionário e relatório concordam (março = 150,5)', async () => {
    fake.tables.employee_financial_records = fake.tables.employee_financial_records!.filter(r => r.id !== 'fr-kf32')
    const mine = (await commissions('e-a1', MARCH)).body as CommissionsBody
    const oracle = (await report('e-a1', MARCH)).body as ReportBody
    expect(mine.data.summary.totalCommissions).toBe(150.5)
    expect(oracle.data.summary.totalCommissions).toBe(150.5)
  })

  it.fails('funcionário, relatório e employee_financial_records dizem o mesmo total pendente em março [KF-32]', async () => {
    const mine = (await commissions('e-a1', MARCH)).body as CommissionsBody
    const oracle = (await report('e-a1', MARCH)).body as ReportBody
    const stored = fake.tables.employee_financial_records!
      .filter(r => r.employee_id === 'e-a1' && r.record_type === 'commission' && r.status === 'pending' && r.reference_date >= MARCH.dateFrom && r.reference_date <= MARCH.dateTo && !r.deleted_at)
      .reduce((sum, r) => sum + r.amount, 0)
    expect(stored).toBe(120.5) // 50,5 (fr-2) + 70 (fr-kf32)
    expect(mine.data.summary.totalPending).toBe(oracle.data.summary.totalPending)
    expect(oracle.data.summary.totalPending).toBe(stored)
  })
})

describe('EMP-16 / EMP-06h: funcionário inexistente ou de outra org', () => {
  for (const [label, id] of [['id inexistente', 'nope'], ['funcionário excluído', 'e-a-del'], ['EMP-06h: funcionário de B logado em A', 'e-b1']] as const) {
    it(`${label} -> 404 "Funcionário não encontrado", sem dados`, async () => {
      const res = await commissions(id, MARCH)
      expect(res.status).toBe(404)
      expect(res.error?.statusMessage).toBe('Funcionário não encontrado')
      expect(res.body).toBeUndefined()
      expect(JSON.stringify(res)).not.toContain('Item B')
      expect(JSON.stringify(res)).not.toContain('777')
    })
  }

  it('EMP-06h: ?organization_id=org-b e o funcionário de B continuam 404 (a org vem da sessão)', async () => {
    const res = await commissions('e-b1', { organization_id: 'org-b' })
    expect(res.status).toBe(404)
    expect(res.body).toBeUndefined()
  })
})
