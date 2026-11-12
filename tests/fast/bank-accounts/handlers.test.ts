// Handlers de /api/bank-accounts (GET, POST, PUT/:id, DELETE/:id) contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 1 (BAN-xx). Padrão de referência:
// tests/fast/service-orders/money-flows.test.ts e tests/fast/access/financial-permissions.test.ts.
//  - 401 sem sessão já é provado por guard-matrix.test.ts (M1); não se repete aqui.
//  - it.fails = comportamento correto ainda não implementado (ver docs/testing/known-failures.md).
//    Ao corrigir o handler o Vitest acusa "unexpected pass": troque it.fails por it.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler, type FakeEvent } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const LIST = 'server/api/bank-accounts/index.get.ts'
const CREATE = 'server/api/bank-accounts/index.post.ts'
const UPDATE = 'server/api/bank-accounts/[id].put.ts'
const REMOVE = 'server/api/bank-accounts/[id].delete.ts'

type Persona = 'owner' | 'admin' | 'emp-sem'
const USERS: Record<Persona, { id: string, email: string }> = {
  owner: { id: 'u-owner', email: 'owner@a.com' },
  admin: { id: 'u-admin', email: 'admin@a.com' },
  'emp-sem': { id: 'u-emp', email: 'emp@a.com' }
}

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

function seed() {
  fake = createFakeSupabase({
    user_profiles: [
      { id: 'p-owner', user_id: 'u-owner', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true, employee_id: null },
      { id: 'p-admin', user_id: 'u-admin', organization_id: 'org-a', role_id: 'r-admin', is_owner: false, is_active: true, employee_id: null },
      { id: 'p-emp', user_id: 'u-emp', organization_id: 'org-a', role_id: 'r-operador', is_owner: false, is_active: true, employee_id: null }
    ],
    roles: [
      { id: 'r-admin', name: 'admin', is_system_role: true },
      { id: 'r-operador', name: 'operador', is_system_role: false }
    ],
    actions: [],
    role_actions: [],
    bank_accounts: [
      { id: 'a1', organization_id: 'org-a', account_name: 'Caixa', account_type: 'checking', bank_name: 'Banco X', initial_balance: 0, current_balance: 100, is_active: true, deleted_at: null, notes: null },
      { id: 'a2', organization_id: 'org-a', account_name: 'Reserva', account_type: 'savings', bank_name: 'Banco Y', initial_balance: 0, current_balance: 0, is_active: false, deleted_at: null, notes: null },
      { id: 'a3', organization_id: 'org-a', account_name: 'Antiga', account_type: 'checking', bank_name: null, initial_balance: 0, current_balance: 0, is_active: true, deleted_at: '2026-01-01T00:00:00.000Z', deleted_by: 'x@a.com', notes: null },
      { id: 'b1', organization_id: 'org-b', account_name: 'Conta B', account_type: 'checking', bank_name: 'Banco B', initial_balance: 0, current_balance: 500, is_active: true, deleted_at: null, notes: null }
    ],
    // a1 tem saldo 100 sustentado por um extrato de 100 (invariante I1)
    bank_account_statements: [
      { id: 's1', organization_id: 'org-a', bank_account_id: 'a1', amount: 100, previous_balance: 0, balance_after: 100 }
    ]
  })
}

beforeEach(() => {
  seed()
  loginAs('owner')
  auth.refreshSession.mockReset()
})

const accounts = () => fake.tables.bank_accounts!
const row = (id: string) => accounts().find(a => a.id === id)!
const snapshot = (id: string) => structuredClone(row(id))
const bankWrites = () => fake.writes.filter(w => w.table === 'bank_accounts')

const withAudit = (init: Parameters<typeof fakeEvent>[0]): FakeEvent & { context: { audit: Record<string, any> } } => {
  const ev = fakeEvent({ cookies, ...init }) as FakeEvent & { context: { audit: Record<string, any> } }
  ev.context = { audit: {} }
  return ev
}
const list = (query: Record<string, unknown> = {}) => callHandler(LIST, fakeEvent({ cookies, query }))
const create = (body: unknown) => callHandler(CREATE, fakeEvent({ method: 'POST', cookies, body }))
const update = (id: string, body: unknown) => callHandler(UPDATE, fakeEvent({ method: 'PUT', cookies, params: { id }, body }))
const remove = (id: string) => callHandler(REMOVE, fakeEvent({ method: 'DELETE', cookies, params: { id } }))

/** I1: saldo atual == saldo inicial + soma dos extratos, para toda conta viva da org A. */
function balanceDivergences() {
  return accounts()
    .filter(a => a.organization_id === 'org-a' && !a.deleted_at)
    .map((a) => {
      const sum = fake.tables.bank_account_statements!.filter(s => s.bank_account_id === a.id).reduce((t, s) => t + s.amount, 0)
      return { id: a.id, saldo: Number(a.current_balance ?? 0), esperado: Number(a.initial_balance ?? 0) + sum }
    })
    .filter(d => d.saldo !== d.esperado)
}

describe('BAN-04a: GET lists only the session organization', () => {
  it('BAN-04a: items only from org A (no soft-deleted, none from B); ?organization_id=org-b in the URL is ignored', async () => {
    const res = await list({ organization_id: 'org-b' })
    expect(res.status).toBe(200)
    const body = res.body as { items: Array<{ id: string }>, total: number }
    expect(body.items.map(i => i.id).sort()).toEqual(['a1', 'a2'])
    expect(body.total).toBe(2)
  })
  it.todo('BAN-06: filters is_active / search / page_size capped at 100 / invalid sort_by (search not provable: fake-supabase `or()` is a no-op; is_active/page_size are provable but out of this PR scope)')
})

describe('BAN-07 / BAN-14 / BAN-03 / BAN-11b / BAN-02b: depend on a product decision', () => {
  it.todo('BAN-07: GET as emp-sem (today 200, login only). Awaiting G1-OQ-01 (permission key)')
  it.todo('BAN-03: POST initial_balance=500 -> current balance and opening statement. Awaiting G1-OQ-02')
  it.todo('BAN-11b: PUT initial_balance must not rewrite history without adjustment. Awaiting G1-OQ-02')
  it.todo('BAN-02b: DELETE account with statements or active terminal. Awaiting G1-OQ-03')
  it.todo('BAN-14: GET/POST with suspended org or expired subscription. Awaiting G1-OQ-04')
})

describe('BAN-08: POST creates the account in the session organization', () => {
  it('BAN-08: 200 {item}, organization_id = A, created_by = session e-mail, initial_balance defaults to 0', async () => {
    const res = await create({ account_name: 'Nova', account_type: 'checking' })
    expect(res.status).toBe(200)
    const item = (res.body as { item: Record<string, any> }).item
    expect(item).toMatchObject({ account_name: 'Nova', account_type: 'checking', organization_id: 'org-a', created_by: 'owner@a.com', initial_balance: 0 })
    expect(accounts().filter(a => a.account_name === 'Nova')).toHaveLength(1)
  })
})

describe('BAN-09: POST required fields', () => {
  it('BAN-09: without account_name -> 400, nothing inserted', async () => {
    const res = await create({ account_type: 'checking' })
    expect(res.status).toBe(400)
    expect(bankWrites()).toHaveLength(0)
  })
  it('BAN-09: without account_type -> 400, nothing inserted', async () => {
    const res = await create({ account_name: 'Nova' })
    expect(res.status).toBe(400)
    expect(bankWrites()).toHaveLength(0)
  })
  it('BAN-09: empty body {} -> 400, nothing inserted', async () => {
    const res = await create({})
    expect(res.status).toBe(400)
    expect(bankWrites()).toHaveLength(0)
  })
  // G1-SD-04 / KF-46: o handler só testa "falsy"; corpo ausente vira TypeError (status 0) e nome não string é gravado.
  it.fails('BAN-09: missing body (undefined) -> 400 [KF-46, G1-SD-04]', async () => {
    const res = await create(undefined)
    expect(res.status).toBe(400)
  })
  it.fails('BAN-09: non-string account_name -> 400 and nothing inserted [KF-46, G1-SD-04]', async () => {
    const res = await create({ account_name: 123, account_type: 'checking' })
    expect(res.status).toBe(400)
    expect(bankWrites()).toHaveLength(0)
  })
})

describe('BAN-09b: POST type/range validation (G1-SD-04, KF-46)', () => {
  const CASES: Array<[string, Record<string, unknown>]> = [
    ['initial_balance negative', { account_name: 'N', account_type: 'checking', initial_balance: -10 }],
    ['initial_balance string', { account_name: 'N', account_type: 'checking', initial_balance: 'abc' }],
    ['initial_balance NaN', { account_name: 'N', account_type: 'checking', initial_balance: Number.NaN }],
    ['account_type outside the allowed set', { account_name: 'N', account_type: '__not_a_real_type__' }]
  ]
  for (const [label, body] of CASES) {
    it.fails(`BAN-09b: ${label} -> 400 and nothing inserted [KF-46, G1-SD-04]`, async () => {
      const res = await create(body)
      expect(res.status).toBe(400)
      expect(bankWrites()).toHaveLength(0)
    })
  }
})

describe('BAN-01a / BAN-01b: balance must equal the sum of statements (I1, G1-SD-01, KF-45)', () => {
  it('control: the seeded data satisfies the invariant', () => {
    expect(balanceDivergences()).toEqual([])
  })
  // O teste não escolhe a solução: rejeitar (4xx) ou gerar ajuste com extrato satisfazem a invariante.
  it.fails('BAN-01a: POST initial_balance=0 + current_balance=999 does not leave balance diverging from statements [KF-45, G1-SD-01]', async () => {
    await create({ account_name: 'Nova', account_type: 'checking', initial_balance: 0, current_balance: 999 })
    expect(balanceDivergences()).toEqual([])
  })
  it.fails('BAN-01b: PUT current_balance=9999 on account with balance 100 / statements 100 does not diverge [KF-45, G1-SD-01]', async () => {
    await update('a1', { current_balance: 9999 })
    expect(balanceDivergences()).toEqual([])
  })
})

describe('BAN-10 / BAN-11 / BAN-12: PUT', () => {
  it('BAN-10: PUT {account_name, notes, is_active:false} -> 200, only sent fields change, updated_by set, balance untouched', async () => {
    const before = snapshot('a1')
    const res = await update('a1', { account_name: 'Caixa 2', notes: 'obs', is_active: false })
    expect(res.status).toBe(200)
    expect((res.body as { item: Record<string, any> }).item).toMatchObject({ id: 'a1', account_name: 'Caixa 2', notes: 'obs', is_active: false })
    expect(row('a1')).toEqual({ ...before, account_name: 'Caixa 2', notes: 'obs', is_active: false, updated_by: 'owner@a.com' })
    expect(row('a1').current_balance).toBe(100)
  })
  for (const [label, id] of [['nonexistent id', 'nope'], ['soft-deleted id', 'a3']] as const) {
    it(`BAN-11: PUT on ${label} -> 404 "Registro não encontrado", nothing changed`, async () => {
      const before = structuredClone(accounts())
      const res = await update(id, { account_name: 'X' })
      expect(res.status).toBe(404)
      expect(res.error?.statusMessage).toBe('Registro não encontrado')
      expect(accounts()).toEqual(before)
      expect(bankWrites()).toHaveLength(0)
    })
  }
  it('BAN-12: PUT with organization_id=org-b in the body does not move the account', async () => {
    const res = await update('a1', { account_name: 'Caixa 3', organization_id: 'org-b' })
    expect(res.status).toBe(200)
    expect(row('a1').organization_id).toBe('org-a')
    expect(row('a1').account_name).toBe('Caixa 3')
  })
})

describe('BAN-02a / BAN-13: DELETE', () => {
  it('BAN-02a: soft delete -> 200 {success}, deleted_at/deleted_by set, row kept, gone from GET, audit has `before`', async () => {
    const ev = withAudit({ method: 'DELETE', params: { id: 'a2' } })
    const res = await callHandler(REMOVE, ev)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(row('a2')).toBeDefined()
    expect(typeof row('a2').deleted_at).toBe('string')
    expect(row('a2').deleted_by).toBe('owner@a.com')
    expect(bankWrites().every(w => w.op === 'update')).toBe(true)
    const listed = (await list()).body as { items: Array<{ id: string }> }
    expect(listed.items.map(i => i.id)).toEqual(['a1'])
    expect(ev.context.audit.changes?.before).toMatchObject({ id: 'a2', account_name: 'Reserva' })
  })
  it('BAN-13: DELETE of an already-deleted account -> 404 and original deleted_at kept (also on a second call)', async () => {
    const original = row('a3').deleted_at
    const res = await remove('a3')
    expect(res.status).toBe(404)
    expect(row('a3').deleted_at).toBe(original)

    expect((await remove('a2')).status).toBe(200)
    const firstDeletedAt = row('a2').deleted_at
    const again = await remove('a2')
    expect(again.status).toBe(404)
    expect(row('a2').deleted_at).toBe(firstDeletedAt)
  })
})

describe('BAN-04b / BAN-04c / BAN-04d: tenant isolation (A logged in, B owns the record)', () => {
  it('BAN-04b: POST with organization_id=org-b in the body creates the row in org A; B gets no new row', async () => {
    const res = await create({ account_name: 'Intrusa', account_type: 'checking', organization_id: 'org-b' })
    expect(res.status).toBe(200)
    const created = accounts().filter(a => a.account_name === 'Intrusa')
    expect(created).toHaveLength(1)
    expect(created[0]!.organization_id).toBe('org-a')
    expect(accounts().filter(a => a.organization_id === 'org-b')).toHaveLength(1)
  })
  it('BAN-04c: PUT with the id of B\'s account -> 404 and B\'s row identical', async () => {
    const before = snapshot('b1')
    const res = await update('b1', { account_name: 'Hackeada', current_balance: 1, is_active: false })
    expect(res.status).toBe(404)
    expect(row('b1')).toEqual(before)
    expect(bankWrites()).toHaveLength(0)
  })
  it('BAN-04d: DELETE with the id of B\'s account -> 404 and B\'s row without deleted_at', async () => {
    const before = snapshot('b1')
    const res = await remove('b1')
    expect(res.status).toBe(404)
    expect(row('b1')).toEqual(before)
    expect(row('b1').deleted_at).toBeNull()
    expect(bankWrites()).toHaveLength(0)
  })
})

// KF-09: nenhuma escrita de bank-accounts chama requireOrgPermission. Enquanto isso, emp-sem recebe 200.
// A chave de permissão ainda não existe (G1-OQ-01); o teste só exige "403 para quem não tem permissão nenhuma".
describe('BAN-05a / BAN-05b / BAN-05c: role matrix on writes (KF-09, KF-47)', () => {
  type Op = { id: string, run: (persona: Persona) => ReturnType<typeof create> }
  const OPS: Op[] = [
    { id: 'BAN-05a', run: () => create({ account_name: 'Nova', account_type: 'checking' }) },
    { id: 'BAN-05b', run: () => update('a1', { notes: 'x' }) },
    { id: 'BAN-05c', run: () => remove('a2') }
  ]
  for (const op of OPS) {
    for (const persona of ['owner', 'admin'] as const) {
      it(`${op.id}: ${persona} -> 200`, async () => {
        loginAs(persona)
        const res = await op.run(persona)
        expect(res.status).toBe(200)
      })
    }
    it.fails(`${op.id}: emp-sem -> 403 [KF-09, KF-47]`, async () => {
      loginAs('emp-sem')
      const res = await op.run('emp-sem')
      expect(res.status, `respondeu ${res.status}`).toBe(403)
    })
    it.todo(`${op.id}: emp-com -> 200 (no permission key exists to model "com permissão"; awaiting G1-OQ-01)`)
  }
})
