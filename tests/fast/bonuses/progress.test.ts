// GET /api/bonuses/:id/progress contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 3 (BON-04, BON-17, BON-06i).
// Padrão de referência: tests/fast/bonuses/generate.test.ts.
//  - O cálculo de "alcançado" é do util server/utils/bonuses (sumAchievedAmount); aqui só se prova que o handler o usa
//    com os dados da organização certa. Os literais (5000, 1000, 4700) são tripwires independentes do util.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { baseSeed, USERS, MONTH, type Persona } from '../../support/bonuses-fixture'
import { sumAchievedAmount, type BonusCommissionRecord, type CommissionBase } from '../../../server/utils/bonuses'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

type ServiceOrderForBonus = Parameters<typeof sumAchievedAmount>[0][number]

const cookies = { 'sb-access-token': 'tok' }
const PROGRESS = 'server/api/bonuses/[id]/progress.get.ts'

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

function seed() {
  const s = baseSeed()
  // bon-np: base "lucro líquido do funcionário" (usa comissões), só e1. e3 aparece como atribuição removida em bon-a.
  s.bonuses.push({ id: 'bon-np', organization_id: 'org-a', name: 'Meta lucro liquido', active: true, due_day: null, deleted_at: null })
  s.bonus_value_versions.push({ id: 'v-np', bonus_id: 'bon-np', commission_base: 'employee_net_profit', goal_amount: 4500, bonus_amount: 10, effective_from: '2026-01-01' })
  s.bonus_employee_assignments.push(
    { id: 'as-np1', bonus_id: 'bon-np', employee_id: 'e1', active: true, deleted_at: null },
    { id: 'as-removed', bonus_id: 'bon-a', employee_id: 'e3', active: false, deleted_at: '2026-09-02T00:00:00Z' }
  )
  s.employee_financial_records.push(
    { id: 'com-a1', organization_id: 'org-a', employee_id: 'e1', record_type: 'commission', service_order_id: 'so-1', amount: 300, deleted_at: null },
    // Dados de B que NÃO podem entrar no cálculo de A: OS e comissão de B apontando para o id de funcionário e1 / OS so-1.
    { id: 'com-b-leak', organization_id: 'org-b', employee_id: 'e1', record_type: 'commission', service_order_id: 'so-1', amount: 1000, deleted_at: null }
  )
  s.service_orders.push(
    { id: 'so-b-leak', organization_id: 'org-b', status: 'completed', employee_responsible_id: 'e1', entry_date: '2026-10-11', total_amount: 99999, total_cost_amount: 0, items: [], deleted_at: null }
  )
  // Out/2026 de e2 já gerado (congelado): achieved 1234 difere do ao vivo (1000).
  s.bonus_generations.push(
    { id: 'gen-e2', bonus_id: 'bon-a', employee_id: 'e2', reference_month: MONTH, commission_base: 'revenue', goal_amount: 3000, bonus_amount: 500.25, achieved_amount: 1234, goal_met: false, financial_record_id: null }
  )
  fake = createFakeSupabase(s)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-12T12:00:00'))
  seed()
  loginAs('owner')
  auth.refreshSession.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

type Item = {
  employeeId: string, employeeName: string, referenceMonth: string, commissionBase: string | null
  goalAmount: number | null, bonusAmount: number | null, achievedAmount: number, goalMet: boolean
  generated: boolean, financialRecordId: string | null
}
const progress = (bonusId: string, query: Record<string, unknown> = {}) =>
  callHandler(PROGRESS, fakeEvent({ cookies, params: { id: bonusId }, query }))
const itemsOf = (res: Awaited<ReturnType<typeof progress>>) => (res.body as { items: Item[] }).items
const itemOf = (res: Awaited<ReturnType<typeof progress>>, employeeId: string) => itemsOf(res).find(i => i.employeeId === employeeId)!

const table = (name: string) => fake.tables[name]!
// Mesmos dados que o handler lê: só da organização A, mesmo critério de comissão.
const orgAOrders = () => table('service_orders').filter(o => o.organization_id === 'org-a' && o.deleted_at == null) as unknown as ServiceOrderForBonus[]
const orgACommissions = () => table('employee_financial_records')
  .filter(r => r.organization_id === 'org-a' && r.record_type === 'commission' && r.deleted_at == null) as unknown as BonusCommissionRecord[]
const expectedAchieved = (employeeId: string, month: string, base: CommissionBase) =>
  sumAchievedAmount(orgAOrders(), employeeId, month, base, orgACommissions())

describe('BON-04: GET /api/bonuses/:id/progress', () => {
  it('BON-04: achievedAmount por funcionário == sumAchievedAmount do util para os mesmos dados (base revenue, meta do mês)', async () => {
    const res = await progress('bon-a', { referenceMonth: '2026-11-01' })
    expect(res.status).toBe(200)
    const items = itemsOf(res)
    // A atribuição removida (e3) não entra.
    expect(items.map(i => i.employeeId).sort()).toEqual(['e1', 'e2'])

    const e1 = itemOf(res, 'e1')
    expect(e1.achievedAmount).toBe(expectedAchieved('e1', '2026-11-01', 'revenue'))
    expect(e1.achievedAmount).toBe(5000) // tripwire: so-3 (nov); a so-1 de outubro e a OS de B não contam
    expect(e1).toMatchObject({ employeeName: 'Ana (atinge meta)', referenceMonth: '2026-11-01', commissionBase: 'revenue', goalAmount: 3000, bonusAmount: 500.25, goalMet: true, generated: false, financialRecordId: null })

    const e2 = itemOf(res, 'e2')
    expect(e2.achievedAmount).toBe(expectedAchieved('e2', '2026-11-01', 'revenue'))
    expect(e2.achievedAmount).toBe(0)
    expect(e2).toMatchObject({ goalMet: false, generated: false })
    expect(fake.writes).toEqual([])
  })

  it('BON-04: base employee_net_profit desconta a comissão de e1 (4700 = 5000 - 300) e a de B não entra', async () => {
    const res = await progress('bon-np', { referenceMonth: MONTH })
    expect(res.status).toBe(200)
    const e1 = itemOf(res, 'e1')
    expect(e1.achievedAmount).toBe(expectedAchieved('e1', MONTH, 'employee_net_profit'))
    expect(e1.achievedAmount).toBe(4700)
    expect(e1).toMatchObject({ commissionBase: 'employee_net_profit', goalAmount: 4500, goalMet: true, generated: false })
  })

  it('BON-04: mês já gerado reflete o snapshot congelado (e2: 1234, generated=true); quem não foi gerado segue ao vivo (e1: 5000)', async () => {
    const res = await progress('bon-a', { referenceMonth: MONTH })
    expect(res.status).toBe(200)

    const e2 = itemOf(res, 'e2')
    expect(e2).toMatchObject({ generated: true, achievedAmount: 1234, goalMet: false, financialRecordId: null, goalAmount: 3000, bonusAmount: 500.25 })
    expect(e2.achievedAmount).not.toBe(expectedAchieved('e2', MONTH, 'revenue')) // ao vivo seria 1000

    const e1 = itemOf(res, 'e1')
    expect(e1.generated).toBe(false)
    expect(e1.achievedAmount).toBe(expectedAchieved('e1', MONTH, 'revenue'))
    expect(e1.achievedAmount).toBe(5000)
  })

  it('BON-04: mês sem versão vigente (antes de jan/2026) -> commissionBase/meta null, achieved 0, goalMet false', async () => {
    const res = await progress('bon-a', { referenceMonth: '2025-12-01' })
    expect(res.status).toBe(200)
    expect(itemOf(res, 'e1')).toMatchObject({ commissionBase: null, goalAmount: null, bonusAmount: null, achievedAmount: 0, goalMet: false, generated: false })
  })
})

describe('BON-17: referenceMonth e bônus inexistente', () => {
  it.each([
    ['2026-10-15T12:00:00', '2026-10-01', 5000, 1234], // e2 de outubro já gerado: snapshot congelado
    ['2026-11-30T20:00:00', '2026-11-01', 5000, 0]
  ])('BON-17: referenceMonth ausente usa o mês corrente (%s -> %s)', async (now, month, e1Amount, e2Amount) => {
    vi.setSystemTime(new Date(now))
    const res = await progress('bon-a')
    expect(res.status).toBe(200)
    expect(itemOf(res, 'e1')).toMatchObject({ referenceMonth: month, achievedAmount: e1Amount })
    expect(itemOf(res, 'e2').referenceMonth).toBe(month)
    expect(itemOf(res, 'e2').achievedAmount).toBe(e2Amount)
  })

  it('BON-17: referenceMonth vazio/só espaços também cai no mês corrente', async () => {
    const res = await progress('bon-a', { referenceMonth: '   ' })
    expect(res.status).toBe(200)
    expect(itemOf(res, 'e1').referenceMonth).toBe('2026-11-01')
  })

  // KF-50 (G1-SD-08): referenceMonth é aceito como veio (qualquer string, qualquer dia). O correto é 400 (ou normalizar).
  it.fails('BON-17: referenceMonth "abc" -> 400 (KF-50)', async () => {
    const res = await progress('bon-a', { referenceMonth: 'abc' })
    expect(res.status).toBe(400)
  })

  it.fails('BON-17: referenceMonth "2026-11-15" (dia diferente de 01) -> 400 (KF-50)', async () => {
    const res = await progress('bon-a', { referenceMonth: '2026-11-15' })
    expect(res.status).toBe(400)
  })

  it('BON-17: bônus inexistente -> 404', async () => {
    const res = await progress('nao-existe', { referenceMonth: MONTH })
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Bônus não encontrado')
  })
})

describe('BON-06i: permissão e isolamento de tenant', () => {
  it('BON-06i: emp-sem (sem bonuses.read) -> 403', async () => {
    loginAs('emp-sem')
    const res = await progress('bon-a', { referenceMonth: MONTH })
    expect(res.status).toBe(403)
    expect(res.error?.statusMessage).toContain('Acesso negado')
  })

  it('BON-06i: bônus de B logado em A -> 404, sem dados', async () => {
    const res = await progress('bon-b', { referenceMonth: MONTH })
    expect(res.status).toBe(404)
    expect(res.body).toBeUndefined()
  })

  it('BON-06i: OS e comissão de B (mesmo id de funcionário e1, 99999 e 1000) nunca entram no cálculo de A', async () => {
    const revenue = await progress('bon-a', { referenceMonth: MONTH })
    expect(itemOf(revenue, 'e1').achievedAmount).toBe(5000) // com vazamento seria 104999
    const net = await progress('bon-np', { referenceMonth: MONTH })
    expect(itemOf(net, 'e1').achievedAmount).toBe(4700) // com vazamento da comissão de B seria 3700 ou mais
  })
})
