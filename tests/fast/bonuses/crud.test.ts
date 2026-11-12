// CRUD de /api/bonuses contra o fake em memória: GET/POST /api/bonuses e GET/PUT/DELETE /api/bonuses/:id.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 3 (BON-07..13, BON-05a/b/c, BON-06a..e, BON-14).
// Padrão de referência: tests/fast/bonuses/generate.test.ts.
//  - BON-14 (efeito do DELETE sobre pagamentos gerados) depende de G1-OQ-07: it.todo.
//  - Os GETs que resolvem "valor vigente" dependem do mês corrente: a data é fixada com fake timers (só Date).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { baseSeed, USERS, type Persona } from '../../support/bonuses-fixture'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const LIST = 'server/api/bonuses/index.get.ts'
const CREATE = 'server/api/bonuses/index.post.ts'
const DETAIL = 'server/api/bonuses/[id].get.ts'
const UPDATE = 'server/api/bonuses/[id].put.ts'
const REMOVE = 'server/api/bonuses/[id].delete.ts'

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

function seed() {
  const s = baseSeed()
  // O seed compartilhado só tem read/update/delete. A ação de criação existe de verdade, sem grant para ninguém:
  // o 403 de emp-sem/emp-upd no POST é "Acesso negado" (e não "Permissão não reconhecida").
  s.actions.push({ id: 'act-create', code: 'bonuses.create', deleted_at: null })
  // BON-07/BON-12: bônus deletado de A (com versão e atribuição ativa) e atribuição removida em bon-a.
  s.bonuses.push({ id: 'bon-a-del', organization_id: 'org-a', name: 'Meta apagada', active: true, due_day: null, deleted_at: '2026-09-01T00:00:00Z' })
  s.bonus_value_versions.push({ id: 'v-del', bonus_id: 'bon-a-del', commission_base: 'profit', goal_amount: 1, bonus_amount: 1, effective_from: '2026-01-01' })
  s.bonus_employee_assignments.push(
    { id: 'as-del', bonus_id: 'bon-a-del', employee_id: 'e1', active: true, deleted_at: null },
    { id: 'as-removed', bonus_id: 'bon-a', employee_id: 'e3', active: false, deleted_at: '2026-09-02T00:00:00Z' }
  )
  fake = createFakeSupabase(s)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T12:00:00')) // mês corrente = 2026-10-01
  seed()
  loginAs('owner')
  auth.refreshSession.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

const list = () => callHandler(LIST, fakeEvent({ cookies }))
const create = (body?: Record<string, unknown>) => callHandler(CREATE, fakeEvent({ method: 'POST', cookies, body }))
const detail = (id: string) => callHandler(DETAIL, fakeEvent({ cookies, params: { id } }))
const update = (id: string, body?: Record<string, unknown>) => callHandler(UPDATE, fakeEvent({ method: 'PUT', cookies, params: { id }, body }))
const remove = (id: string) => callHandler(REMOVE, fakeEvent({ method: 'DELETE', cookies, params: { id } }))

const table = (name: string) => fake.tables[name]!
const bonusRow = (id: string) => table('bonuses').find(b => b.id === id)!
const snap = (...names: string[]) => structuredClone(Object.fromEntries(names.map(n => [n, table(n)])))

const VALID = { name: 'Meta nova', commissionBase: 'profit', goalAmount: 2000, bonusAmount: 150.5, dueDay: 10 }

type ListItem = { id: string, name: string, assignedEmployeesCount: number, assignedEmployees: Array<{ id: string, name: string }>, currentValue: Record<string, unknown> | null }

describe('BON-07: GET /api/bonuses', () => {
  it('BON-07: só bônus vivos de A, com valor vigente do mês e funcionários ativos; B e deletado nunca aparecem', async () => {
    const res = await list()
    expect(res.status).toBe(200)
    const items = (res.body as { items: ListItem[] }).items

    expect(items.map(i => i.id)).toEqual(['bon-a', 'bon-a2'])

    const a = items.find(i => i.id === 'bon-a')!
    // Vigente em out/2026 = v-new (jun). Tripwire literal: v-old pagaria 100, v-future (dez) 777.
    expect(a.currentValue).toEqual({ commissionBase: 'revenue', goalAmount: 3000, bonusAmount: 500.25, effectiveFrom: '2026-06-01' })
    // e3 foi removida (active=false + deleted_at) e não conta.
    expect(a.assignedEmployeesCount).toBe(2)
    expect(a.assignedEmployees.map(e => e.id)).toEqual(['e1', 'e2'])
    expect(a.assignedEmployees.map(e => e.name)).toEqual(['Ana (atinge meta)', 'Beto (nao atinge)'])

    const a2 = items.find(i => i.id === 'bon-a2')!
    expect(a2.currentValue).toBeNull()
    expect(a2.assignedEmployeesCount).toBe(0)

    expect(JSON.stringify(items)).not.toContain('Meta B')
    expect(JSON.stringify(items)).not.toContain('Meta apagada')
    expect(fake.writes).toEqual([])
  })
})

describe('BON-08: POST /api/bonuses válido', () => {
  it('BON-08: 200; bônus em A com os dados do corpo e exatamente 1 versão inicial com os mesmos valores', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)

    const item = (res.body as { item: Record<string, any> }).item
    const created = table('bonuses').filter(b => b.name === 'Meta nova')
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ id: item.id, organization_id: 'org-a', name: 'Meta nova', active: true, due_day: 10, created_by: 'owner@a.com' })

    const versions = table('bonus_value_versions').filter(v => v.bonus_id === item.id)
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({ commission_base: 'profit', goal_amount: 2000, bonus_amount: 150.5, effective_from: '2026-10-01', created_by: 'owner@a.com' })
    expect(item.currentValue).toMatchObject({ id: versions[0]!.id, goal_amount: 2000, bonus_amount: 150.5 })
  })

  it('BON-08: name é aparado e dueDay ausente grava null', async () => {
    const res = await create({ ...VALID, name: '  Meta aparada  ', dueDay: undefined })
    expect(res.status).toBe(200)
    expect(table('bonuses').find(b => b.name === 'Meta aparada')).toMatchObject({ organization_id: 'org-a', due_day: null })
  })
})

describe('BON-09: POST /api/bonuses inválido', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['name vazio', { ...VALID, name: '' }],
    ['name só espaços', { ...VALID, name: '   ' }],
    ['name ausente', { ...VALID, name: undefined }],
    ['commissionBase inválido', { ...VALID, commissionBase: 'lucro' }],
    ['commissionBase ausente', { ...VALID, commissionBase: undefined }],
    ['goalAmount 0', { ...VALID, goalAmount: 0 }],
    ['goalAmount negativo', { ...VALID, goalAmount: -10 }],
    ['goalAmount NaN', { ...VALID, goalAmount: Number.NaN }],
    ['goalAmount string', { ...VALID, goalAmount: 'abc' }],
    ['bonusAmount 0', { ...VALID, bonusAmount: 0 }],
    ['bonusAmount negativo', { ...VALID, bonusAmount: -1 }],
    ['bonusAmount NaN', { ...VALID, bonusAmount: Number.NaN }],
    ['bonusAmount string', { ...VALID, bonusAmount: 'abc' }],
    ['dueDay 0', { ...VALID, dueDay: 0 }],
    ['dueDay 32', { ...VALID, dueDay: 32 }],
    ['dueDay 1.5', { ...VALID, dueDay: 1.5 }]
  ]

  it.each(cases)('BON-09: %s -> 400 e nada inserido', async (_label, body) => {
    const before = snap('bonuses', 'bonus_value_versions')
    const res = await create(body)
    expect(res.status).toBe(400)
    expect(snap('bonuses', 'bonus_value_versions')).toEqual(before)
    expect(fake.writes).toEqual([])
  })
})

describe('BON-10: compensação quando o insert da versão falha', () => {
  it('BON-10: 500 e o bônus recém-criado é removido (sem bônus órfão sem versão)', async () => {
    const before = snap('bonuses', 'bonus_value_versions')
    // POST não lê bonus_value_versions antes do insert da versão: a falha injetada cai exatamente nele.
    fake.failNext('bonus_value_versions', 'boom versão')

    const res = await create(VALID)
    expect(res.status).toBe(500)
    expect(res.error?.statusMessage).toContain('Failed to create bonus value')

    expect(fake.writes.filter(w => w.table === 'bonuses').map(w => w.op)).toEqual(['insert', 'delete'])
    expect(snap('bonuses', 'bonus_value_versions')).toEqual(before)
  })
})

describe('BON-11: POST ignora organization_id do corpo', () => {
  it('BON-11: organization_id=org-b no corpo -> criado em A; nada em B', async () => {
    const orgBBefore = structuredClone(table('bonuses').filter(b => b.organization_id === 'org-b'))
    const res = await create({ ...VALID, organization_id: 'org-b', organizationId: 'org-b' })
    expect(res.status).toBe(200)

    const created = table('bonuses').find(b => b.name === 'Meta nova')!
    expect(created.organization_id).toBe('org-a')
    expect(table('bonuses').filter(b => b.organization_id === 'org-b')).toEqual(orgBBefore)
    expect(table('bonus_value_versions').filter(v => v.bonus_id === 'bon-b')).toHaveLength(1)
  })
})

describe('BON-12: GET /api/bonuses/:id', () => {
  it('BON-12: 200 com identidade, valor vigente, histórico de versões e funcionários atribuídos', async () => {
    const res = await detail('bon-a')
    expect(res.status).toBe(200)
    const item = (res.body as { item: Record<string, any> }).item

    expect(item).toMatchObject({ id: 'bon-a', name: 'Meta A', active: true, dueDay: 15 })
    expect(item.currentValue).toEqual({ commissionBase: 'revenue', goalAmount: 3000, bonusAmount: 500.25, effectiveFrom: '2026-06-01' })
    // Histórico completo (append-only), da mais nova para a mais antiga.
    expect(item.valueHistory.map((v: any) => v.id)).toEqual(['v-future', 'v-new', 'v-old'])
    expect(item.valueHistory[1]).toMatchObject({ goalAmount: 3000, bonusAmount: 500.25, effectiveFrom: '2026-06-01' })
    // A atribuição removida (deleted_at) não aparece.
    expect(item.assignments.map((a: any) => [a.employeeId, a.employeeName, a.active])).toEqual([
      ['e1', 'Ana (atinge meta)', true],
      ['e2', 'Beto (nao atinge)', true]
    ])
  })

  it('BON-12: id inexistente -> 404', async () => {
    const res = await detail('nao-existe')
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Bônus não encontrado')
  })

  it('BON-12: bônus deletado -> 404', async () => {
    const res = await detail('bon-a-del')
    expect(res.status).toBe(404)
  })
})

describe('BON-13: PUT /api/bonuses/:id', () => {
  it('BON-13: PUT {name} -> 200; só o nome muda e as versões de valor não são tocadas', async () => {
    const versionsBefore = snap('bonus_value_versions')
    const res = await update('bon-a', { name: '  Nome novo  ' })
    expect(res.status).toBe(200)

    expect(bonusRow('bon-a')).toMatchObject({ name: 'Nome novo', due_day: 15, active: true, organization_id: 'org-a', updated_by: 'owner@a.com' })
    expect(snap('bonus_value_versions')).toEqual(versionsBefore)
    expect(fake.writes.map(w => w.table)).toEqual(['bonuses'])
  })

  it('BON-13: valores no corpo (goalAmount, bonusAmount, commissionBase) são ignorados', async () => {
    const versionsBefore = snap('bonus_value_versions')
    const res = await update('bon-a', { name: 'X', goalAmount: 1, bonusAmount: 1, commissionBase: 'profit' })
    expect(res.status).toBe(200)
    expect(snap('bonus_value_versions')).toEqual(versionsBefore)
    expect(bonusRow('bon-a')).not.toHaveProperty('goal_amount')
  })

  it.each([
    ['name vazio', { name: '' }],
    ['name só espaços', { name: '   ' }],
    ['dueDay 0', { dueDay: 0 }],
    ['dueDay 32', { dueDay: 32 }],
    ['dueDay 1.5', { dueDay: 1.5 }]
  ])('BON-13: %s -> 400 e bônus inalterado', async (_label, body) => {
    const before = structuredClone(bonusRow('bon-a'))
    const res = await update('bon-a', body)
    expect(res.status).toBe(400)
    expect(bonusRow('bon-a')).toEqual(before)
    expect(fake.writes).toEqual([])
  })

  it('BON-13: id inexistente -> 404', async () => {
    const res = await update('nao-existe', { name: 'X' })
    expect(res.status).toBe(404)
    expect(fake.writes).toEqual([])
  })
})

describe('BON-05a/b/c: isolamento de tenant (bônus de B, logado em A)', () => {
  it('BON-05a: GET /:id de bônus de B -> 404', async () => {
    const res = await detail('bon-b')
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Bônus não encontrado')
  })

  it('BON-05b: PUT de bônus de B -> 404 e linha de B idêntica', async () => {
    const before = structuredClone(bonusRow('bon-b'))
    const res = await update('bon-b', { name: 'Invadido', active: false, dueDay: 5 })
    expect(res.status).toBe(404)
    expect(bonusRow('bon-b')).toEqual(before)
    expect(fake.writes).toEqual([])
  })

  it('BON-05c: DELETE de bônus de B -> 404 e B sem deleted_at', async () => {
    const before = structuredClone(bonusRow('bon-b'))
    const res = await remove('bon-b')
    expect(res.status).toBe(404)
    expect(bonusRow('bon-b')).toEqual(before)
    expect(bonusRow('bon-b').deleted_at).toBeNull()
    expect(fake.writes).toEqual([])
  })
})

describe('BON-06a..e: permissão por perfil', () => {
  const personasDenied: Persona[] = ['emp-sem', 'emp-upd']

  it.each(personasDenied)('BON-06a: GET lista por %s (sem bonuses.read) -> 403', async (persona) => {
    loginAs(persona)
    const res = await list()
    expect(res.status).toBe(403)
    expect(res.error?.statusMessage).toContain('Acesso negado')
  })
  it.each(['owner', 'admin'] as Persona[])('BON-06a: GET lista por %s -> 200', async (persona) => {
    loginAs(persona)
    expect((await list()).status).toBe(200)
  })

  it.each(personasDenied)('BON-06b: POST por %s (sem bonuses.create) -> 403 e nada criado', async (persona) => {
    loginAs(persona)
    const res = await create(VALID)
    expect(res.status).toBe(403)
    expect(res.error?.statusMessage).toContain('Acesso negado')
    expect(fake.writes).toEqual([])
  })
  it.each(['owner', 'admin'] as Persona[])('BON-06b: POST por %s -> 200', async (persona) => {
    loginAs(persona)
    expect((await create(VALID)).status).toBe(200)
  })

  it.each(personasDenied)('BON-06c: GET /:id por %s -> 403', async (persona) => {
    loginAs(persona)
    const res = await detail('bon-a')
    expect(res.status).toBe(403)
  })

  it('BON-06d: PUT por emp-sem (sem bonuses.update) -> 403 e bônus inalterado', async () => {
    loginAs('emp-sem')
    const before = structuredClone(bonusRow('bon-a'))
    const res = await update('bon-a', { name: 'X' })
    expect(res.status).toBe(403)
    expect(res.error?.statusMessage).toContain('Acesso negado')
    expect(bonusRow('bon-a')).toEqual(before)
  })
  it('BON-06d: controle - emp-upd (tem bonuses.update) edita -> 200', async () => {
    loginAs('emp-upd')
    expect((await update('bon-a', { name: 'Editado' })).status).toBe(200)
    expect(bonusRow('bon-a').name).toBe('Editado')
  })

  it.each(personasDenied)('BON-06e: DELETE por %s (sem bonuses.delete) -> 403 e bônus intacto', async (persona) => {
    loginAs(persona)
    const res = await remove('bon-a')
    expect(res.status).toBe(403)
    expect(res.error?.statusMessage).toContain('Acesso negado')
    expect(bonusRow('bon-a').deleted_at).toBeNull()
    expect(fake.writes).toEqual([])
  })
  it('BON-06e: owner -> 200; soft delete com deleted_at/deleted_by e some da lista e do detalhe', async () => {
    const res = await remove('bon-a')
    expect(res.status).toBe(200)
    expect(bonusRow('bon-a')).toMatchObject({ deleted_by: 'owner@a.com' })
    expect(typeof bonusRow('bon-a').deleted_at).toBe('string')
    // Soft: a linha e as versões continuam na tabela.
    expect(table('bonus_value_versions').filter(v => v.bonus_id === 'bon-a')).toHaveLength(3)

    expect((await detail('bon-a')).status).toBe(404)
    const items = ((await list()).body as { items: ListItem[] }).items
    expect(items.map(i => i.id)).toEqual(['bon-a2'])
  })
})

describe('BON-14: DELETE de bônus com atribuições e pagamentos gerados', () => {
  it.todo('BON-14: efeito sobre pagamentos já gerados (bloquear, manter ou cancelar pendentes) - aguarda G1-OQ-07')
})
