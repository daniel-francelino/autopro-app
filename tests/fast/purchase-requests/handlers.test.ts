// Handlers de /api/purchase-requests (GET, POST, PUT/:id, DELETE/:id, :id/authorize, :id/reject) contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g2.md, seção 3 (PRQ-xx). Padrão: tests/fast/payment-terminals/handlers.test.ts.
//  - 401 sem sessão já é provado por guard-matrix.test.ts; não se repete aqui.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md, KF-55 a KF-58).
//    Ao corrigir o handler o Vitest acusa "unexpected pass": troque it.fails por it.
//  - Limitações do fake: `or()` é no-op (search não provável); `range()` só limita, não pagina por offset;
//    `select('*, suppliers(...)')` não faz join; não há FK, então supplier_id de outra org só é barrado se o handler consultar o fornecedor;
//    o `update` do fake não distingue o filtro por organização (G2-SD-09 não é provável aqui);
//    sort é comparação de string (datas ISO ordenam corretamente).
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
const LIST = 'server/api/purchase-requests/index.get.ts'
const CREATE = 'server/api/purchase-requests/index.post.ts'
const UPDATE = 'server/api/purchase-requests/[id].put.ts'
const REMOVE = 'server/api/purchase-requests/[id].delete.ts'
const AUTHORIZE = 'server/api/purchase-requests/[id]/authorize.post.ts'
const REJECT = 'server/api/purchase-requests/[id]/reject.post.ts'

type Persona = 'owner' | 'emp-sem'
const USERS: Record<Persona, { id: string, email: string }> = {
  owner: { id: 'u-owner', email: 'owner@a.com' },
  'emp-sem': { id: 'u-emp', email: 'emp@a.com' }
}

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

const DELETED_AT = '2026-01-01T00:00:00.000Z'
const ITEMS = [{ description: 'Filtro', quantity: 2, estimated_total_price: 40 }]

function req(id: string, org: string, n: number, status: string, extra: Record<string, unknown> = {}) {
  return {
    id, organization_id: org, request_number: `SOL-${String(n).padStart(5, '0')}`, request_date: `2026-02-0${n}T10:00:00.000Z`,
    supplier_id: org === 'org-a' ? 'sup-a' : 'sup-b', status, items: ITEMS, total_request_amount: 40, requester: 'x@a.com',
    justification: 'J', notes: 'N', purchase_id: null, authorization_date: null, authorized_by: null, rejection_reason: null,
    created_at: `2026-02-0${n}T10:00:00.000Z`, created_by: 'x@a.com', updated_by: 'x@a.com', deleted_at: null, deleted_by: null, ...extra
  }
}

const ALL_ROWS = () => [
  req('rq-w', 'org-a', 1, 'waiting'),
  req('rq-auth', 'org-a', 2, 'authorized', { authorization_date: '2026-02-02T12:00:00.000Z', authorized_by: 'x@a.com' }),
  req('rq-rej', 'org-a', 3, 'rejected', { rejection_reason: 'caro' }),
  req('rq-del', 'org-a', 4, 'waiting', { deleted_at: DELETED_AT, deleted_by: 'x@a.com' }),
  req('rq-b', 'org-b', 1, 'waiting')
]

function seed(rows: Array<Record<string, any>> = ALL_ROWS()) {
  fake = createFakeSupabase({
    user_profiles: [
      { id: 'p-owner', user_id: 'u-owner', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true, employee_id: null },
      { id: 'p-emp', user_id: 'u-emp', organization_id: 'org-a', role_id: 'r-operador', is_owner: false, is_active: true, employee_id: null }
    ],
    roles: [{ id: 'r-operador', name: 'operador', is_system_role: false }],
    actions: [],
    role_actions: [],
    suppliers: [
      { id: 'sup-a', organization_id: 'org-a', name: 'Fornecedor A', deleted_at: null },
      { id: 'sup-b', organization_id: 'org-b', name: 'Fornecedor B', deleted_at: null }
    ],
    purchase_requests: rows
  })
}

beforeEach(() => {
  seed()
  loginAs('owner')
  auth.refreshSession.mockReset()
})

const requests = () => fake.tables.purchase_requests!
const row = (id: string) => requests().find(t => t.id === id)!
const prWrites = () => fake.writes.filter(w => w.table === 'purchase_requests')
const list = (query: Record<string, unknown> = {}) => callHandler(LIST, fakeEvent({ cookies, query }))
const create = (body: unknown) => callHandler(CREATE, fakeEvent({ method: 'POST', cookies, body }))
const update = (id: string, body: unknown) => callHandler(UPDATE, fakeEvent({ method: 'PUT', cookies, params: { id }, body }))
const remove = (id: string) => callHandler(REMOVE, fakeEvent({ method: 'DELETE', cookies, params: { id } }))
const authorize = (id: string) => callHandler(AUTHORIZE, fakeEvent({ method: 'POST', cookies, params: { id }, body: {} }))
const reject = (id: string, body: unknown = {}) => callHandler(REJECT, fakeEvent({ method: 'POST', cookies, params: { id }, body }))
type ListBody = { items: Array<Record<string, any>>, total: number, page: number, page_size: number }
const WRONG_STATE = 'Somente solicitações com status'

describe('PRQ-01a / PRQ-01b: authorize', () => {
  it('PRQ-01a: waiting of A -> 200, authorized, authorization_date and authorized_by = session e-mail', async () => {
    const before = Date.now()
    const res = await authorize('rq-w')
    expect(res.status).toBe(200)
    expect(row('rq-w')).toMatchObject({ status: 'authorized', authorized_by: 'owner@a.com', updated_by: 'owner@a.com', organization_id: 'org-a' })
    const when = Date.parse(row('rq-w').authorization_date)
    expect(when).toBeGreaterThanOrEqual(before)
    expect(when).toBeLessThanOrEqual(Date.now())
    expect((res.body as { item: Record<string, any> }).item).toMatchObject({ id: 'rq-w', status: 'authorized' })
    expect(prWrites()).toHaveLength(1)
  })

  for (const [label, id] of [['already authorized', 'rq-auth'], ['rejected', 'rq-rej']] as const) {
    it(`PRQ-01b: ${label} -> 400 "${WRONG_STATE}...", nothing changes`, async () => {
      const before = structuredClone(requests())
      const res = await authorize(id)
      expect(res.status).toBe(400)
      expect(res.error?.statusMessage?.startsWith(WRONG_STATE)).toBe(true)
      expect(requests()).toEqual(before)
      expect(prWrites()).toHaveLength(0)
    })
  }

  it('second authorize of the same request -> 400, authorization_date of the first kept', async () => {
    await authorize('rq-w')
    const first = row('rq-w').authorization_date
    const res = await authorize('rq-w')
    expect(res.status).toBe(400)
    expect(row('rq-w').authorization_date).toBe(first)
    expect(prWrites()).toHaveLength(1)
  })
})

describe('PRQ-01d / PRQ-01e: reject', () => {
  it('PRQ-01d: waiting of A -> 200, rejected, rejection_reason and updated_by recorded, nothing else changes', async () => {
    const before = structuredClone(row('rq-w'))
    const res = await reject('rq-w', { rejection_reason: 'Sem verba' })
    expect(res.status).toBe(200)
    expect(row('rq-w')).toEqual({ ...before, status: 'rejected', rejection_reason: 'Sem verba', updated_by: 'owner@a.com' })
    expect(row('rq-w').authorized_by).toBeNull()
    expect(prWrites()).toHaveLength(1)
  })
  it('PRQ-01d: without rejection_reason -> 200, reason stored as null', async () => {
    const res = await reject('rq-w')
    expect(res.status).toBe(200)
    expect(row('rq-w')).toMatchObject({ status: 'rejected', rejection_reason: null })
  })
  // O handler não grava data nem autor da recusa (só updated_by; não há rejected_at/rejected_by no schema).
  it.todo('PRQ-01d: "quando" da recusa gravado -> o handler/schema não têm rejected_at; aguarda decisão de produto')

  for (const [label, id] of [['authorized', 'rq-auth'], ['already rejected', 'rq-rej']] as const) {
    it(`PRQ-01e: ${label} -> 400 "${WRONG_STATE}...", status unchanged`, async () => {
      const before = structuredClone(requests())
      const res = await reject(id, { rejection_reason: 'x' })
      expect(res.status).toBe(400)
      expect(res.error?.statusMessage?.startsWith(WRONG_STATE)).toBe(true)
      expect(requests()).toEqual(before)
      expect(prWrites()).toHaveLength(0)
    })
  }
  it('PRQ-01e: authorized never becomes rejected', async () => {
    await reject('rq-auth')
    expect(row('rq-auth').status).toBe('authorized')
  })
})

describe('PRQ-03g / PRQ-03h: authorize/reject isolation and absence', () => {
  for (const [label, id] of [['request of B', 'rq-b'], ['soft-deleted', 'rq-del'], ['nonexistent', 'nope']] as const) {
    it(`PRQ-03g: authorize ${label} logged in A -> 404, nothing changed`, async () => {
      const before = structuredClone(requests())
      const res = await authorize(id)
      expect(res.status).toBe(404)
      expect(requests()).toEqual(before)
      expect(prWrites()).toHaveLength(0)
    })
  }
  it('PRQ-03h: reject request of B logged in A -> 404, B identical', async () => {
    const before = structuredClone(row('rq-b'))
    const res = await reject('rq-b', { rejection_reason: 'hack' })
    expect(res.status).toBe(404)
    expect(row('rq-b')).toEqual(before)
    expect(prWrites()).toHaveLength(0)
  })
})

describe('PRQ-10 / PRQ-03a: GET', () => {
  it('default: only live requests of A (no soft-deleted, no B), total correct, request_date desc', async () => {
    const res = await list()
    const body = res.body as ListBody
    expect(res.status).toBe(200)
    expect(body.items.map(i => i.id)).toEqual(['rq-rej', 'rq-auth', 'rq-w'])
    expect(body.total).toBe(3)
    expect(body.page).toBe(1)
    expect(body.page_size).toBe(30)
  })
  it('status=authorized -> only the authorized one', async () => {
    const body = (await list({ status: 'authorized' })).body as ListBody
    expect(body.items.map(i => i.id)).toEqual(['rq-auth'])
    expect(body.total).toBe(1)
  })
  it('supplier_id=sup-b logged in A -> nothing (B is not reachable by filter)', async () => {
    const body = (await list({ supplier_id: 'sup-b' })).body as ListBody
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
  })
  describe('sort_by (seed com request_date fora da ordem de request_number)', () => {
    // SOL-1 (rq-w) 02-09, SOL-3 (rq-rej) 02-05, SOL-2 (rq-auth) 02-01: data desc = w, rej, auth; numero asc = w, auth, rej.
    beforeEach(() => {
      seed([
        req('rq-w', 'org-a', 1, 'waiting', { request_date: '2026-02-09T10:00:00.000Z' }),
        req('rq-auth', 'org-a', 2, 'authorized', { request_date: '2026-02-01T10:00:00.000Z', authorization_date: '2026-02-02T12:00:00.000Z', authorized_by: 'x@a.com' }),
        req('rq-rej', 'org-a', 3, 'rejected', { request_date: '2026-02-05T10:00:00.000Z', rejection_reason: 'caro' }),
        req('rq-b', 'org-b', 1, 'waiting')
      ])
    })
    const ids = async (query: Record<string, unknown>) => ((await list(query)).body as ListBody).items.map(i => i.id)
    it('sort_by=request_date asc and desc give different orders, coherent with the dates', async () => {
      const asc = await ids({ sort_by: 'request_date', sort_order: 'asc' })
      const desc = await ids({ sort_by: 'request_date', sort_order: 'desc' })
      expect(asc).toEqual(['rq-auth', 'rq-rej', 'rq-w'])
      expect(desc).toEqual(['rq-w', 'rq-rej', 'rq-auth'])
      expect(asc).not.toEqual(desc)
    })
    it('sort_by=request_number is honoured and differs from request_date order', async () => {
      expect(await ids({ sort_by: 'request_number', sort_order: 'asc' })).toEqual(['rq-w', 'rq-auth', 'rq-rej'])
      expect(await ids({ sort_by: 'request_number', sort_order: 'desc' })).toEqual(['rq-rej', 'rq-auth', 'rq-w'])
    })
    it('no params and invalid sort_by fall back to request_date desc; sort_order=asc is still honoured on the fallback', async () => {
      expect(await ids({})).toEqual(['rq-w', 'rq-rej', 'rq-auth'])
      expect(await ids({ sort_by: 'organization_id; drop' })).toEqual(['rq-w', 'rq-rej', 'rq-auth'])
      expect(await ids({ sort_by: 'organization_id; drop', sort_order: 'asc' })).toEqual(['rq-auth', 'rq-rej', 'rq-w'])
    })
  })
  it('page_size=500 is capped at 100; total stays correct', async () => {
    const body = (await list({ page_size: 500 })).body as ListBody
    expect(body.page_size).toBe(100)
    expect(body.total).toBe(3)
  })
  it('page_size=1 limits the items but total counts all', async () => {
    const body = (await list({ page_size: 1 })).body as ListBody
    expect(body.items).toHaveLength(1)
    expect(body.total).toBe(3)
  })
  it('PRQ-03a: ?organization_id=org-b logged in A -> only A items', async () => {
    const res = await list({ organization_id: 'org-b' })
    expect(res.status).toBe(200)
    const body = res.body as ListBody
    expect(body.items.map(i => i.id).sort()).toEqual(['rq-auth', 'rq-rej', 'rq-w'])
    expect(body.items.every(i => i.organization_id === 'org-a')).toBe(true)
  })
  it.todo('PRQ-10: search por request_number/requester (fake não prova .or(): `or()` é no-op)')
})

describe('PRQ-11 / PRQ-11d / PRQ-03b: POST creates the request', () => {
  it('PRQ-11: A with 2 requests, POST with 2 items -> SOL-00003, waiting, total = sum of items, org A', async () => {
    seed([req('rq-1', 'org-a', 1, 'waiting'), req('rq-2', 'org-a', 2, 'authorized'), req('rq-b', 'org-b', 1, 'waiting')])
    const res = await create({ supplier_id: 'sup-a', items: [{ description: 'A', estimated_total_price: '100.50' }, { description: 'B', estimated_total_price: 50 }] })
    expect(res.status).toBe(200)
    const item = (res.body as { item: Record<string, any> }).item
    expect(item).toMatchObject({ request_number: 'SOL-00003', status: 'waiting', organization_id: 'org-a', supplier_id: 'sup-a', requester: 'owner@a.com', created_by: 'owner@a.com' })
    expect(item.total_request_amount).toBeCloseTo(150.5, 2)
    const stored = requests().find(r => r.id === item.id)!
    expect(stored.organization_id).toBe('org-a')
    expect(stored.items).toHaveLength(2)
    expect(requests().filter(r => r.organization_id === 'org-b')).toHaveLength(1)
  })

  it('PRQ-11d: [caracteriza comportamento atual; decisão em G2-OQ-06] A with 1 soft-deleted -> new number is SOL-00002, does not reuse the deleted SOL-00001', async () => {
    seed([req('rq-d', 'org-a', 1, 'waiting', { deleted_at: DELETED_AT, deleted_by: 'x@a.com' })])
    const res = await create({ supplier_id: 'sup-a', items: ITEMS })
    expect(res.status).toBe(200)
    const number = (res.body as { item: Record<string, any> }).item.request_number
    expect(number).toBe('SOL-00002') // count inclui deletadas
    expect(number).not.toBe(row('rq-d').request_number)
  })

  it('PRQ-03b: organization_id=org-b in the body is ignored -> created in A, B untouched', async () => {
    const res = await create({ supplier_id: 'sup-a', items: ITEMS, organization_id: 'org-b' })
    expect(res.status).toBe(200)
    const item = (res.body as { item: Record<string, any> }).item
    expect(item.organization_id).toBe('org-a')
    expect(requests().filter(r => r.organization_id === 'org-b')).toHaveLength(1) // só o rq-b do seed
    expect(requests().find(r => r.id === item.id)!.organization_id).toBe('org-a')
    expect(item.request_number).toBe('SOL-00005') // contador só da org A (4 linhas, 1 deletada); B não conta
  })
})

describe('PRQ-12: POST required fields', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['without supplier_id', { items: ITEMS }],
    ['items missing', { supplier_id: 'sup-a' }],
    ['items empty', { supplier_id: 'sup-a', items: [] }],
    ['items not a list (object)', { supplier_id: 'sup-a', items: { description: 'x' } }],
    ['items not a list (string)', { supplier_id: 'sup-a', items: 'abc' }]
  ]
  for (const [label, body] of cases) {
    it(`PRQ-12: ${label} -> 400, nothing inserted`, async () => {
      const res = await create(body)
      expect(res.status).toBe(400)
      expect(prWrites()).toHaveLength(0)
      expect(requests()).toHaveLength(5)
    })
  }
})

describe('PRQ-12b: POST item price validation (KF-55, G2-SD-11)', () => {
  it('controle positivo: owner, mesmo seed, preço válido -> 200 e uma linha inserida', async () => {
    const res = await create({ supplier_id: 'sup-a', items: [{ description: 'x', estimated_total_price: 10 }] })
    expect(res.status).toBe(200)
    expect(prWrites()).toHaveLength(1)
    expect(requests()).toHaveLength(6)
  })
  // Hoje parseFloat(...)||0 transforma lixo em 0 e deixa negativo passar: 200 com total errado.
  for (const [label, price] of [['"abc"', 'abc'], ['negative (-10)', -10]] as const) {
    it.fails(`PRQ-12b: estimated_total_price ${label} -> 400 and nothing inserted [KF-55]`, async () => {
      const res = await create({ supplier_id: 'sup-a', items: [{ description: 'x', estimated_total_price: price }] })
      expect(res.status).toBe(400)
      expect(prWrites()).toHaveLength(0)
    })
  }
})

describe('PRQ-03b / PRQ-03d: cross-org supplier_id (KF-56, G2-SD-01)', () => {
  it('controle positivo PRQ-03b: owner, mesmo seed, supplier_id de A -> 200 e uma linha criada', async () => {
    const res = await create({ supplier_id: 'sup-a', items: ITEMS })
    expect(res.status).toBe(200)
    expect(prWrites()).toHaveLength(1)
    expect(requests()).toHaveLength(6)
  })
  it('controle positivo PRQ-03d: owner, mesmo seed, PUT com supplier_id de A -> 200 e gravado', async () => {
    const res = await update('rq-w', { supplier_id: 'sup-a' })
    expect(res.status).toBe(200)
    expect(row('rq-w').supplier_id).toBe('sup-a')
    expect(prWrites()).toHaveLength(1)
  })
  it.fails('PRQ-03b: POST logged in A with supplier_id of B -> 400/404 and no row created [KF-56]', async () => {
    const res = await create({ supplier_id: 'sup-b', items: ITEMS })
    expect([400, 404]).toContain(res.status)
    expect(prWrites()).toHaveLength(0)
    expect(requests()).toHaveLength(5)
  })
  it.fails('PRQ-03d: PUT on own request with supplier_id of B -> 400/404 and request unchanged [KF-56]', async () => {
    const before = structuredClone(row('rq-w'))
    const res = await update('rq-w', { supplier_id: 'sup-b' })
    expect([400, 404]).toContain(res.status)
    expect(row('rq-w')).toEqual(before)
  })
})

describe('PRQ-13: PUT partial update', () => {
  it('{notes, justification}: only those change (plus updated_by), status untouched', async () => {
    const before = structuredClone(row('rq-w'))
    const res = await update('rq-w', { notes: 'nova obs', justification: 'nova just' })
    expect(res.status).toBe(200)
    expect(row('rq-w')).toEqual({ ...before, notes: 'nova obs', justification: 'nova just', updated_by: 'owner@a.com' })
    expect(Object.keys(prWrites()[0]!.values as object).sort()).toEqual(['justification', 'notes', 'updated_by'])
  })
  it('{status:"authorized"} -> 200 but status ignored (stays waiting), authorization fields untouched', async () => {
    const res = await update('rq-w', { status: 'authorized', authorized_by: 'h@x.com', organization_id: 'org-b', deleted_at: DELETED_AT })
    expect(res.status).toBe(200)
    expect(row('rq-w')).toMatchObject({ status: 'waiting', authorized_by: null, authorization_date: null, organization_id: 'org-a', deleted_at: null })
    expect(Object.keys(prWrites()[0]!.values as object)).toEqual(['updated_by'])
  })
})

describe('PRQ-14: PUT not found', () => {
  for (const [label, id] of [['nonexistent', 'nope'], ['soft-deleted', 'rq-del']] as const) {
    it(`PRQ-14: ${label} id -> 404 "Solicitação não encontrada", nothing changed`, async () => {
      const before = structuredClone(requests())
      const res = await update(id, { notes: 'X' })
      expect(res.status).toBe(404)
      expect(res.error?.statusMessage).toBe('Solicitação não encontrada')
      expect(requests()).toEqual(before)
      expect(prWrites()).toHaveLength(0)
    })
  }
})

describe('PRQ-03d / PRQ-03f: B request logged in A', () => {
  it('PRQ-03d: PUT on a B request (even with supplier_id/purchase_id of B) -> 404, B identical', async () => {
    const before = structuredClone(row('rq-b'))
    const res = await update('rq-b', { notes: 'Hack', supplier_id: 'sup-b', purchase_id: 'pur-b' })
    expect(res.status).toBe(404)
    expect(row('rq-b')).toEqual(before)
    expect(prWrites()).toHaveLength(0)
  })
  it('PRQ-03f: DELETE on a B request -> 404, B without deleted_at', async () => {
    const before = structuredClone(row('rq-b'))
    const res = await remove('rq-b')
    expect(res.status).toBe(404)
    expect(row('rq-b')).toEqual(before)
    expect(prWrites()).toHaveLength(0)
  })
})

describe('PRQ-16 / PRQ-16b: DELETE (soft)', () => {
  it('PRQ-16: waiting of A -> 200 {success:true}, deleted_at and deleted_by set, gone from GET, row still in table', async () => {
    const res = await remove('rq-w')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(row('rq-w').deleted_at).toBeTruthy()
    expect(row('rq-w').deleted_by).toBe('owner@a.com')
    expect(prWrites().every(w => w.op === 'update')).toBe(true)
    const body = (await list()).body as ListBody
    expect(body.items.map(i => i.id)).not.toContain('rq-w')
    expect(body.total).toBe(2)
    expect(requests().some(t => t.id === 'rq-w')).toBe(true)
  })
  it('PRQ-16b: second DELETE -> 404, original deleted_at kept', async () => {
    await remove('rq-w')
    const first = row('rq-w').deleted_at
    const writes = prWrites().length
    const res = await remove('rq-w')
    expect(res.status).toBe(404)
    expect(row('rq-w').deleted_at).toBe(first)
    expect(prWrites()).toHaveLength(writes)
  })
  it('PRQ-16b: DELETE on seed soft-deleted row -> 404, deleted fields untouched', async () => {
    const res = await remove('rq-del')
    expect(res.status).toBe(404)
    expect(row('rq-del')).toMatchObject({ deleted_at: DELETED_AT, deleted_by: 'x@a.com' })
  })
  it.todo('PRQ-16b: DELETE de solicitação authorized com compra gerada (recusar? não deixar compra órfã). Aguarda G2-OQ-09 e G2-SD-12')
})

describe('Decisões de produto pendentes (it.todo)', () => {
  it.todo('PRQ-11c: POST com total_request_amount diferente da soma dos itens (handler usa body.total_request_amount ?? soma). Aguarda G2-OQ-11')
  it.todo('PRQ-15: PUT items/total_request_amount em solicitação authorized/rejected (edição em estado terminal, recálculo do total). Aguarda G2-OQ-09, G2-SD-11 e G2-SD-12')
  it.todo('PRQ-02: authorize gera compra uma única vez (hoje nada é gerado, G2-SD-07). Aguarda G2-OQ-07; o 400 do segundo authorize já está em PRQ-01b')
  it.todo('PRQ-01c/PRQ-01f: emp-com 200 e chave de permissão de authorize/reject. Aguarda G2-OQ-01')
  it.todo('PRQ-03c/e/f: emp-com 200 e chave de permissão de POST/PUT/DELETE. Aguarda G2-OQ-01')
})

describe('PRQ-01c / PRQ-01f: emp-sem must not authorize/reject (KF-09, KF-57, G2-SD-06)', () => {
  beforeEach(() => loginAs('emp-sem'))
  it('controle PRQ-01c [caracteriza comportamento atual; decisão em G2-OQ-01 e KF-57/KF-58]: emp-sem authorize -> 200 e escrita acontece', async () => {
    const res = await authorize('rq-w')
    expect(res.status).toBe(200)
    expect(row('rq-w')).toMatchObject({ status: 'authorized', authorized_by: 'emp@a.com' })
    expect(prWrites()).toHaveLength(1)
  })
  it('controle PRQ-01f [caracteriza comportamento atual; decisão em G2-OQ-01 e KF-57/KF-58]: emp-sem reject -> 200 e escrita acontece', async () => {
    const res = await reject('rq-w', { rejection_reason: 'x' })
    expect(res.status).toBe(200)
    expect(row('rq-w')).toMatchObject({ status: 'rejected', rejection_reason: 'x' })
    expect(prWrites()).toHaveLength(1)
  })
  it.fails('PRQ-01c: authorize as emp-sem -> 403 [KF-57]', async () => {
    const res = await authorize('rq-w')
    expect(res.status).toBe(403)
  })
  it.fails('PRQ-01f: reject as emp-sem -> 403 [KF-57]', async () => {
    const res = await reject('rq-w', { rejection_reason: 'x' })
    expect(res.status).toBe(403)
  })
})

describe('PRQ-03c / PRQ-03e / PRQ-03f: emp-sem must not write (KF-09, KF-58)', () => {
  beforeEach(() => loginAs('emp-sem'))
  it('controle PRQ-03c [caracteriza comportamento atual; decisão em G2-OQ-01 e KF-57/KF-58]: emp-sem POST -> 200 e linha criada', async () => {
    const res = await create({ supplier_id: 'sup-a', items: ITEMS })
    expect(res.status).toBe(200)
    expect(prWrites()).toHaveLength(1)
    expect(requests()).toHaveLength(6)
  })
  it('controle PRQ-03e [caracteriza comportamento atual; decisão em G2-OQ-01 e KF-57/KF-58]: emp-sem PUT -> 200 e notes gravado', async () => {
    const res = await update('rq-w', { notes: 'x' })
    expect(res.status).toBe(200)
    expect(row('rq-w').notes).toBe('x')
    expect(prWrites()).toHaveLength(1)
  })
  it('controle PRQ-03f [caracteriza comportamento atual; decisão em G2-OQ-01 e KF-57/KF-58]: emp-sem DELETE -> 200 e deleted_at gravado', async () => {
    const res = await remove('rq-w')
    expect(res.status).toBe(200)
    expect(row('rq-w').deleted_at).toBeTruthy()
    expect(prWrites()).toHaveLength(1)
  })
  it.fails('PRQ-03c: POST as emp-sem -> 403 [KF-58]', async () => {
    const res = await create({ supplier_id: 'sup-a', items: ITEMS })
    expect(res.status).toBe(403)
  })
  it.fails('PRQ-03e: PUT as emp-sem -> 403 [KF-58]', async () => {
    const res = await update('rq-w', { notes: 'x' })
    expect(res.status).toBe(403)
  })
  it.fails('PRQ-03f: DELETE as emp-sem -> 403 [KF-58]', async () => {
    const res = await remove('rq-w')
    expect(res.status).toBe(403)
  })
})
