// Handlers de /api/purchases (GET, POST, PUT/:id, DELETE/:id) contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g2.md, seção 1 (PUR-xx). Padrão: tests/fast/purchase-requests/handlers.test.ts.
//  - 401 sem sessão já é provado por guard-matrix.test.ts; não se repete aqui.
//  - pay (PUR-01a/b/c/d) já está em tests/fast/financial/financial-payments.test.ts e tests/fast/access/financial-permissions.test.ts; não se repete aqui.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md, KF-59 a KF-61; permissão também KF-09).
//    Ao corrigir o handler o Vitest acusa "unexpected pass": troque it.fails por it.
//  - Limitações do fake: `or()` é no-op (search não provável); `range()` só limita, não pagina por offset;
//    `select('*, suppliers(...)')` não faz join; não há FK, então supplier_id/bank_account_id de outra org só é barrado se o handler consultar;
//    o `update` do fake não distingue o filtro por organização (G2-SD-09 não é provável aqui);
//    sort é comparação JS (`>`/`<`): datas ISO ordenam bem; `total_amount` ordena como número porque o seed usa número.
//  - NaN em total_amount só é alcançável chamando o handler direto: via HTTP, JSON.stringify(NaN) vira null e cai no 400 de PUR-12.
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
const LIST = 'server/api/purchases/index.get.ts'
const CREATE = 'server/api/purchases/index.post.ts'
const UPDATE = 'server/api/purchases/[id].put.ts'
const REMOVE = 'server/api/purchases/[id].delete.ts'

type Persona = 'owner' | 'admin' | 'emp-sem' | 'emp-com'
const USERS: Record<Persona, { id: string, email: string }> = {
  owner: { id: 'u-owner', email: 'owner@a.com' },
  admin: { id: 'u-admin', email: 'admin@a.com' },
  'emp-sem': { id: 'u-emp', email: 'emp@a.com' },
  'emp-com': { id: 'u-empcom', email: 'empcom@a.com' }
}

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

const DELETED_AT = '2026-01-01T00:00:00.000Z'

function pur(id: string, org: string, extra: Record<string, unknown> = {}) {
  return {
    id, organization_id: org, supplier_id: org === 'org-a' ? 'sup-a' : 'sup-b', bank_account_id: org === 'org-a' ? 'ba-a' : 'ba-b',
    financial_transaction_id: null, purchase_date: '2026-03-10', total_amount: 300, payment_status: 'pending', invoice_number: null,
    payment_date: null, due_date: null, notes: 'N', items: null,
    created_at: '2026-03-01T10:00:00.000Z', created_by: 'x@a.com', updated_by: 'x@a.com', deleted_at: null, deleted_by: null, ...extra
  }
}

// Ordem de inserção: p1, p2, p3. Por purchase_date desc: p2 (25), p3 (15), p1 (05) -> difere da inserção.
// total_amount asc: p2 (100), p3 (300), p1 (500). invoice_number asc: NF-1 (p2), NF-2 (p3), NF-3 (p1).
const ALL_ROWS = () => [
  pur('pu-p1', 'org-a', { purchase_date: '2026-03-05', total_amount: 500, payment_status: 'paid', payment_date: '2026-03-06', invoice_number: 'NF-3' }),
  pur('pu-p2', 'org-a', { purchase_date: '2026-03-25', total_amount: 100, payment_status: 'pending', invoice_number: 'NF-1' }),
  pur('pu-p3', 'org-a', { purchase_date: '2026-03-15', total_amount: 300, payment_status: 'paid', payment_date: '2026-03-16', invoice_number: 'NF-2' }),
  pur('pu-del', 'org-a', { purchase_date: '2026-03-30', total_amount: 999, payment_status: 'paid', deleted_at: DELETED_AT, deleted_by: 'x@a.com' }),
  pur('pu-b', 'org-b', { purchase_date: '2026-03-28', total_amount: 777, payment_status: 'paid', invoice_number: 'NF-B' })
]

function seed(rows: Array<Record<string, any>> = ALL_ROWS()) {
  fake = createFakeSupabase({
    user_profiles: [
      { id: 'p-owner', user_id: 'u-owner', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true, employee_id: null },
      { id: 'p-admin', user_id: 'u-admin', organization_id: 'org-a', role_id: 'r-admin', is_owner: false, is_active: true, employee_id: null },
      { id: 'p-emp', user_id: 'u-emp', organization_id: 'org-a', role_id: 'r-operador', is_owner: false, is_active: true, employee_id: null },
      { id: 'p-empcom', user_id: 'u-empcom', organization_id: 'org-a', role_id: 'r-com', is_owner: false, is_active: true, employee_id: null }
    ],
    roles: [
      { id: 'r-admin', name: 'admin', is_system_role: true },
      { id: 'r-operador', name: 'operador', is_system_role: false },
      { id: 'r-com', name: 'com-permissao', is_system_role: false }
    ],
    // emp-com: role da org A com as chaves de escrita concedidas (ActionCode.PURCHASES_*).
    actions: [
      { id: 'act-0', code: 'purchases.create', deleted_at: null },
      { id: 'act-1', code: 'purchases.update', deleted_at: null },
      { id: 'act-2', code: 'purchases.delete', deleted_at: null }
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
    bank_accounts: [
      { id: 'ba-a', organization_id: 'org-a', account_name: 'Caixa A', current_balance: 1000, deleted_at: null },
      { id: 'ba-b', organization_id: 'org-b', account_name: 'Caixa B', current_balance: 5000, deleted_at: null }
    ],
    purchases: rows
  })
}

beforeEach(() => {
  seed()
  loginAs('owner')
  auth.refreshSession.mockReset()
})

const purchases = () => fake.tables.purchases!
const row = (id: string) => purchases().find(t => t.id === id)!
const puWrites = () => fake.writes.filter(w => w.table === 'purchases')
const list = (query: Record<string, unknown> = {}) => callHandler(LIST, fakeEvent({ cookies, query }))
const create = (body: unknown) => callHandler(CREATE, fakeEvent({ method: 'POST', cookies, body }))
const update = (id: string, body: unknown) => callHandler(UPDATE, fakeEvent({ method: 'PUT', cookies, params: { id }, body }))
const remove = (id: string) => callHandler(REMOVE, fakeEvent({ method: 'DELETE', cookies, params: { id } }))
type ListBody = { items: Array<Record<string, any>>, total: number, page: number, page_size: number }
const ids = async (query: Record<string, unknown>) => ((await list(query)).body as ListBody).items.map(i => i.id)
const SEED_SIZE = 5
const VALID = { supplier_id: 'sup-a', bank_account_id: 'ba-a', purchase_date: '2026-04-01', total_amount: 123.45 }

describe('PUR-10 / PUR-06a: GET', () => {
  it('default: only live purchases of A (no soft-deleted, no B), total correct, purchase_date desc', async () => {
    const res = await list()
    const body = res.body as ListBody
    expect(res.status).toBe(200)
    expect(body.items.map(i => i.id)).toEqual(['pu-p2', 'pu-p3', 'pu-p1'])
    expect(body.total).toBe(3)
    expect(body.page).toBe(1)
    expect(body.page_size).toBe(30)
  })

  it('payment_status=paid -> only paid live ones of A (no soft-deleted paid, no paid of B), purchase_date desc', async () => {
    const body = (await list({ payment_status: 'paid' })).body as ListBody
    expect(body.items.map(i => i.id)).toEqual(['pu-p3', 'pu-p1'])
    expect(body.total).toBe(2)
  })

  it('supplier_id=sup-b logged in A -> nothing (B is not reachable by filter)', async () => {
    const body = (await list({ supplier_id: 'sup-b' })).body as ListBody
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
  })

  describe('sort_by (seed com purchase_date fora da ordem de inserção)', () => {
    it('sort_by=purchase_date asc and desc give different orders, coherent with the dates', async () => {
      const asc = await ids({ sort_by: 'purchase_date', sort_order: 'asc' })
      const desc = await ids({ sort_by: 'purchase_date', sort_order: 'desc' })
      expect(asc).toEqual(['pu-p1', 'pu-p3', 'pu-p2'])
      expect(desc).toEqual(['pu-p2', 'pu-p3', 'pu-p1'])
      expect(asc).not.toEqual(desc)
    })
    it('sort_by=total_amount is honoured and differs from purchase_date order', async () => {
      expect(await ids({ sort_by: 'total_amount', sort_order: 'asc' })).toEqual(['pu-p2', 'pu-p3', 'pu-p1'])
      expect(await ids({ sort_by: 'total_amount', sort_order: 'desc' })).toEqual(['pu-p1', 'pu-p3', 'pu-p2'])
    })
    it('sort_by=invoice_number is honoured', async () => {
      expect(await ids({ sort_by: 'invoice_number', sort_order: 'asc' })).toEqual(['pu-p2', 'pu-p3', 'pu-p1'])
      expect(await ids({ sort_by: 'invoice_number', sort_order: 'desc' })).toEqual(['pu-p1', 'pu-p3', 'pu-p2'])
    })
    it('no params and invalid sort_by fall back to purchase_date desc; sort_order=asc is still honoured on the fallback', async () => {
      expect(await ids({})).toEqual(['pu-p2', 'pu-p3', 'pu-p1'])
      expect(await ids({ sort_by: 'organization_id; drop' })).toEqual(['pu-p2', 'pu-p3', 'pu-p1'])
      expect(await ids({ sort_by: 'organization_id; drop', sort_order: 'asc' })).toEqual(['pu-p1', 'pu-p3', 'pu-p2'])
    })
  })

  it('page_size=500 is capped at 100; total stays correct', async () => {
    const body = (await list({ page_size: 500 })).body as ListBody
    expect(body.page_size).toBe(100)
    expect(body.total).toBe(3)
  })

  it('page_size=1 limits the items but total counts all', async () => {
    const body = (await list({ page_size: 1 })).body as ListBody
    expect(body.items.map(i => i.id)).toEqual(['pu-p2'])
    expect(body.total).toBe(3)
  })

  it('PUR-06a: ?organization_id=org-b logged in A -> only A items', async () => {
    const res = await list({ organization_id: 'org-b' })
    expect(res.status).toBe(200)
    const body = res.body as ListBody
    expect(body.items.map(i => i.id).sort()).toEqual(['pu-p1', 'pu-p2', 'pu-p3'])
    expect(body.items.every(i => i.organization_id === 'org-a')).toBe(true)
    expect(body.total).toBe(3)
  })

  it.todo('PUR-10: search por invoice_number/notes (limitação do fake: `or()` é no-op, não prova o filtro)')
  it.todo('PUR-10: paginação por offset (page=2): fake range() só limita; date_from/date_to sem teste')
})

describe('PUR-11 / PUR-06b: POST creates the purchase', () => {
  it('PUR-11: required fields of A -> 200, org A, created_by = e-mail, pending, total stored = sent', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    const item = (res.body as { item: Record<string, any> }).item
    expect(item).toMatchObject({
      organization_id: 'org-a', supplier_id: 'sup-a', bank_account_id: 'ba-a', purchase_date: '2026-04-01',
      payment_status: 'pending', created_by: 'owner@a.com', updated_by: 'owner@a.com', invoice_number: null, payment_date: null
    })
    expect(item.total_amount).toBe(123.45)
    const stored = purchases().find(r => r.id === item.id)!
    expect(stored).toMatchObject({ organization_id: 'org-a', payment_status: 'pending', total_amount: 123.45 })
    expect(purchases()).toHaveLength(SEED_SIZE + 1)
    expect(puWrites()).toHaveLength(1)
  })

  it('PUR-06b: organization_id=org-b in the body is ignored -> created in A, B untouched', async () => {
    const res = await create({ ...VALID, organization_id: 'org-b' })
    expect(res.status).toBe(200)
    const item = (res.body as { item: Record<string, any> }).item
    expect(item.organization_id).toBe('org-a')
    expect(purchases().find(r => r.id === item.id)!.organization_id).toBe('org-a')
    expect(purchases().filter(r => r.organization_id === 'org-b')).toHaveLength(1) // só o pu-b do seed
    expect(row('pu-b')).toEqual(ALL_ROWS().find(r => r.id === 'pu-b'))
  })
})

describe('PUR-12: POST required fields', () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ['supplier_id', 'O campo "supplier_id" é obrigatório', { bank_account_id: 'ba-a', purchase_date: '2026-04-01', total_amount: 10 }],
    ['bank_account_id', 'O campo "bank_account_id" é obrigatório', { supplier_id: 'sup-a', purchase_date: '2026-04-01', total_amount: 10 }],
    ['purchase_date', 'O campo "purchase_date" é obrigatório', { supplier_id: 'sup-a', bank_account_id: 'ba-a', total_amount: 10 }],
    ['total_amount', 'O campo "total_amount" é obrigatório', { supplier_id: 'sup-a', bank_account_id: 'ba-a', purchase_date: '2026-04-01' }],
    ['total_amount null', 'O campo "total_amount" é obrigatório', { supplier_id: 'sup-a', bank_account_id: 'ba-a', purchase_date: '2026-04-01', total_amount: null }],
    ['empty body (first missing field)', 'O campo "supplier_id" é obrigatório', {}]
  ]
  for (const [label, message, body] of cases) {
    it(`PUR-12: without ${label} -> 400 "${message}", nothing inserted`, async () => {
      const res = await create(body)
      expect(res.status).toBe(400)
      expect(res.error?.statusMessage).toBe(message)
      expect(puWrites()).toHaveLength(0)
      expect(purchases()).toHaveLength(SEED_SIZE)
    })
  }
})

describe('PUR-12b: POST value validation (KF-59, G2-SD-02)', () => {
  it('controle positivo: owner, mesmo seed, corpo válido -> 200 e uma linha inserida', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(puWrites()).toHaveLength(1)
    expect(purchases()).toHaveLength(SEED_SIZE + 1)
  })
  // Hoje só a presença é validada: todos os valores abaixo respondem 200 e são gravados.
  const bad: Array<[string, Record<string, unknown>]> = [
    ['total_amount negative (-10)', { total_amount: -10 }],
    ['total_amount string "abc"', { total_amount: 'abc' }],
    ['total_amount NaN', { total_amount: Number.NaN }],
    ['purchase_date invalid ("abc")', { purchase_date: 'abc' }],
    ['payment_status outside the set ("banana")', { payment_status: 'banana' }]
  ]
  for (const [label, override] of bad) {
    it.fails(`PUR-12b: ${label} -> 400 and nothing inserted [KF-59]`, async () => {
      const res = await create({ ...VALID, ...override })
      expect(res.status).toBe(400)
      expect(puWrites()).toHaveLength(0)
      expect(purchases()).toHaveLength(SEED_SIZE)
    })
  }
})

describe('PUR-06b / PUR-06d: cross-org supplier_id and bank_account_id (KF-60, G2-SD-01)', () => {
  it('controle positivo PUR-06b: owner, mesmo seed, ids de A -> 200 e uma linha criada', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(puWrites()).toHaveLength(1)
    expect(purchases()).toHaveLength(SEED_SIZE + 1)
  })
  it('controle positivo PUR-06d: owner, mesmo seed, PUT com supplier_id e bank_account_id de A -> 200 e gravado', async () => {
    const res = await update('pu-p2', { supplier_id: 'sup-a', bank_account_id: 'ba-a' })
    expect(res.status).toBe(200)
    expect(row('pu-p2')).toMatchObject({ supplier_id: 'sup-a', bank_account_id: 'ba-a' })
    expect(puWrites()).toHaveLength(1)
  })
  for (const [label, override] of [['supplier_id', { supplier_id: 'sup-b' }], ['bank_account_id', { bank_account_id: 'ba-b' }]] as const) {
    it.fails(`PUR-06b: POST logged in A with ${label} of B -> 400/404 and no row created [KF-60]`, async () => {
      const res = await create({ ...VALID, ...override })
      expect([400, 404]).toContain(res.status)
      expect(puWrites()).toHaveLength(0)
      expect(purchases()).toHaveLength(SEED_SIZE)
    })
    it.fails(`PUR-06d: PUT on own purchase with ${label} of B -> 400/404 and purchase unchanged [KF-60]`, async () => {
      const before = structuredClone(row('pu-p2'))
      const res = await update('pu-p2', override)
      expect([400, 404]).toContain(res.status)
      expect(row('pu-p2')).toEqual(before)
    })
  }
})

describe('PUR-06c (owner/admin): writes allowed', () => {
  for (const persona of ['owner', 'admin'] as const) {
    describe(persona, () => {
      beforeEach(() => loginAs(persona))
      it('POST -> 200, created_by = e-mail da sessão', async () => {
        const res = await create(VALID)
        expect(res.status).toBe(200)
        expect((res.body as { item: Record<string, any> }).item).toMatchObject({ organization_id: 'org-a', created_by: USERS[persona].email })
      })
      it('PUT -> 200, notes gravado, updated_by = e-mail da sessão', async () => {
        const res = await update('pu-p2', { notes: 'x' })
        expect(res.status).toBe(200)
        expect(row('pu-p2')).toMatchObject({ notes: 'x', updated_by: USERS[persona].email })
      })
      it('DELETE -> 200, deleted_by = e-mail da sessão', async () => {
        const res = await remove('pu-p2')
        expect(res.status).toBe(200)
        expect(row('pu-p2')).toMatchObject({ deleted_by: USERS[persona].email })
        expect(row('pu-p2').deleted_at).toBeTruthy()
      })
    })
  }
})

describe('PUR-13: PUT partial update', () => {
  it('{notes, due_date}: only those change (plus updated_by), total and status untouched', async () => {
    const before = structuredClone(row('pu-p2'))
    const res = await update('pu-p2', { notes: 'nova obs', due_date: '2026-05-10' })
    expect(res.status).toBe(200)
    expect(row('pu-p2')).toEqual({ ...before, notes: 'nova obs', due_date: '2026-05-10', updated_by: 'owner@a.com' })
    expect(row('pu-p2').total_amount).toBe(100)
    expect(Object.keys(puWrites()[0]!.values as object).sort()).toEqual(['due_date', 'notes', 'updated_by'])
    expect((res.body as { item: Record<string, any> }).item).toMatchObject({ id: 'pu-p2', notes: 'nova obs', due_date: '2026-05-10', total_amount: 100 })
  })
})

describe('PUR-14: PUT not found', () => {
  for (const [label, id] of [['nonexistent', 'nope'], ['soft-deleted', 'pu-del']] as const) {
    it(`PUR-14: ${label} id -> 404 "Compra não encontrada", nothing changed`, async () => {
      const before = structuredClone(purchases())
      const res = await update(id, { notes: 'X' })
      expect(res.status).toBe(404)
      expect(res.error?.statusMessage).toBe('Compra não encontrada')
      expect(purchases()).toEqual(before)
      expect(puWrites()).toHaveLength(0)
    })
  }
})

describe('PUR-06d / PUR-06f: B purchase logged in A', () => {
  it('PUR-06d: PUT on a B purchase -> 404, B identical', async () => {
    const before = structuredClone(row('pu-b'))
    const res = await update('pu-b', { notes: 'Hack', total_amount: 1 })
    expect(res.status).toBe(404)
    expect(row('pu-b')).toEqual(before)
    expect(puWrites()).toHaveLength(0)
  })
  it('PUR-06d: PUT on a B purchase with organization_id=org-a in the body -> still 404, B identical', async () => {
    const before = structuredClone(row('pu-b'))
    const res = await update('pu-b', { organization_id: 'org-a', notes: 'Hack' })
    expect(res.status).toBe(404)
    expect(row('pu-b')).toEqual(before)
    expect(puWrites()).toHaveLength(0)
  })
  it('PUR-06d: PUT on own purchase with organization_id=org-b in the body -> 200 but organization_id ignored (stays A)', async () => {
    const res = await update('pu-p2', { organization_id: 'org-b', notes: 'ok' })
    expect(res.status).toBe(200)
    expect(row('pu-p2')).toMatchObject({ organization_id: 'org-a', notes: 'ok' })
    expect(Object.keys(puWrites()[0]!.values as object)).not.toContain('organization_id')
  })
  it('PUR-06f: DELETE on a B purchase -> 404, B without deleted_at', async () => {
    const before = structuredClone(row('pu-b'))
    const res = await remove('pu-b')
    expect(res.status).toBe(404)
    expect(row('pu-b')).toEqual(before)
    expect(row('pu-b').deleted_at).toBeNull()
    expect(puWrites()).toHaveLength(0)
  })
})

describe('PUR-16 / PUR-16b: DELETE (soft)', () => {
  it('PUR-16: pending of A -> 200 {success:true}, deleted_at and deleted_by set, gone from GET, row still in table', async () => {
    const ev = fakeEvent({ method: 'DELETE', cookies, params: { id: 'pu-p2' } }) as ReturnType<typeof fakeEvent> & { context: { audit: Record<string, any> } }
    ev.context = { audit: {} }
    const res = await callHandler(REMOVE, ev)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    // recordAudit(event, { before: existing }): estado anterior à remoção
    expect(ev.context.audit.changes?.before).toMatchObject({ id: 'pu-p2', organization_id: 'org-a', deleted_at: null })
    expect(row('pu-p2').deleted_at).toBeTruthy()
    expect(row('pu-p2').deleted_by).toBe('owner@a.com')
    expect(puWrites().every(w => w.op === 'update')).toBe(true)
    expect(puWrites()).toHaveLength(1)
    const body = (await list()).body as ListBody
    expect(body.items.map(i => i.id)).not.toContain('pu-p2')
    expect(body.total).toBe(2)
    expect(purchases()).toHaveLength(SEED_SIZE)
  })
  it('PUR-16b: second DELETE -> 404, original deleted_at kept', async () => {
    await remove('pu-p2')
    const first = row('pu-p2').deleted_at
    const writes = puWrites().length
    const res = await remove('pu-p2')
    expect(res.status).toBe(404)
    expect(row('pu-p2').deleted_at).toBe(first)
    expect(puWrites()).toHaveLength(writes)
  })
  for (const [label, id] of [['nonexistent', 'nope'], ['seed soft-deleted', 'pu-del']] as const) {
    it(`PUR-16b: DELETE on ${label} id -> 404, nothing changed`, async () => {
      const before = structuredClone(purchases())
      const res = await remove(id)
      expect(res.status).toBe(404)
      expect(purchases()).toEqual(before)
      expect(puWrites()).toHaveLength(0)
    })
  }
})

describe('Decisões de produto pendentes (it.todo)', () => {
  it.todo('PUR-03: DELETE de compra paga -> estornar efeito financeiro/estoque ou recusar. Decisão pendente: G2-OQ-02, G2-OQ-04 (G2-SD-04); não é it.fails')
  it.todo('PUR-02a: PUT que altera items -> estoque coerente. G2-OQ-04; nenhum handler de G2 escreve estoque, linha não testável no handler')
  it.todo('PUR-04: items com soma diferente de total_amount; arredondamento (0,1+0,2). Aguarda G2-OQ-03')
  it.todo('PUR-15: PUT com payment_status "paid" sem passar por pay (G2-SD-03). Aguarda G2-OQ-02')
  it.todo('PUR-15b: PUT de total_amount/items em compra paga. Aguarda G2-OQ-02')
  it.todo('PUR-01e: pay lança despesa, extrato e baixa saldo (KF-43 documenta o comportamento atual). Aguarda G2-OQ-02')
  it.todo('PUR-01g: payment_date inválida ou futura no pay. Aguarda G2-OQ-10')
})

describe('PUR-06c / PUR-06e / PUR-06f: emp-sem must not write (KF-09, KF-61)', () => {
  beforeEach(() => loginAs('emp-sem'))
  it('controle PUR-06c [caracteriza comportamento atual; decisão em G2-OQ-01 e KF-09]: emp-sem POST -> 200 e linha criada', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(puWrites()).toHaveLength(1)
    expect(purchases()).toHaveLength(SEED_SIZE + 1)
  })
  it('controle PUR-06e [caracteriza comportamento atual; decisão em G2-OQ-01 e KF-09]: emp-sem PUT -> 200 e notes gravado', async () => {
    const res = await update('pu-p2', { notes: 'x' })
    expect(res.status).toBe(200)
    expect(row('pu-p2').notes).toBe('x')
    expect(puWrites()).toHaveLength(1)
  })
  it('controle PUR-06f [caracteriza comportamento atual; decisão em G2-OQ-01 e KF-09]: emp-sem DELETE -> 200 e deleted_at gravado', async () => {
    const res = await remove('pu-p2')
    expect(res.status).toBe(200)
    expect(row('pu-p2').deleted_at).toBeTruthy()
    expect(puWrites()).toHaveLength(1)
  })
  it.fails('PUR-06c: POST as emp-sem -> 403 [KF-61]', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(403)
  })
  it.fails('PUR-06e: PUT as emp-sem -> 403 [KF-61]', async () => {
    const res = await update('pu-p2', { notes: 'x' })
    expect(res.status).toBe(403)
  })
  it.fails('PUR-06f: DELETE as emp-sem -> 403 [KF-61]', async () => {
    const res = await remove('pu-p2')
    expect(res.status).toBe(403)
  })
})

// Verificado por grep em server/api/purchases: nenhum handler chama requireOrgPermission (KF-09, KF-61).
// Chaves definidas em action-codes.ts: purchases.create/update/delete. emp-com é controle positivo: o 200 vale hoje com ou sem a chave.
describe('PUR-06c / PUR-06e / PUR-06f: emp-com -> 200', () => {
  beforeEach(() => loginAs('emp-com'))
  it('PUR-06c: POST como emp-com -> 200 (caracteriza comportamento atual; chave purchases.create definida em action-codes.ts, handler sem guarda (KF-09))', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(purchases()).toHaveLength(SEED_SIZE + 1)
  })
  it('PUR-06e: PUT como emp-com -> 200 (caracteriza comportamento atual; chave purchases.update definida em action-codes.ts, handler sem guarda (KF-09))', async () => {
    const res = await update('pu-p2', { notes: 'x' })
    expect(res.status).toBe(200)
    expect(row('pu-p2').notes).toBe('x')
  })
  it('PUR-06f: DELETE como emp-com -> 200 (caracteriza comportamento atual; chave purchases.delete definida em action-codes.ts, handler sem guarda (KF-09))', async () => {
    const res = await remove('pu-p2')
    expect(res.status).toBe(200)
    expect(row('pu-p2').deleted_at).toBeTruthy()
  })
})
