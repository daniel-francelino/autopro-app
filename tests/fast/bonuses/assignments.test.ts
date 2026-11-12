// POST /api/bonuses/:id/assignments e DELETE /api/bonuses/:id/assignments/:employeeId contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 3 (BON-05d, BON-15, BON-05e, BON-06f, BON-05f, BON-05g, BON-06g).
// Padrão de referência: tests/fast/bonuses/generate.test.ts.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { baseSeed, USERS, MONTH, type Persona } from '../../support/bonuses-fixture'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const ASSIGN = 'server/api/bonuses/[id]/assignments.post.ts'
const UNASSIGN = 'server/api/bonuses/[id]/assignments/[employeeId].delete.ts'

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

function seed() {
  const s = baseSeed()
  // BON-15: funcionário deletado de A.
  s.employees.push({ id: 'e-del', organization_id: 'org-a', name: 'Duda (deletada)', deleted_at: '2026-08-01T00:00:00Z' })
  // BON-05f: pagamento já gerado para e1 (registro financeiro + geração), que precisa sobreviver à desatribuição.
  s.employee_financial_records.push({ id: 'efr-1', organization_id: 'org-a', employee_id: 'e1', record_type: 'bonus', bonus_id: 'bon-a', status: 'pending', amount: 500.25, reference_date: '2026-10-15', deleted_at: null })
  s.bonus_generations.push({ id: 'gen-1', bonus_id: 'bon-a', employee_id: 'e1', reference_month: MONTH, commission_base: 'revenue', goal_amount: 3000, bonus_amount: 500.25, achieved_amount: 5000, goal_met: true, financial_record_id: 'efr-1' })
  fake = createFakeSupabase(s)
}

beforeEach(() => {
  seed()
  loginAs('owner')
  auth.refreshSession.mockReset()
})

const assign = (bonusId: string, body?: Record<string, unknown>) =>
  callHandler(ASSIGN, fakeEvent({ method: 'POST', cookies, params: { id: bonusId }, body }))
const unassign = (bonusId: string, employeeId: string) =>
  callHandler(UNASSIGN, fakeEvent({ method: 'DELETE', cookies, params: { id: bonusId, employeeId } }))

const table = (name: string) => fake.tables[name]!
const rowsOf = (bonusId: string, employeeId: string) =>
  table('bonus_employee_assignments').filter(a => a.bonus_id === bonusId && a.employee_id === employeeId)
const snap = (...names: string[]) => structuredClone(Object.fromEntries(names.map(n => [n, table(n)])))

describe('BON-05d: POST /api/bonuses/:id/assignments', () => {
  it('BON-05d: primeira atribuição -> 200 com 1 linha ativa; repetir -> 409 sem duplicar', async () => {
    const res = await assign('bon-a', { employeeId: 'e3' })
    expect(res.status).toBe(200)
    expect(rowsOf('bon-a', 'e3')).toHaveLength(1)
    expect(rowsOf('bon-a', 'e3')[0]).toMatchObject({ bonus_id: 'bon-a', employee_id: 'e3', active: true, created_by: 'owner@a.com' })

    const before = snap('bonus_employee_assignments')
    const writesBefore = fake.writes.length
    const again = await assign('bon-a', { employeeId: 'e3' })
    expect(again.status).toBe(409)
    expect(snap('bonus_employee_assignments')).toEqual(before)
    expect(fake.writes.slice(writesBefore)).toEqual([])
  })

  it('BON-05d: já ativo desde o seed (e1) -> 409', async () => {
    const res = await assign('bon-a', { employeeId: 'e1' })
    expect(res.status).toBe(409)
    expect(rowsOf('bon-a', 'e1')).toHaveLength(1)
  })

  it('BON-05d: após remoção, reativa a mesma linha (active=true, deleted_at=null) sem inserir outra', async () => {
    expect((await assign('bon-a', { employeeId: 'e3' })).status).toBe(200)
    const originalId = rowsOf('bon-a', 'e3')[0]!.id
    expect((await unassign('bon-a', 'e3')).status).toBe(200)
    expect(rowsOf('bon-a', 'e3')[0]).toMatchObject({ active: false })

    const writesBefore = fake.writes.length
    const res = await assign('bon-a', { employeeId: 'e3' })
    expect(res.status).toBe(200)

    const rows = rowsOf('bon-a', 'e3')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: originalId, active: true, deleted_at: null, deleted_by: null })
    expect(fake.writes.slice(writesBefore).map(w => w.op)).toEqual(['update'])
  })
})

describe('BON-15: POST assignments - validação de entrada', () => {
  it.each([
    ['sem corpo', undefined],
    ['sem employeeId', {}],
    ['employeeId vazio', { employeeId: '' }],
    ['employeeId só espaços', { employeeId: '   ' }]
  ])('BON-15: %s -> 400 e nada inserido', async (_label, body) => {
    const before = snap('bonus_employee_assignments')
    const res = await assign('bon-a', body as Record<string, unknown> | undefined)
    expect(res.status).toBe(400)
    expect(snap('bonus_employee_assignments')).toEqual(before)
    expect(fake.writes).toEqual([])
  })

  it.each([
    ['funcionário inexistente', 'nao-existe'],
    ['funcionário deletado', 'e-del']
  ])('BON-15: %s -> 404 e nada inserido', async (_label, employeeId) => {
    const before = snap('bonus_employee_assignments')
    const res = await assign('bon-a', { employeeId })
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Funcionário não encontrado')
    expect(snap('bonus_employee_assignments')).toEqual(before)
    expect(fake.writes).toEqual([])
  })
})

describe('BON-05e: POST assignments - isolamento de tenant', () => {
  it('BON-05e (a): bônus de B logado em A -> 404 "Bônus não encontrado"; nenhuma atribuição criada', async () => {
    const before = snap('bonus_employee_assignments')
    const res = await assign('bon-b', { employeeId: 'e-b1' })
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Bônus não encontrado')
    expect(snap('bonus_employee_assignments')).toEqual(before)
    expect(fake.writes).toEqual([])
  })

  it('BON-05e (b): bônus de A com employeeId de B -> 404 "Funcionário não encontrado"; nenhuma atribuição criada', async () => {
    const before = snap('bonus_employee_assignments')
    const res = await assign('bon-a', { employeeId: 'e-b1' })
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Funcionário não encontrado')
    expect(rowsOf('bon-a', 'e-b1')).toHaveLength(0)
    expect(snap('bonus_employee_assignments')).toEqual(before)
    expect(fake.writes).toEqual([])
  })
})

describe('BON-06f: POST assignments - permissão', () => {
  it('BON-06f: emp-sem (sem bonuses.update) -> 403 e nada criado', async () => {
    loginAs('emp-sem')
    const res = await assign('bon-a', { employeeId: 'e3' })
    expect(res.status).toBe(403)
    expect(res.error?.statusMessage).toContain('Acesso negado')
    expect(rowsOf('bon-a', 'e3')).toHaveLength(0)
    expect(fake.writes).toEqual([])
  })
  it('BON-06f: controle - emp-upd (tem bonuses.update) atribui -> 200', async () => {
    loginAs('emp-upd')
    expect((await assign('bon-a', { employeeId: 'e3' })).status).toBe(200)
    expect(rowsOf('bon-a', 'e3')).toHaveLength(1)
  })
})

describe('BON-05f: DELETE /api/bonuses/:id/assignments/:employeeId', () => {
  it('BON-05f: 200 com soft delete (active=false, deleted_at, deleted_by); outras atribuições e pagamentos gerados permanecem', async () => {
    const othersBefore = structuredClone(rowsOf('bon-a', 'e2'))
    const paymentsBefore = snap('employee_financial_records', 'bonus_generations')
    const count = table('bonus_employee_assignments').length

    const res = await unassign('bon-a', 'e1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })

    expect(rowsOf('bon-a', 'e1')).toHaveLength(1)
    expect(rowsOf('bon-a', 'e1')[0]).toMatchObject({ id: 'as-1', active: false, deleted_by: 'owner@a.com' })
    expect(typeof rowsOf('bon-a', 'e1')[0]!.deleted_at).toBe('string')
    expect(table('bonus_employee_assignments')).toHaveLength(count) // soft: nenhuma linha removida
    expect(rowsOf('bon-a', 'e2')).toEqual(othersBefore)

    expect(snap('employee_financial_records', 'bonus_generations')).toEqual(paymentsBefore)
    expect(fake.writes.map(w => w.table)).toEqual(['bonus_employee_assignments'])
  })

  it('BON-05f: funcionário nunca atribuído (e3) -> 404 "Atribuição não encontrada"', async () => {
    const before = snap('bonus_employee_assignments')
    const res = await unassign('bon-a', 'e3')
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Atribuição não encontrada')
    expect(snap('bonus_employee_assignments')).toEqual(before)
  })

  it('BON-05f: funcionário de B nunca atribuído ao bônus de A -> 404', async () => {
    const res = await unassign('bon-a', 'e-b1')
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Atribuição não encontrada')
  })

  // KF-51: a segunda chamada casa a linha já removida (o UPDATE não filtra deleted_at), responde 200 e regrava
  // deleted_at/deleted_by. O cenário exige 404 "Atribuição não encontrada".
  it.fails('BON-05f: segunda chamada para a mesma atribuição -> 404 "Atribuição não encontrada" (KF-51)', async () => {
    expect((await unassign('bon-a', 'e1')).status).toBe(200)
    const res = await unassign('bon-a', 'e1')
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Atribuição não encontrada')
  })
})

describe('BON-05g: DELETE assignments - isolamento de tenant', () => {
  it('BON-05g: bônus de B logado em A -> 404 "Bônus não encontrado"; atribuição de B intacta', async () => {
    const before = structuredClone(rowsOf('bon-b', 'e-b1'))
    const res = await unassign('bon-b', 'e-b1')
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Bônus não encontrado')
    expect(rowsOf('bon-b', 'e-b1')).toEqual(before)
    expect(rowsOf('bon-b', 'e-b1')[0]).toMatchObject({ active: true, deleted_at: null })
    expect(fake.writes).toEqual([])
  })
})

describe('BON-06g: DELETE assignments - permissão', () => {
  it('BON-06g: emp-sem -> 403 e atribuição intacta', async () => {
    loginAs('emp-sem')
    const before = structuredClone(rowsOf('bon-a', 'e1'))
    const res = await unassign('bon-a', 'e1')
    expect(res.status).toBe(403)
    expect(res.error?.statusMessage).toContain('Acesso negado')
    expect(rowsOf('bon-a', 'e1')).toEqual(before)
    expect(fake.writes).toEqual([])
  })
  it('BON-06g: controle - emp-upd (tem bonuses.update) remove -> 200', async () => {
    loginAs('emp-upd')
    expect((await unassign('bon-a', 'e1')).status).toBe(200)
    expect(rowsOf('bon-a', 'e1')[0]).toMatchObject({ active: false })
  })
})
