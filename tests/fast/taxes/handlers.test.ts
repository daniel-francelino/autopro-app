// Handlers de /api/taxes (GET, POST, PUT/:id, DELETE/:id) contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g3.md, seção 1 (TAX-xx). Padrão: tests/fast/bank-accounts/handlers.test.ts.
//  - 401 sem sessão já é provado por guard-matrix.test.ts; não se repete aqui.
//  - it.fails = comportamento correto ainda não implementado (ver docs/testing/known-failures.md, KF-65 a KF-67).
//    Ao corrigir o handler o Vitest acusa "unexpected pass": troque it.fails por it.
//  - Limitações do fake: `or()` é no-op (search não provável); `failNext` falha a PRÓXIMA consulta da tabela
//    (a pré-checagem), não o update (TAX-18); `range()` só limita, não pagina por offset.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const LIST = 'server/api/taxes/index.get.ts'
const CREATE = 'server/api/taxes/index.post.ts'
const UPDATE = 'server/api/taxes/[id].put.ts'
const REMOVE = 'server/api/taxes/[id].delete.ts'

type Persona = 'owner' | 'emp-sem' | 'emp-com'
const USERS: Record<Persona, { id: string, email: string }> = {
  owner: { id: 'u-owner', email: 'owner@a.com' },
  'emp-sem': { id: 'u-emp', email: 'emp@a.com' },
  'emp-com': { id: 'u-empcom', email: 'empcom@a.com' }
}

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

const DELETED_AT = '2026-01-01T00:00:00.000Z'

function seed() {
  fake = createFakeSupabase({
    user_profiles: [
      { id: 'p-owner', user_id: 'u-owner', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true, employee_id: null },
      { id: 'p-emp', user_id: 'u-emp', organization_id: 'org-a', role_id: 'r-operador', is_owner: false, is_active: true, employee_id: null },
      { id: 'p-empcom', user_id: 'u-empcom', organization_id: 'org-a', role_id: 'r-com', is_owner: false, is_active: true, employee_id: null }
    ],
    roles: [
      { id: 'r-operador', name: 'operador', is_system_role: false },
      { id: 'r-com', name: 'com-permissao', is_system_role: false }
    ],
    // emp-com: role da org A com taxes.update concedida (ActionCode.TAXES_UPDATE).
    actions: [
      { id: 'act-0', code: 'taxes.update', deleted_at: null }
    ],
    role_actions: [
      { role_id: 'r-com', action_id: 'act-0', is_granted: true }
    ],
    taxes: [
      { id: 't1', organization_id: 'org-a', name: 'ISS', type: 'municipal', rate: 5, created_at: '2026-01-01', created_by: 'x@a.com', deleted_at: null },
      { id: 't2', organization_id: 'org-a', name: 'PIS', type: 'federal', rate: 1.65, created_at: '2026-01-02', created_by: 'x@a.com', deleted_at: null },
      { id: 't3', organization_id: 'org-a', name: 'Antigo', type: 'federal', rate: 9, created_at: '2026-01-03', created_by: 'x@a.com', deleted_at: DELETED_AT, deleted_by: 'x@a.com' },
      { id: 'b1', organization_id: 'org-b', name: 'ISS B', type: 'municipal', rate: 3, created_at: '2026-01-04', created_by: 'y@b.com', deleted_at: null }
    ],
    // OS antiga com snapshot de imposto (TAX-02a/02c). O handler de taxes nunca lê nem escreve aqui.
    service_orders: [
      { id: 'os-old', organization_id: 'org-a', apply_taxes: true, total_taxes_amount: 50, total_amount: 1000, status: 'completed' }
    ]
  })
}

beforeEach(() => {
  seed()
  loginAs('owner')
  auth.refreshSession.mockReset()
})

const taxes = () => fake.tables.taxes!
const row = (id: string) => taxes().find(t => t.id === id)!
const taxWrites = () => fake.writes.filter(w => w.table === 'taxes')
const list = (query: Record<string, unknown> = {}) => callHandler(LIST, fakeEvent({ cookies, query }))
const create = (body: unknown) => callHandler(CREATE, fakeEvent({ method: 'POST', cookies, body }))
const update = (id: string, body: unknown) => callHandler(UPDATE, fakeEvent({ method: 'PUT', cookies, params: { id }, body }))
const remove = (id: string) => callHandler(REMOVE, fakeEvent({ method: 'DELETE', cookies, params: { id } }))
type ListBody = { items: Array<Record<string, any>>, total: number, page: number, page_size: number }

describe('TAX-03: tenant isolation (organization_id from the client is ignored)', () => {
  it('TAX-03a: GET logged in A with ?organization_id=org-b -> only A items', async () => {
    const res = await list({ organization_id: 'org-b' })
    expect(res.status).toBe(200)
    const body = res.body as ListBody
    expect(body.items.map(i => i.id).sort()).toEqual(['t1', 't2'])
    expect(body.items.every(i => i.organization_id === 'org-a')).toBe(true)
  })

  it('TAX-03b: POST logged in A with organization_id=org-b in body -> created in A, nothing in B', async () => {
    const res = await create({ name: 'ISS2', type: 'municipal', rate: 2, organization_id: 'org-b' })
    expect(res.status).toBe(200)
    expect((res.body as { item: Record<string, any> }).item.organization_id).toBe('org-a')
    expect(taxes().filter(t => t.organization_id === 'org-b')).toHaveLength(1) // só o b1 do seed
    expect(taxes().filter(t => t.name === 'ISS2').map(t => t.organization_id)).toEqual(['org-a'])
  })

  it('TAX-03c: PUT on a B tax logged in A -> 404, name and rate of B intact', async () => {
    const before = structuredClone(row('b1'))
    const res = await update('b1', { name: 'Hack', rate: 99 })
    expect(res.status).toBe(404)
    expect(row('b1')).toEqual(before)
    expect(taxWrites()).toHaveLength(0)
  })

  it('TAX-03d: PUT ignores organization_id, deleted_at, created_by (only name/type/rate)', async () => {
    const res = await update('t1', { name: 'ISS novo', organization_id: 'org-b', deleted_at: DELETED_AT, created_by: 'hacker@x.com' })
    expect(res.status).toBe(200)
    expect(row('t1')).toMatchObject({ name: 'ISS novo', organization_id: 'org-a', deleted_at: null, created_by: 'x@a.com' })
    expect(Object.keys(taxWrites()[0]!.values as object).sort()).toEqual(['name', 'updated_by'])
  })

  it('TAX-03e: DELETE on a B tax logged in A -> 404, B without deleted_at', async () => {
    const res = await remove('b1')
    expect(res.status).toBe(404)
    expect(row('b1').deleted_at).toBeNull()
    expect(taxWrites()).toHaveLength(0)
  })
})

describe('TAX-04: GET pagination and ordering', () => {
  it('default: excludes soft-deleted and B, total correct, sorted by name asc', async () => {
    const res = await list()
    const body = res.body as ListBody
    expect(res.status).toBe(200)
    expect(body.items.map(i => i.id)).toEqual(['t1', 't2']) // ISS, PIS
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
  })
  it('sort_by=rate&sort_order=desc -> highest rate first', async () => {
    const body = (await list({ sort_by: 'rate', sort_order: 'desc' })).body as ListBody
    expect(body.items.map(i => i.id)).toEqual(['t1', 't2'])
    const asc = (await list({ sort_by: 'rate', sort_order: 'asc' })).body as ListBody
    expect(asc.items.map(i => i.id)).toEqual(['t2', 't1'])
  })
  it('invalid sort_by falls back to name', async () => {
    const body = (await list({ sort_by: 'organization_id; drop', sort_order: 'desc' })).body as ListBody
    expect(body.items.map(i => i.name)).toEqual(['PIS', 'ISS'])
  })
  it('page_size=500 is capped at 100; total stays correct', async () => {
    const body = (await list({ page_size: 500 })).body as ListBody
    expect(body.page_size).toBe(100)
    expect(body.total).toBe(2)
  })
  it('page_size=1 limits the items but total counts all', async () => {
    const body = (await list({ page_size: 1 })).body as ListBody
    expect(body.items).toHaveLength(1)
    expect(body.total).toBe(2)
  })
  it('page=0 is raised to 1', async () => {
    const body = (await list({ page: 0 })).body as ListBody
    expect(body.page).toBe(1)
  })
  it.todo('TAX-04: search by name and type (fake não prova .or(): `or()` é no-op)')
})

describe('TAX-05 / TAX-06 / TAX-10 / TAX-02b / TAX-18: not asserted', () => {
  it.todo('TAX-05: search with `,` `)` `%` does not break/widen the .or() filter (fake não prova .or(); G3-SD-03 hipótese)')
  it.todo('TAX-06: GET as emp-sem (today 200, login only). Awaiting G3-OQ-01')
  it.todo('TAX-10: POST duplicate name+type. Awaiting G3-OQ-04 (unicidade no banco fica em db)')
  it.todo('TAX-02b: how tax becomes total_taxes_amount and reduces commission base. Awaiting G3-OQ-05')
  it.todo('TAX-18: DELETE with failing update -> 500, nothing marked (limitação do fake: failNext falha a pré-checagem, não o update; vira 404)')
  it.todo('TAX-01a (\'5\' numeric string): accept or reject. Awaiting G3-OQ-02')
  it.todo('TAX-01b (type outside valid set): Awaiting G3-OQ-03')
})

describe('TAX-07: POST creates the tax', () => {
  it('200 {item}, organization_id = A, created_by/updated_by = session e-mail, rate as sent', async () => {
    const res = await create({ name: 'ISS', type: 'municipal', rate: 5 })
    expect(res.status).toBe(200)
    const item = (res.body as { item: Record<string, any> }).item
    expect(item).toMatchObject({ name: 'ISS', type: 'municipal', rate: 5, organization_id: 'org-a', created_by: 'owner@a.com', updated_by: 'owner@a.com' })
    expect(taxes().find(t => t.id === item.id)!.rate).toBe(5)
  })
  it('rate with decimals is persisted without rounding', async () => {
    const res = await create({ name: 'X', type: 'federal', rate: 1.6543 })
    expect(res.status).toBe(200)
    expect((res.body as { item: Record<string, any> }).item.rate).toBe(1.6543)
  })
})

describe('TAX-08: POST required fields', () => {
  const cases: Array<[string, unknown]> = [
    ['without name', { type: 'municipal', rate: 5 }],
    ['without type', { name: 'ISS', rate: 5 }],
    ['without rate', { name: 'ISS', type: 'municipal' }],
    ['rate null', { name: 'ISS', type: 'municipal', rate: null }],
    ['empty body', {}]
  ]
  for (const [label, body] of cases) {
    it(`TAX-08: ${label} -> 400 "name, type e rate são obrigatórios", nothing inserted`, async () => {
      const res = await create(body)
      expect(res.status).toBe(400)
      expect(res.error?.statusMessage).toBe('name, type e rate são obrigatórios')
      expect(taxWrites()).toHaveLength(0)
    })
  }
})

describe('TAX-09: POST rate 0', () => {
  // Caracteriza o comportamento ATUAL (zero aceito). Se zero é válido de fato: G3-OQ-02.
  it('TAX-09: rate 0 -> 200 with rate 0 (current behavior; rule pending G3-OQ-02)', async () => {
    const res = await create({ name: 'Isento', type: 'municipal', rate: 0 })
    expect(res.status).toBe(200)
    expect((res.body as { item: Record<string, any> }).item.rate).toBe(0)
  })
})

describe('TAX-12: PUT partial update', () => {
  it('only name: name changes, type/rate intact, updated_by filled', async () => {
    const res = await update('t1', { name: 'ISS 2' })
    expect(res.status).toBe(200)
    expect(row('t1')).toMatchObject({ name: 'ISS 2', type: 'municipal', rate: 5, updated_by: 'owner@a.com' })
  })
  it('only rate 7.5: persisted exactly, name/type intact', async () => {
    const res = await update('t1', { rate: 7.5 })
    expect(res.status).toBe(200)
    expect(row('t1')).toMatchObject({ name: 'ISS', type: 'municipal', rate: 7.5, updated_by: 'owner@a.com' })
  })
  it('{} -> 200, only updated_by is written', async () => {
    const before = structuredClone(row('t1'))
    const res = await update('t1', {})
    expect(res.status).toBe(200)
    expect(taxWrites()[0]!.values).toEqual({ updated_by: 'owner@a.com' })
    expect(row('t1')).toEqual({ ...before, updated_by: 'owner@a.com' })
  })
})

describe('TAX-13: PUT not found', () => {
  for (const [label, id] of [['nonexistent', 'nope'], ['soft-deleted', 't3']] as const) {
    it(`TAX-13: ${label} id -> 404 "Registro não encontrado", nothing changed`, async () => {
      const before = structuredClone(taxes())
      const res = await update(id, { name: 'X', rate: 1 })
      expect(res.status).toBe(404)
      expect(res.error?.statusMessage).toBe('Registro não encontrado')
      expect(taxes()).toEqual(before)
      expect(taxWrites()).toHaveLength(0)
    })
  }
})

describe('TAX-15 / TAX-16: DELETE (soft)', () => {
  it('TAX-15: 200 {success:true}, deleted_at and deleted_by set, gone from GET, row still in table', async () => {
    const res = await remove('t1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(row('t1').deleted_at).toBeTruthy()
    expect(row('t1').deleted_by).toBe('owner@a.com')
    const body = (await list()).body as ListBody
    expect(body.items.map(i => i.id)).toEqual(['t2'])
    expect(taxes().some(t => t.id === 't1')).toBe(true)
  })
  it('TAX-16: second DELETE -> 404, original deleted_at kept', async () => {
    await remove('t1')
    const first = row('t1').deleted_at
    const writes = taxWrites().length
    const res = await remove('t1')
    expect(res.status).toBe(404)
    expect(row('t1').deleted_at).toBe(first)
    expect(taxWrites()).toHaveLength(writes)
  })
  it('TAX-16: DELETE on already soft-deleted seed row -> 404, deleted_at/deleted_by untouched', async () => {
    const res = await remove('t3')
    expect(res.status).toBe(404)
    expect(row('t3')).toMatchObject({ deleted_at: DELETED_AT, deleted_by: 'x@a.com' })
  })
  it('TAX-16: DELETE nonexistent -> 404', async () => {
    const res = await remove('nope')
    expect(res.status).toBe(404)
    expect(taxWrites()).toHaveLength(0)
  })
})

describe('TAX-02a / TAX-02c: historical OS keeps its tax snapshot', () => {
  // Prova só o contrato do handler: não toca em service_orders. Recálculo de comissão não modelado (ver limitações).
  const osSnapshot = () => structuredClone(fake.tables.service_orders)
  it.todo('TAX-02a (comissão/relatório): não modelado; depende de G3-OQ-05 e da lógica de service-order-commissions')
  it.todo('TAX-02c (comissão/relatório): não modelado; depende de G3-OQ-05 e da lógica de service-order-commissions')
  it('TAX-02a (contrato): PUT de imposto não toca service_orders (PUT rate 5 -> 10 leaves old OS total_taxes_amount untouched and writes only to taxes)', async () => {
    const before = osSnapshot()
    const res = await update('t1', { rate: 10 })
    expect(res.status).toBe(200)
    expect(row('t1').rate).toBe(10)
    expect(fake.tables.service_orders).toEqual(before)
    expect(fake.tables.service_orders![0]!.total_taxes_amount).toBe(50)
    expect(fake.writes.every(w => w.table === 'taxes')).toBe(true)
  })
  it('TAX-02c (contrato): DELETE de imposto não toca service_orders; DELETE of a tax used by an old OS leaves OS untouched (does not assert whether deletion should be blocked: G3-OQ-06)', async () => {
    const before = osSnapshot()
    const res = await remove('t1')
    expect(res.status).toBe(200)
    expect(fake.tables.service_orders).toEqual(before)
    expect(fake.writes.every(w => w.table === 'taxes')).toBe(true)
  })
})

describe('TAX-01a: POST rate validation (KF-65, G3-SD-01)', () => {
  // Number.NaN não é alcançável via HTTP/JSON (JSON.stringify(NaN) vira null -> 400 do TAX-08);
  // o caso fica como documentação de contrato no fake. 'abc' no Postgres numérico daria erro 500, não gravação.
  for (const rate of [-5, 100.01, 1000, 'abc', Number.NaN]) {
    it.fails(`TAX-01a: rate ${String(rate)} -> 400 and nothing persisted [KF-65]`, async () => {
      const res = await create({ name: 'Inv', type: 'municipal', rate })
      expect(res.status).toBe(400)
      expect(taxes().filter(t => t.name === 'Inv')).toHaveLength(0)
    })
  }
})

describe('TAX-01b: POST name/type must be strings (KF-65, G3-SD-01)', () => {
  const bad: Array<[string, unknown]> = [['number', 123], ['object', { a: 1 }], ['array', ['x']]]
  for (const [label, v] of bad) {
    it.fails(`TAX-01b: name as ${label} -> 400 and nothing persisted [KF-65]`, async () => {
      const res = await create({ name: v, type: 'municipal', rate: 5 })
      expect(res.status).toBe(400)
      expect(taxWrites()).toHaveLength(0)
    })
    it.fails(`TAX-01b: type as ${label} -> 400 and nothing persisted [KF-65]`, async () => {
      const res = await create({ name: 'Ok', type: v, rate: 5 })
      expect(res.status).toBe(400)
      expect(taxWrites()).toHaveLength(0)
    })
  }
})

describe('TAX-01c: PUT rate validation (KF-65, G3-SD-01)', () => {
  for (const rate of [-1, 150, 'abc', null, '']) {
    it.fails(`TAX-01c: rate ${JSON.stringify(rate)} -> 400 and rate stays 5 [KF-65]`, async () => {
      const res = await update('t1', { rate })
      expect(res.status).toBe(400)
      expect(row('t1').rate).toBe(5)
    })
  }
})

describe('TAX-01d: PUT empty name/type (KF-66, G3-SD-02)', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['name ""', { name: '' }],
    ['name null', { name: null }],
    ['type ""', { type: '' }]
  ]
  for (const [label, body] of cases) {
    it.fails(`TAX-01d: ${label} -> 400 and name/type stay filled [KF-66]`, async () => {
      const res = await update('t1', body)
      expect(res.status).toBe(400)
      expect(row('t1')).toMatchObject({ name: 'ISS', type: 'municipal' })
    })
  }
})

describe('TAX-11 / TAX-14 / TAX-17: emp-sem must not write (KF-09, KF-67)', () => {
  beforeEach(() => loginAs('emp-sem'))
  it('TAX-11: POST as emp-sem -> 403 [KF-67]', async () => {
    const res = await create({ name: 'ISS3', type: 'municipal', rate: 2 })
    expect(res.status).toBe(403)
  })
  it('TAX-14: PUT as emp-sem -> 403 [KF-67]', async () => {
    const res = await update('t1', { rate: 8 })
    expect(res.status).toBe(403)
  })
  it('TAX-17: DELETE as emp-sem -> 403 [KF-67]', async () => {
    const res = await remove('t1')
    expect(res.status).toBe(403)
  })
})

// Fase 3 do plano de acesso: POST/PUT/DELETE exigem taxes.update (KF-67 corrigido); GET fica só org (D1).
// action-codes.ts define só taxes.view e taxes.update; a página app/pages/app/financial/taxes.vue usa taxes.update
// para criar/editar/excluir, então a mesma chave é usada nas três rotas. A equivalência vem do front, não de um guarda no servidor.
describe('TAX-11 / TAX-14 / TAX-17: emp-com (taxes.update) -> 200', () => {
  beforeEach(() => loginAs('emp-com'))
  const T = 'caracteriza comportamento atual; chave taxes.update definida em action-codes.ts, handler sem guarda (KF-09)'
  it(`TAX-11: POST como emp-com -> 200 (${T})`, async () => {
    const res = await create({ name: 'ISS3', type: 'municipal', rate: 2 })
    expect(res.status).toBe(200)
  })
  it(`TAX-14: PUT como emp-com -> 200 (${T})`, async () => {
    const res = await update('t1', { rate: 8 })
    expect(res.status).toBe(200)
  })
  it(`TAX-17: DELETE como emp-com -> 200 (${T})`, async () => {
    const res = await remove('t1')
    expect(res.status).toBe(200)
  })
})
