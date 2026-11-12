// Handlers de /api/purchase-returns (GET, POST, PUT/:id, DELETE/:id) contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g2.md, seção 2 (PRT-xx). Padrão: tests/fast/purchases/handlers.test.ts.
//  - 401 sem sessão já é provado por guard-matrix.test.ts; não se repete aqui.
//  - Nenhum handler de G2 escreve estoque ou saldo: não há teste de estoque.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md: KF-63, KF-64, KF-71, KF-72; permissão também KF-09).
//    Ao corrigir o handler o Vitest acusa "unexpected pass": troque it.fails por it.
//  - Limitações do fake: `or()` é no-op (search por fornecedor/compra não provável); `range()` só limita;
//    `select('*, suppliers(...)')` não faz join; não há FK, então purchase_id/supplier_id de outra org só é barrado se o handler consultar;
//    o `update` do fake não distingue o filtro por organização (G2-SD-09 não é provável aqui);
//    sort é comparação JS: datas ISO ordenam bem.
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
const LIST = 'server/api/purchase-returns/index.get.ts'
const CREATE = 'server/api/purchase-returns/index.post.ts'
const UPDATE = 'server/api/purchase-returns/[id].put.ts'
const REMOVE = 'server/api/purchase-returns/[id].delete.ts'

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

function ret(id: string, org: string, extra: Record<string, unknown> = {}) {
  return {
    id, organization_id: org, purchase_id: org === 'org-a' ? 'pu-a' : 'pu-b', supplier_id: org === 'org-a' ? 'sup-a' : 'sup-b',
    financial_transaction_id: null, bank_account_id: null, return_date: '2026-03-10', reason: 'warranty', status: 'pending',
    total_returned_amount: 100, returned_items: [{ description: 'Pastilha', quantity: 1, unit_price: 100 }],
    generated_financial_credit: false, notes: 'N',
    created_at: '2026-03-01T10:00:00.000Z', created_by: 'x@a.com', updated_by: 'x@a.com', deleted_at: null, deleted_by: null, ...extra
  }
}

// Ordem de inserção: r1, r2, r3. Por return_date desc: r2 (25), r3 (15), r1 (05) -> difere da inserção.
const ALL_ROWS = () => [
  ret('pr-r1', 'org-a', { return_date: '2026-03-05' }),
  ret('pr-r2', 'org-a', { return_date: '2026-03-25', status: 'completed' }),
  ret('pr-r3', 'org-a', { return_date: '2026-03-15' }),
  ret('pr-del', 'org-a', { return_date: '2026-03-30', status: 'completed', deleted_at: DELETED_AT, deleted_by: 'x@a.com' }),
  ret('pr-b', 'org-b', { return_date: '2026-03-28', status: 'completed' })
]

function seed(rows: Array<Record<string, any>> = ALL_ROWS()) {
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
    // emp-com: role da org A com as chaves de escrita concedidas (ActionCode.RETURNS_*).
    actions: [
      { id: 'act-0', code: 'returns.create', deleted_at: null },
      { id: 'act-1', code: 'returns.update', deleted_at: null },
      { id: 'act-2', code: 'returns.delete', deleted_at: null }
    ],
    role_actions: [
      { role_id: 'r-com', action_id: 'act-0', is_granted: true },
      { role_id: 'r-com', action_id: 'act-1', is_granted: true },
      { role_id: 'r-com', action_id: 'act-2', is_granted: true }
    ],
    suppliers: [
      { id: 'sup-a', organization_id: 'org-a', name: 'Fornecedor A', deleted_at: null },
      { id: 'sup-b', organization_id: 'org-b', name: 'Fornecedor B', deleted_at: null }
    ],
    purchases: [
      { id: 'pu-a', organization_id: 'org-a', supplier_id: 'sup-a', purchase_date: '2026-02-10', total_amount: 500, payment_status: 'paid', payment_date: '2026-02-11', items: [{ description: 'Pastilha', quantity: 5, unit_price: 100 }], deleted_at: null },
      { id: 'pu-a-del', organization_id: 'org-a', supplier_id: 'sup-a', purchase_date: '2026-02-12', total_amount: 500, payment_status: 'paid', items: [{ description: 'Pastilha', quantity: 5, unit_price: 100 }], deleted_at: DELETED_AT },
      { id: 'pu-b', organization_id: 'org-b', supplier_id: 'sup-b', purchase_date: '2026-02-10', total_amount: 900, payment_status: 'paid', items: null, deleted_at: null }
    ],
    purchase_returns: rows
  })
}

beforeEach(() => {
  seed()
  loginAs('owner')
  auth.refreshSession.mockReset()
})

const returns = () => fake.tables.purchase_returns!
const row = (id: string) => returns().find(t => t.id === id)!
const prWrites = () => fake.writes.filter(w => w.table === 'purchase_returns')
const list = (query: Record<string, unknown> = {}) => callHandler(LIST, fakeEvent({ cookies, query }))
const create = (body: unknown) => callHandler(CREATE, fakeEvent({ method: 'POST', cookies, body }))
const update = (id: string, body: unknown) => callHandler(UPDATE, fakeEvent({ method: 'PUT', cookies, params: { id }, body }))
const remove = (id: string) => callHandler(REMOVE, fakeEvent({ method: 'DELETE', cookies, params: { id } }))
type ListBody = { items: Array<Record<string, any>>, total: number, page: number, page_size: number }
const ids = async (query: Record<string, unknown>) => ((await list(query)).body as ListBody).items.map(i => i.id)
const SEED_SIZE = 5
const VALID = {
  purchase_id: 'pu-a', supplier_id: 'sup-a', return_date: '2026-04-01', reason: 'warranty', total_returned_amount: 100,
  returned_items: [{ description: 'Pastilha', quantity: 1, unit_price: 100 }]
}

describe('PRT-10 / PRT-03a: GET', () => {
  it('default: only live returns of A (no soft-deleted, no B), total correct, return_date desc', async () => {
    const res = await list()
    const body = res.body as ListBody
    expect(res.status).toBe(200)
    expect(body.items.map(i => i.id)).toEqual(['pr-r2', 'pr-r3', 'pr-r1'])
    expect(body.total).toBe(3)
    expect(body.page).toBe(1)
    expect(body.page_size).toBe(30)
  })

  it('status=completed -> only completed live ones of A (no soft-deleted completed, no completed of B)', async () => {
    const body = (await list({ status: 'completed' })).body as ListBody
    expect(body.items.map(i => i.id)).toEqual(['pr-r2'])
    expect(body.total).toBe(1)
  })

  it('sort: return_date asc and desc differ and are coherent with the dates', async () => {
    const asc = await ids({ sort_by: 'return_date', sort_order: 'asc' })
    const desc = await ids({ sort_by: 'return_date', sort_order: 'desc' })
    expect(asc).toEqual(['pr-r1', 'pr-r3', 'pr-r2'])
    expect(desc).toEqual(['pr-r2', 'pr-r3', 'pr-r1'])
  })

  it('invalid sort_by falls back to return_date; sort_order=asc is still honoured on the fallback', async () => {
    expect(await ids({ sort_by: 'organization_id; drop' })).toEqual(['pr-r2', 'pr-r3', 'pr-r1'])
    expect(await ids({ sort_by: 'organization_id; drop', sort_order: 'asc' })).toEqual(['pr-r1', 'pr-r3', 'pr-r2'])
  })

  it('page_size=500 is capped at 100; total stays correct', async () => {
    const body = (await list({ page_size: 500 })).body as ListBody
    expect(body.page_size).toBe(100)
    expect(body.total).toBe(3)
  })

  it('PRT-03a: ?organization_id=org-b logged in A -> only A items', async () => {
    const res = await list({ organization_id: 'org-b' })
    expect(res.status).toBe(200)
    const body = res.body as ListBody
    expect(body.items.map(i => i.id).sort()).toEqual(['pr-r1', 'pr-r2', 'pr-r3'])
    expect(body.items.every(i => i.organization_id === 'org-a')).toBe(true)
    expect(body.total).toBe(3)
  })

  it('PRT-03a: supplier_id=sup-b logged in A -> nothing (B is not reachable by filter)', async () => {
    const body = (await list({ supplier_id: 'sup-b' })).body as ListBody
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
  })

  it.todo('PRT-10: search por fornecedor e por compra (limitação do fake: `or()` é no-op, não prova o filtro)')
  it.todo('PRT-03a: search que casa fornecedor de B não devolve item de B (limitação do fake: `or()` é no-op; as subconsultas filtram por org mas o resultado final não é provável)')
})

describe('PRT-11 / PRT-03b: POST creates the return', () => {
  it('PRT-11: valid return of a paid purchase of A -> 200, org A, pending, linked to the original purchase', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    const item = (res.body as { item: Record<string, any> }).item
    expect(item).toMatchObject({
      organization_id: 'org-a', purchase_id: 'pu-a', supplier_id: 'sup-a', status: 'pending', reason: 'warranty',
      created_by: 'owner@a.com', updated_by: 'owner@a.com'
    })
    expect(item.total_returned_amount).toBe(100)
    expect(returns().find(r => r.id === item.id)).toMatchObject({ organization_id: 'org-a', purchase_id: 'pu-a', status: 'pending' })
    expect(returns()).toHaveLength(SEED_SIZE + 1)
    expect(prWrites()).toHaveLength(1)
  })

  it('PRT-03b: organization_id=org-b in the body is ignored -> created in A, B untouched', async () => {
    const res = await create({ ...VALID, organization_id: 'org-b' })
    expect(res.status).toBe(200)
    const item = (res.body as { item: Record<string, any> }).item
    expect(item.organization_id).toBe('org-a')
    expect(returns().find(r => r.id === item.id)!.organization_id).toBe('org-a')
    expect(returns().filter(r => r.organization_id === 'org-b')).toHaveLength(1)
    expect(row('pr-b')).toEqual(ALL_ROWS().find(r => r.id === 'pr-b'))
  })
})

describe('PRT-12: POST required fields', () => {
  const without = (k: string) => Object.fromEntries(Object.entries(VALID).filter(([key]) => key !== k))
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ['purchase_id', 'O campo "purchase_id" é obrigatório', without('purchase_id')],
    ['supplier_id', 'O campo "supplier_id" é obrigatório', without('supplier_id')],
    ['return_date', 'O campo "return_date" é obrigatório', without('return_date')],
    ['reason', 'O campo "reason" deve ser um de', without('reason')],
    ['reason outside the set', 'O campo "reason" deve ser um de', { ...VALID, reason: 'because' }],
    ['total_returned_amount', 'O campo "total_returned_amount" é obrigatório', without('total_returned_amount')],
    ['total_returned_amount null', 'O campo "total_returned_amount" é obrigatório', { ...VALID, total_returned_amount: null }],
    ['returned_items', 'O campo "returned_items" é obrigatório e deve ser uma lista', without('returned_items')],
    ['returned_items not a list', 'O campo "returned_items" é obrigatório e deve ser uma lista', { ...VALID, returned_items: 'x' }],
    ['returned_items as object', 'O campo "returned_items" é obrigatório e deve ser uma lista', { ...VALID, returned_items: { quantity: 1 } }]
  ]
  for (const [label, message, body] of cases) {
    it(`PRT-12: ${label} -> 400 "${message}", nothing inserted`, async () => {
      const res = await create(body)
      expect(res.status).toBe(400)
      expect(res.error?.statusMessage).toContain(message)
      expect(prWrites()).toHaveLength(0)
      expect(returns()).toHaveLength(SEED_SIZE)
    })
  }
  it.each(['warranty', 'wrong_part', 'manufacturing_defect', 'damaged_product', 'incompatible', 'other'])('PRT-12: reason "%s" is accepted', async (reason) => {
    const res = await create({ ...VALID, reason })
    expect(res.status).toBe(200)
  })
})

describe('PRT-12b: POST value validation (KF-64, G2-SD-10)', () => {
  it('controle positivo: owner, mesmo seed, corpo válido -> 200 e uma linha inserida', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(prWrites()).toHaveLength(1)
    expect(returns()).toHaveLength(SEED_SIZE + 1)
  })
  // Hoje status fora de pending|completed vira 'pending' em silêncio e total_returned_amount só tem checagem de presença.
  const bad: Array<[string, Record<string, unknown>]> = [
    ["status 'xyz'", { status: 'xyz' }],
    ['total_returned_amount negative (-10)', { total_returned_amount: -10 }],
    ['total_returned_amount string "abc"', { total_returned_amount: 'abc' }]
  ]
  for (const [label, override] of bad) {
    it.fails(`PRT-12b: ${label} -> 400 and nothing inserted [KF-64]`, async () => {
      const res = await create({ ...VALID, ...override })
      expect(res.status).toBe(400)
      expect(prWrites()).toHaveLength(0)
      expect(returns()).toHaveLength(SEED_SIZE)
    })
  }
})

describe('PRT-01 / PRT-01b: returned quantity and amount vs purchase (KF-63, G2-SD-05)', () => {
  // pu-a: item de índice 0 (qtd 5, preço 100), total 500. O POST não consulta a compra: nem quantidade nem valor devolvido são comparados ao comprado.
  // Formato de returned_items = o da UI (app/pages/app/products/purchase-returns.vue ~L586-594): purchase_item_index, part_id, description,
  // quantity, unit_price, total_price, notes. O comentário SQL da migration 20240101000024 (~L108) diverge da UI; a UI é tratada como contrato (KF-63).
  // O handler hoje aceita qualquer array (não casa por índice), então o 400 esperado nos it.fails só pode vir da regra de quantidade/valor excedido.
  const items = (quantity: number) => [{ purchase_item_index: 0, part_id: null, description: 'Pastilha', quantity, unit_price: 100, total_price: quantity * 100, notes: null }]
  it('controle positivo: devolver qtd 5 de 5, total 500 (dentro do comprado) -> 200', async () => {
    const res = await create({ ...VALID, total_returned_amount: 500, returned_items: items(5) })
    expect(res.status).toBe(200)
    expect(returns()).toHaveLength(SEED_SIZE + 1)
  })
  it.fails('PRT-01: devolver qtd 6 de compra com item qtd 5 -> 400 and nothing created [KF-63]', async () => {
    const res = await create({ ...VALID, total_returned_amount: 600, returned_items: items(6) })
    expect(res.status).toBe(400)
    expect(prWrites()).toHaveLength(0)
    expect(returns()).toHaveLength(SEED_SIZE)
  })
  it.fails('PRT-01: devolver 3 e depois 3 (acumulado 6 > 5) -> primeira 200, segunda 400 [KF-63]', async () => {
    const first = await create({ ...VALID, total_returned_amount: 300, returned_items: items(3) })
    expect(first.status).toBe(200)
    const second = await create({ ...VALID, total_returned_amount: 300, returned_items: items(3) })
    expect(second.status).toBe(400)
    expect(returns()).toHaveLength(SEED_SIZE + 1)
  })
  it.fails('PRT-01b: total_returned_amount (900) maior que o total da compra (500) -> 400 and nothing created [KF-63]', async () => {
    const res = await create({ ...VALID, total_returned_amount: 900, returned_items: items(5) })
    expect(res.status).toBe(400)
    expect(prWrites()).toHaveLength(0)
    expect(returns()).toHaveLength(SEED_SIZE)
  })
})

describe('PRT-03b / PRT-03c / PRT-03e: cross-org and invalid purchase/supplier ids (KF-71, G2-SD-01)', () => {
  it('controle positivo PRT-03b: owner, mesmo seed, ids de A -> 200 e uma linha criada', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(prWrites()).toHaveLength(1)
  })
  it('controle positivo PRT-03e: owner, mesmo seed, PUT com purchase_id de A -> 200 e gravado', async () => {
    const res = await update('pr-r1', { purchase_id: 'pu-a', supplier_id: 'sup-a' })
    expect(res.status).toBe(200)
    expect(prWrites()).toHaveLength(1)
  })
  for (const [label, override] of [['purchase_id', { purchase_id: 'pu-b' }], ['supplier_id', { supplier_id: 'sup-b' }]] as const) {
    it.fails(`PRT-03b: POST logged in A with ${label} of B -> 400/404 and no row created [KF-71]`, async () => {
      const res = await create({ ...VALID, ...override })
      expect([400, 404]).toContain(res.status)
      expect(prWrites()).toHaveLength(0)
      expect(returns()).toHaveLength(SEED_SIZE)
    })
  }
  it.fails('PRT-03c: POST with purchase_id of a soft-deleted purchase -> 400/404 and no row created [KF-71]', async () => {
    const res = await create({ ...VALID, purchase_id: 'pu-a-del' })
    expect([400, 404]).toContain(res.status)
    expect(prWrites()).toHaveLength(0)
    expect(returns()).toHaveLength(SEED_SIZE)
  })
  it.fails('PRT-03e: PUT on own return with purchase_id of B -> 400/404 and return unchanged [KF-71]', async () => {
    const before = structuredClone(row('pr-r1'))
    const res = await update('pr-r1', { purchase_id: 'pu-b' })
    expect([400, 404]).toContain(res.status)
    expect(row('pr-r1')).toEqual(before)
  })
})

describe('PRT-14: PUT not found', () => {
  for (const [label, id] of [['nonexistent', 'nope'], ['soft-deleted', 'pr-del']] as const) {
    it(`PRT-14: ${label} id -> 404 "Devolução não encontrada", nothing changed`, async () => {
      const before = structuredClone(returns())
      const res = await update(id, { notes: 'X' })
      expect(res.status).toBe(404)
      expect(res.error?.statusMessage).toBe('Devolução não encontrada')
      expect(returns()).toEqual(before)
      expect(prWrites()).toHaveLength(0)
    })
  }
})

describe('PRT-03e / PRT-03g: B return logged in A', () => {
  it('PRT-03e: PUT on a B return -> 404, B identical', async () => {
    const before = structuredClone(row('pr-b'))
    const res = await update('pr-b', { notes: 'Hack', total_returned_amount: 1 })
    expect(res.status).toBe(404)
    expect(row('pr-b')).toEqual(before)
    expect(prWrites()).toHaveLength(0)
  })
  it('PRT-03g: DELETE on a B return -> 404, B without deleted_at', async () => {
    const before = structuredClone(row('pr-b'))
    const res = await remove('pr-b')
    expect(res.status).toBe(404)
    expect(row('pr-b')).toEqual(before)
    expect(row('pr-b').deleted_at).toBeNull()
    expect(prWrites()).toHaveLength(0)
  })
})

describe('PRT-16 / PRT-16b: DELETE (soft)', () => {
  it('PRT-16: pending of A -> 200 {success:true}, deleted_at/deleted_by set, audit with before, gone from GET, row preserved', async () => {
    const ev = fakeEvent({ method: 'DELETE', cookies, params: { id: 'pr-r1' } }) as ReturnType<typeof fakeEvent> & { context: { audit: Record<string, any> } }
    ev.context = { audit: {} }
    const res = await callHandler(REMOVE, ev)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    // recordAudit(event, { before: existing }): estado anterior à remoção
    expect(ev.context.audit.changes?.before).toMatchObject({ id: 'pr-r1', organization_id: 'org-a', deleted_at: null })
    expect(row('pr-r1').deleted_at).toBeTruthy()
    expect(row('pr-r1').deleted_by).toBe('owner@a.com')
    expect(prWrites().every(w => w.op === 'update')).toBe(true)
    expect(prWrites()).toHaveLength(1)
    const body = (await list()).body as ListBody
    expect(body.items.map(i => i.id)).not.toContain('pr-r1')
    expect(body.total).toBe(2)
    expect(returns()).toHaveLength(SEED_SIZE)
  })
  it('PRT-16b: second DELETE -> 404, original deleted_at kept', async () => {
    await remove('pr-r1')
    const first = row('pr-r1').deleted_at
    const writes = prWrites().length
    const res = await remove('pr-r1')
    expect(res.status).toBe(404)
    expect(row('pr-r1').deleted_at).toBe(first)
    expect(prWrites()).toHaveLength(writes)
  })
  for (const [label, id] of [['nonexistent', 'nope'], ['seed soft-deleted', 'pr-del']] as const) {
    it(`PRT-16b: DELETE on ${label} id -> 404, nothing changed`, async () => {
      const before = structuredClone(returns())
      const res = await remove(id)
      expect(res.status).toBe(404)
      expect(returns()).toEqual(before)
      expect(prWrites()).toHaveLength(0)
    })
  }
})

describe('Decisões de produto pendentes (it.todo)', () => {
  it.todo('PRT-02: POST com status completed em compra paga -> ajuste financeiro. Decisão pendente: G2-OQ-02; nenhum ajuste hoje (G2-SD-05)')
  it.todo('PRT-13: PUT com reason e status completed -> efeito de completar. Aguarda G2-OQ-02')
  it.todo('PRT-15: PUT em devolução completed alterando total_returned_amount, returned_items, purchase_id, status de volta. Aguarda G2-OQ-09 e G2-OQ-02')
  it.todo('PRT-16b (completed): DELETE de devolução completed -> estorno ou recusa. Aguarda G2-OQ-02 e G2-OQ-09')
})

describe('PRT-03d / PRT-03f / PRT-03g: emp-sem must not write (KF-09, KF-72)', () => {
  beforeEach(() => loginAs('emp-sem'))
  it('controle PRT-03d [caracteriza comportamento atual; decisão em G2-OQ-01 e KF-09]: emp-sem POST -> 200 e linha criada', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(prWrites()).toHaveLength(1)
    expect(returns()).toHaveLength(SEED_SIZE + 1)
  })
  it('controle PRT-03f [caracteriza comportamento atual; decisão em G2-OQ-01 e KF-09]: emp-sem PUT -> 200 e notes gravado', async () => {
    const res = await update('pr-r1', { notes: 'x' })
    expect(res.status).toBe(200)
    expect(row('pr-r1').notes).toBe('x')
    expect(prWrites()).toHaveLength(1)
  })
  it('controle PRT-03g [caracteriza comportamento atual; decisão em G2-OQ-01 e KF-09]: emp-sem DELETE -> 200 e deleted_at gravado', async () => {
    const res = await remove('pr-r1')
    expect(res.status).toBe(200)
    expect(row('pr-r1').deleted_at).toBeTruthy()
    expect(prWrites()).toHaveLength(1)
  })
  it.fails('PRT-03d: POST as emp-sem -> 403 [KF-72]', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(403)
  })
  it.fails('PRT-03f: PUT as emp-sem -> 403 [KF-72]', async () => {
    const res = await update('pr-r1', { notes: 'x' })
    expect(res.status).toBe(403)
  })
  it.fails('PRT-03g: DELETE as emp-sem -> 403 [KF-72]', async () => {
    const res = await remove('pr-r1')
    expect(res.status).toBe(403)
  })
})

// Verificado por grep em server/api/purchase-returns: nenhum handler chama requireOrgPermission (KF-09, KF-72).
// Chaves definidas em action-codes.ts: returns.create/update/delete. emp-com é controle positivo: o 200 vale hoje com ou sem a chave.
describe('PRT-03d / PRT-03f / PRT-03g: emp-com -> 200', () => {
  beforeEach(() => loginAs('emp-com'))
  it('PRT-03d: POST como emp-com -> 200 (caracteriza comportamento atual; chave returns.create definida em action-codes.ts, handler sem guarda (KF-09))', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(returns()).toHaveLength(SEED_SIZE + 1)
  })
  it('PRT-03f: PUT como emp-com -> 200 (caracteriza comportamento atual; chave returns.update definida em action-codes.ts, handler sem guarda (KF-09))', async () => {
    const res = await update('pr-r1', { notes: 'x' })
    expect(res.status).toBe(200)
    expect(row('pr-r1').notes).toBe('x')
  })
  it('PRT-03g: DELETE como emp-com -> 200 (caracteriza comportamento atual; chave returns.delete definida em action-codes.ts, handler sem guarda (KF-09))', async () => {
    const res = await remove('pr-r1')
    expect(res.status).toBe(200)
    expect(row('pr-r1').deleted_at).toBeTruthy()
  })
})
