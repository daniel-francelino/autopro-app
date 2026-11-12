// Handlers de /api/payment-terminals (GET, POST, PUT/:id, DELETE/:id) contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 2 (PAY-xx). Padrão: tests/fast/taxes/handlers.test.ts.
//  - 401 sem sessão já é provado por guard-matrix.test.ts; não se repete aqui.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md, KF-68 a KF-70).
//    Ao corrigir o handler o Vitest acusa "unexpected pass": troque it.fails por it.
//  - Limitações do fake: `or()` é no-op (search não provável); `range()` só limita, não pagina por offset;
//    não há FK, então bank_account_id de outra org só é barrado se o handler consultar a conta.
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
const LIST = 'server/api/payment-terminals/index.get.ts'
const CREATE = 'server/api/payment-terminals/index.post.ts'
const UPDATE = 'server/api/payment-terminals/[id].put.ts'
const REMOVE = 'server/api/payment-terminals/[id].delete.ts'

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
const RATES = [{ installment_number: 1, rate_percentage: 1.99 }, { installment_number: 2, rate_percentage: 3.5 }]

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
    // emp-com: role da org A com payment_machines.update concedida (ActionCode.PAYMENT_MACHINES_UPDATE).
    actions: [{ id: 'act-pm-update', code: 'payment_machines.update', deleted_at: null }],
    role_actions: [{ role_id: 'r-com', action_id: 'act-pm-update', is_granted: true }],
    bank_accounts: [
      { id: 'ba-a', organization_id: 'org-a', account_name: 'Conta A', deleted_at: null },
      { id: 'ba-b', organization_id: 'org-b', account_name: 'Conta B', deleted_at: null }
    ],
    payment_terminals: [
      { id: 'pt1', organization_id: 'org-a', terminal_name: 'Stone', provider_company: 'Stone SA', bank_account_id: 'ba-a', payment_receipt_days: 30, is_active: true, rates: RATES, created_at: '2026-01-01', created_by: 'x@a.com', updated_by: 'x@a.com', deleted_at: null },
      { id: 'pt2', organization_id: 'org-a', terminal_name: 'Cielo', provider_company: 'Zeta', bank_account_id: 'ba-a', payment_receipt_days: 1, is_active: true, rates: null, created_at: '2026-01-02', created_by: 'x@a.com', updated_by: 'x@a.com', deleted_at: null },
      { id: 'pt3', organization_id: 'org-a', terminal_name: 'Antiga', provider_company: 'Old', bank_account_id: 'ba-a', payment_receipt_days: 2, is_active: false, rates: null, created_at: '2026-01-03', created_by: 'x@a.com', deleted_at: DELETED_AT, deleted_by: 'x@a.com' },
      { id: 'ptb', organization_id: 'org-b', terminal_name: 'Rede B', provider_company: 'Rede', bank_account_id: 'ba-b', payment_receipt_days: 30, is_active: true, rates: RATES, created_at: '2026-01-04', created_by: 'y@b.com', updated_by: 'y@b.com', deleted_at: null }
    ]
  })
}

beforeEach(() => {
  seed()
  loginAs('owner')
  auth.refreshSession.mockReset()
})

const terminals = () => fake.tables.payment_terminals!
const row = (id: string) => terminals().find(t => t.id === id)!
const ptWrites = () => fake.writes.filter(w => w.table === 'payment_terminals')
const list = (query: Record<string, unknown> = {}) => callHandler(LIST, fakeEvent({ cookies, query }))
const create = (body: unknown) => callHandler(CREATE, fakeEvent({ method: 'POST', cookies, body }))
const update = (id: string, body: unknown) => callHandler(UPDATE, fakeEvent({ method: 'PUT', cookies, params: { id }, body }))
const remove = (id: string) => callHandler(REMOVE, fakeEvent({ method: 'DELETE', cookies, params: { id } }))
type ListBody = { items: Array<Record<string, any>>, total: number, page: number, page_size: number }

describe('PAY-03: tenant isolation (organization_id from the client is ignored)', () => {
  it('PAY-03a: GET logged in A with ?organization_id=org-b -> only A items', async () => {
    const res = await list({ organization_id: 'org-b' })
    expect(res.status).toBe(200)
    const body = res.body as ListBody
    expect(body.items.map(i => i.id).sort()).toEqual(['pt1', 'pt2'])
    expect(body.items.every(i => i.organization_id === 'org-a')).toBe(true)
  })

  it('PAY-03b: POST logged in A with organization_id=org-b in body -> created in A, nothing new in B', async () => {
    const res = await create({ terminal_name: 'Nova', organization_id: 'org-b' })
    expect(res.status).toBe(200)
    expect((res.body as { item: Record<string, any> }).item.organization_id).toBe('org-a')
    expect(terminals().filter(t => t.organization_id === 'org-b')).toHaveLength(1) // só o ptb do seed
    expect(terminals().filter(t => t.terminal_name === 'Nova').map(t => t.organization_id)).toEqual(['org-a'])
  })

  it('PAY-03d: PUT on a B terminal logged in A -> 404, B row identical', async () => {
    const before = structuredClone(row('ptb'))
    const res = await update('ptb', { terminal_name: 'Hack', is_active: false })
    expect(res.status).toBe(404)
    expect(row('ptb')).toEqual(before)
    expect(ptWrites()).toHaveLength(0)
  })

  it('PAY-03f: DELETE on a B terminal logged in A -> 404, B without deleted_at', async () => {
    const before = structuredClone(row('ptb'))
    const res = await remove('ptb')
    expect(res.status).toBe(404)
    expect(row('ptb').deleted_at).toBeNull()
    expect(row('ptb')).toEqual(before)
    expect(ptWrites()).toHaveLength(0)
  })
})

describe('PAY-04: GET pagination and ordering', () => {
  it('default: excludes soft-deleted and B, total correct, sorted by terminal_name asc', async () => {
    const res = await list()
    const body = res.body as ListBody
    expect(res.status).toBe(200)
    expect(body.items.map(i => i.id)).toEqual(['pt2', 'pt1']) // Cielo, Stone
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
    expect(body.page_size).toBe(20)
  })
  it('sort_order=desc -> Stone first', async () => {
    const body = (await list({ sort_order: 'desc' })).body as ListBody
    expect(body.items.map(i => i.id)).toEqual(['pt1', 'pt2'])
  })
  it('sort_by=provider_company and created_at (allowed columns) are honoured', async () => {
    const byProvider = (await list({ sort_by: 'provider_company' })).body as ListBody
    expect(byProvider.items.map(i => i.id)).toEqual(['pt1', 'pt2']) // Stone SA, Zeta
    const byCreated = (await list({ sort_by: 'created_at', sort_order: 'desc' })).body as ListBody
    expect(byCreated.items.map(i => i.id)).toEqual(['pt2', 'pt1'])
  })
  it('invalid sort_by falls back to terminal_name', async () => {
    const res = await list({ sort_by: 'organization_id; drop', sort_order: 'asc' })
    expect(res.status).toBe(200)
    expect((res.body as ListBody).items.map(i => i.terminal_name)).toEqual(['Cielo', 'Stone'])
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
  it.todo('PAY-04: search by terminal_name/provider_company (fake não prova .or(): `or()` é no-op)')
})

describe('PAY-05: POST creates the terminal', () => {
  it('200 {item}, organization_id = A, created_by = session e-mail, rates persisted as sent', async () => {
    const payload = { terminal_name: 'Getnet', provider_company: 'Getnet SA', bank_account_id: 'ba-a', payment_receipt_days: 30, is_active: true, rates: RATES }
    const res = await create(payload)
    expect(res.status).toBe(200)
    const item = (res.body as { item: Record<string, any> }).item
    expect(item).toMatchObject({ ...payload, organization_id: 'org-a', created_by: 'owner@a.com', updated_by: 'owner@a.com' })
    const stored = terminals().find(t => t.id === item.id)!
    expect(stored.rates).toEqual(RATES)
    expect(stored.bank_account_id).toBe('ba-a')
    expect(stored.organization_id).toBe('org-a')
  })
})

describe('PAY-06: POST required name', () => {
  it('without terminal_name -> 400 "terminal_name é obrigatório", nothing inserted', async () => {
    const res = await create({ provider_company: 'X' })
    expect(res.status).toBe(400)
    expect(res.error?.statusMessage).toBe('terminal_name é obrigatório')
    expect(ptWrites()).toHaveLength(0)
  })
  it('empty terminal_name -> 400, nothing inserted', async () => {
    const res = await create({ terminal_name: '' })
    expect(res.status).toBe(400)
    expect(ptWrites()).toHaveLength(0)
  })
  // `!terminal_name` é falso para '   ' (string truthy): o handler grava o nome em branco. Defeito G1-SD-04 (KF-69).
  it.fails('PAY-06: terminal_name with only spaces -> 400 and nothing inserted [KF-69]', async () => {
    const res = await create({ terminal_name: '   ' })
    expect(res.status).toBe(400)
    expect(ptWrites()).toHaveLength(0)
  })
})

describe('PAY-06: POST type and range validation (KF-69, G1-SD-04)', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['payment_receipt_days -5', { payment_receipt_days: -5 }],
    ['payment_receipt_days "abc"', { payment_receipt_days: 'abc' }],
    ['rates with rate_percentage -1', { payment_receipt_days: 30, rates: [{ installment_number: 1, rate_percentage: -1 }] }],
    ['rates with rate_percentage 100.01', { payment_receipt_days: 30, rates: [{ installment_number: 1, rate_percentage: 100.01 }] }]
  ]
  for (const [label, extra] of cases) {
    it.fails(`PAY-06: ${label} -> 400 and nothing inserted [KF-69]`, async () => {
      const res = await create({ terminal_name: 'Inv', ...extra })
      expect(res.status).toBe(400)
      expect(terminals().filter(t => t.terminal_name === 'Inv')).toHaveLength(0)
    })
  }
  it.todo('PAY-06: payment_receipt_days ausente (obrigatório ou default?) e shape de rates (installment_number, duplicados): regra não definida, aguarda product-owner')
})

describe('PAY-07: terminal must not point to another org bank account (KF-68, G1-SD-03)', () => {
  it.fails('PAY-07: POST with bank_account_id of B logged in A -> 400/404 and no row created [KF-68]', async () => {
    const res = await create({ terminal_name: 'Cross', bank_account_id: 'ba-b', payment_receipt_days: 30 })
    expect([400, 404]).toContain(res.status)
    expect(terminals().filter(t => t.terminal_name === 'Cross')).toHaveLength(0)
  })
  it.fails('PAY-07b: PUT with bank_account_id of B -> 400/404 and terminal unchanged [KF-68]', async () => {
    const before = structuredClone(row('pt1'))
    const res = await update('pt1', { bank_account_id: 'ba-b' })
    expect([400, 404]).toContain(res.status)
    expect(row('pt1')).toEqual(before)
  })
})

describe('PAY-08: PUT partial update', () => {
  it('{terminal_name, is_active:false}: only those change (plus updated_by), the rest intact', async () => {
    const before = structuredClone(row('pt1'))
    const res = await update('pt1', { terminal_name: 'Stone 2', is_active: false })
    expect(res.status).toBe(200)
    expect(row('pt1')).toEqual({ ...before, terminal_name: 'Stone 2', is_active: false, updated_by: 'owner@a.com' })
    expect(Object.keys(ptWrites()[0]!.values as object).sort()).toEqual(['is_active', 'terminal_name', 'updated_by'])
  })
  it('organization_id, created_by, deleted_at in the body are ignored', async () => {
    const res = await update('pt1', { terminal_name: 'S', organization_id: 'org-b', created_by: 'h@x.com', deleted_at: DELETED_AT })
    expect(res.status).toBe(200)
    expect(row('pt1')).toMatchObject({ organization_id: 'org-a', created_by: 'x@a.com', deleted_at: null })
  })
})

describe('PAY-09: PUT not found', () => {
  for (const [label, id] of [['nonexistent', 'nope'], ['soft-deleted', 'pt3']] as const) {
    it(`PAY-09: ${label} id -> 404 "Registro não encontrado", nothing changed`, async () => {
      const before = structuredClone(terminals())
      const res = await update(id, { terminal_name: 'X' })
      expect(res.status).toBe(404)
      expect(res.error?.statusMessage).toBe('Registro não encontrado')
      expect(terminals()).toEqual(before)
      expect(ptWrites()).toHaveLength(0)
    })
  }
})

describe('PAY-02a / PAY-10: DELETE (soft)', () => {
  it('PAY-02a: 200 {success:true}, deleted_at and deleted_by set, gone from GET, row still in table', async () => {
    const res = await remove('pt1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(row('pt1').deleted_at).toBeTruthy()
    expect(row('pt1').deleted_by).toBe('owner@a.com')
    const body = (await list()).body as ListBody
    expect(body.items.map(i => i.id)).toEqual(['pt2'])
    expect(terminals().some(t => t.id === 'pt1')).toBe(true)
  })
  it('PAY-10: second DELETE -> 404, original deleted_at kept', async () => {
    await remove('pt1')
    const first = row('pt1').deleted_at
    const writes = ptWrites().length
    const res = await remove('pt1')
    expect(res.status).toBe(404)
    expect(row('pt1').deleted_at).toBe(first)
    expect(ptWrites()).toHaveLength(writes)
  })
  it('PAY-10: DELETE on already soft-deleted seed row -> 404, deleted_at/deleted_by untouched', async () => {
    const res = await remove('pt3')
    expect(res.status).toBe(404)
    expect(row('pt3')).toMatchObject({ deleted_at: DELETED_AT, deleted_by: 'x@a.com' })
  })
})

describe('PAY-01 / PAY-02b: terminals referenced by installments (decisão de produto)', () => {
  it.todo('PAY-01: PUT rates em maquininha com parcelas com terminal_fee_amount gravado. Aguarda G1-OQ-05 (taxa desconta do saldo? altera histórico?)')
  it.todo('PAY-02b: DELETE de terminal usado por parcelas (bloquear ou arquivar). Aguarda G1-OQ-06')
})

describe('PAY-03c / PAY-03e / PAY-03g: emp-sem must not write (KF-09, KF-70)', () => {
  beforeEach(() => loginAs('emp-sem'))
  it('PAY-03c: POST as emp-sem -> 403 [KF-70]', async () => {
    const res = await create({ terminal_name: 'Nova' })
    expect(res.status).toBe(403)
  })
  it('PAY-03e: PUT as emp-sem -> 403 [KF-70]', async () => {
    const res = await update('pt1', { is_active: false })
    expect(res.status).toBe(403)
  })
  it('PAY-03g: DELETE as emp-sem -> 403 [KF-70]', async () => {
    const res = await remove('pt1')
    expect(res.status).toBe(403)
  })
})

// Fase 3 do plano de acesso: POST/PUT/DELETE exigem payment_machines.update (KF-70 corrigido); GET fica só org (D1).
// action-codes.ts só define payment_machines.view e payment_machines.update (não há create/delete). A página
// app/pages/app/financial/machines.vue usa payment_machines.update para criar/editar/excluir; por isso a mesma
// chave é usada nas três rotas de escrita. Limitação: a equivalência rota->chave vem do front, não de um guarda no servidor.
describe('PAY-03c / PAY-03e / PAY-03g: emp-com (payment_machines.update) -> 200', () => {
  beforeEach(() => loginAs('emp-com'))
  const T = 'caracteriza comportamento atual; chave payment_machines.update definida em action-codes.ts, handler sem guarda (KF-09)'
  it(`PAY-03c: POST como emp-com -> 200 (${T})`, async () => {
    const res = await create({ terminal_name: 'Nova', provider_company: 'X', bank_account_id: 'ba-a', payment_receipt_days: 5 })
    expect(res.status).toBe(200)
  })
  it(`PAY-03e: PUT como emp-com -> 200 (${T})`, async () => {
    const res = await update('pt1', { is_active: false })
    expect(res.status).toBe(200)
  })
  it(`PAY-03g: DELETE como emp-com -> 200 (${T})`, async () => {
    const res = await remove('pt1')
    expect(res.status).toBe(200)
  })
})
