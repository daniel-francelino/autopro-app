// Handlers de /api/employees (GET lista só no que toca isolamento, POST, PUT/:id, DELETE/:id) contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 4 (EMP-06a-g, 08, 09, 10, 11, 12, 13, 14, 15, 03a, 03b, 04a, 01c).
// Leituras de lista (EMP-07) estão em reads.test.ts; grant-access (EMP-01a/b/d/e/f, 06n) em grant-access.test.ts.
//  - 401 sem sessão já é provado por guard-matrix.test.ts; não se repete aqui.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md, KF-52, KF-53, KF-62; permissão também KF-09).
//    Ao corrigir o handler o Vitest acusa "unexpected pass": troque it.fails por it.
//  - Limitações do fake: `or()` é no-op (o filtro de desligados do GET e a contagem de ativos do limite do plano contam desligados;
//    por isso o seed do limite (EMP-10) não tem desligados); `range()` só limita; não há FK nem constraint única.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { emp, employeesSeed, USERS, type Persona } from './employees-seed'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const LIST = 'server/api/employees/index.get.ts'
const CREATE = 'server/api/employees/index.post.ts'
const UPDATE = 'server/api/employees/[id].put.ts'
const REMOVE = 'server/api/employees/[id].delete.ts'

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

beforeEach(() => {
  fake = createFakeSupabase(employeesSeed())
  loginAs('owner')
  auth.refreshSession.mockReset()
})

const employees = () => fake.tables.employees!
const row = (id: string) => employees().find(e => e.id === id)!
const profiles = () => fake.tables.user_profiles!
const profile = (id: string) => profiles().find(p => p.id === id)!
const empWrites = () => fake.writes.filter(w => w.table === 'employees')
const profileWrites = () => fake.writes.filter(w => w.table === 'user_profiles')
const list = (query: Record<string, unknown> = {}) => callHandler(LIST, fakeEvent({ cookies, query }))
const create = (body: unknown) => callHandler(CREATE, fakeEvent({ method: 'POST', cookies, body }))
const update = (id: string, body: unknown) => callHandler(UPDATE, fakeEvent({ method: 'PUT', cookies, params: { id }, body }))
const remove = (id: string) => callHandler(REMOVE, fakeEvent({ method: 'DELETE', cookies, params: { id } }))
type ListBody = { items: Array<Record<string, any>> }
type ItemBody = { item: Record<string, any> }
const SEED_SIZE = employeesSeed().employees!.length
const VALID = { name: 'Novo Func', person_type: 'pf', tax_id: '123.456.789-00', phone: '11988887777' }

describe('EMP-06a: GET lista ignora organization_id da query', () => {
  it('?organization_id=org-b logado em A -> só funcionários de A (nenhum de B, nenhum excluído)', async () => {
    const res = await list({ organization_id: 'org-b' })
    expect(res.status).toBe(200)
    const items = (res.body as ListBody).items
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(i => i.organization_id === 'org-a')).toBe(true)
    const ids = items.map(i => i.id)
    expect(ids).not.toContain('e-b1')
    expect(ids).not.toContain('e-b-link')
    expect(ids).not.toContain('e-a-del')
    expect(ids).toContain('e-a1')
  })
})

describe('EMP-08: POST cria funcionário', () => {
  it('corpo completo: 200, org A, strings obrigatórias aparadas, created_by/updated_by = e-mail da sessão, valores gravados', async () => {
    const body = {
      name: '  Novo Func  ', person_type: ' pf ', tax_id: ' 123.456.789-00 ', phone: ' 11988887777 ', email: 'novo@a.com', role: 'Pintor',
      zip_code: '01001000', street: 'Rua A', address_number: '10', address_complement: 'ap 1', neighborhood: 'Centro', city: 'São Paulo', state: 'SP',
      has_salary: true, salary_amount: 2500, payment_day: 5, salary_installments: 1,
      has_minimum_guarantee: true, minimum_guarantee_amount: 1000, minimum_guarantee_installments: 2,
      pix_key_type: 'cpf', pix_key: '12345678900', termination_date: null, termination_reason: null
    }
    const res = await create(body)
    expect(res.status).toBe(200)
    const item = (res.body as ItemBody).item
    expect(item).toMatchObject({
      organization_id: 'org-a', name: 'Novo Func', person_type: 'pf', tax_id: '123.456.789-00', phone: '11988887777', email: 'novo@a.com', role: 'Pintor',
      city: 'São Paulo', state: 'SP', has_salary: true, salary_amount: 2500, payment_day: 5, has_minimum_guarantee: true, minimum_guarantee_amount: 1000,
      pix_key: '12345678900', created_by: 'owner@a.com', updated_by: 'owner@a.com'
    })
    expect(employees()).toHaveLength(SEED_SIZE + 1)
    expect(row(item.id)).toMatchObject({ organization_id: 'org-a', name: 'Novo Func' })
    expect(empWrites()).toHaveLength(1)
  })

  it('só os obrigatórios: defaults (has_salary=false, has_minimum_guarantee=false, demais campos null)', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    const item = (res.body as ItemBody).item
    expect(item).toMatchObject({
      organization_id: 'org-a', has_salary: false, has_minimum_guarantee: false, email: null, role: null,
      salary_amount: null, payment_day: null, termination_date: null, termination_reason: null, pix_key: null
    })
  })
})

describe('EMP-09: POST campos obrigatórios', () => {
  const cases: Array<[string, string, Record<string, unknown> | undefined]> = [
    ['sem name', 'name is required', { person_type: 'pf', tax_id: '1', phone: '1' }],
    ['sem person_type', 'person_type is required', { name: 'N', tax_id: '1', phone: '1' }],
    ['sem tax_id', 'tax_id is required', { name: 'N', person_type: 'pf', phone: '1' }],
    ['sem phone', 'phone is required', { name: 'N', person_type: 'pf', tax_id: '1' }],
    ['name só com espaços', 'name is required', { ...VALID, name: '   ' }],
    ['person_type só com espaços', 'person_type is required', { ...VALID, person_type: '  ' }],
    ['tax_id só com espaços', 'tax_id is required', { ...VALID, tax_id: ' ' }],
    ['phone só com espaços', 'phone is required', { ...VALID, phone: '   ' }],
    ['name vazio', 'name is required', { ...VALID, name: '' }],
    ['corpo vazio (primeiro campo faltante)', 'name is required', {}],
    ['sem corpo', 'name is required', undefined]
  ]
  for (const [label, message, body] of cases) {
    it(`${label} -> 400 "${message}", nada inserido`, async () => {
      const res = await create(body)
      expect(res.status).toBe(400)
      expect(res.error?.statusMessage).toBe(message)
      expect(empWrites()).toHaveLength(0)
      expect(employees()).toHaveLength(SEED_SIZE)
    })
  }

  it('controle: owner, mesmo seed, corpo válido -> 200 e uma linha inserida', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(empWrites()).toHaveLength(1)
    expect(employees()).toHaveLength(SEED_SIZE + 1)
  })

  // Hoje `body.x.trim()` em valor que não é string lança TypeError (status 0 no harness; 500 em produção), nunca 400 (G1-SD-04).
  const nonString: Array<[string, Record<string, unknown>]> = [
    ['name numérico', { name: 123 }],
    ['name booleano', { name: true }],
    ['name objeto', { name: {} }],
    ['person_type numérico', { person_type: 5 }],
    ['tax_id numérico (CPF sem aspas)', { tax_id: 12345678900 }],
    ['phone array', { phone: ['11988887777'] }]
  ]
  for (const [label, override] of nonString) {
    it.fails(`EMP-09: ${label} -> 400 e nada inserido [KF-62]`, async () => {
      const res = await create({ ...VALID, ...override })
      expect(res.status).toBe(400)
      expect(empWrites()).toHaveLength(0)
      expect(employees()).toHaveLength(SEED_SIZE)
    })
  }
})

describe('EMP-10: POST respeita o limite de funcionários do plano (KF-03 já corrigido)', () => {
  function plan(planKey: 'starter' | 'pro' | null, activeInA: number, inB = 0) {
    fake.tables.subscriptions = planKey ? [{ id: 'sub-a', organization_id: 'org-a', plan_key: planKey, status: 'active', deleted_at: null }] : []
    fake.tables.employees = [
      ...Array.from({ length: activeInA }, (_, i) => emp(`x-a${i}`, 'org-a')),
      ...Array.from({ length: inB }, (_, i) => emp(`x-b${i}`, 'org-b'))
    ]
  }
  const activeInA = () => employees().filter(e => e.organization_id === 'org-a' && !e.deleted_at).length

  it('starter com 2 ativos (limite 2) -> 403 com a mensagem do limite, nada inserido', async () => {
    plan('starter', 2)
    const res = await create(VALID)
    expect(res.status).toBe(403)
    expect(res.error?.statusMessage).toContain('no máximo 2 funcionários')
    expect(empWrites()).toHaveLength(0)
    expect(activeInA()).toBe(2)
  })

  it('sem assinatura ativa vale o limite do starter: 2 ativos -> 403, nada inserido (KF-03)', async () => {
    plan(null, 2)
    const res = await create(VALID)
    expect(res.status).toBe(403)
    expect(empWrites()).toHaveLength(0)
    expect(activeInA()).toBe(2)
  })

  it('assinatura cancelada (status != active) também cai no limite do starter', async () => {
    plan('pro', 2)
    fake.tables.subscriptions![0]!.status = 'canceled'
    const res = await create(VALID)
    expect(res.status).toBe(403)
    expect(empWrites()).toHaveLength(0)
  })

  it('com folga: starter com 1 ativo -> 200 e a contagem chega ao limite sem passar dele', async () => {
    plan('starter', 1)
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(activeInA()).toBe(2)
  })

  it.todo('EMP-10: desligado não conta para o limite (fake não prova o filtro de desligados, or())')

  it('pro com 2 ativos (limite 10) -> 200', async () => {
    plan('pro', 2)
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(activeInA()).toBe(3)
  })

  it('funcionários de B não contam para o limite de A (starter, 1 em A e 5 em B) -> 200', async () => {
    plan('starter', 1, 5)
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(activeInA()).toBe(2)
  })

  it('funcionário excluído não conta para o limite (starter, 1 ativo + 3 excluídos) -> 200', async () => {
    plan('starter', 1)
    employees().push(...[1, 2, 3].map(i => emp(`x-del${i}`, 'org-a', { deleted_at: '2026-01-01T00:00:00.000Z' })))
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(activeInA()).toBe(2)
  })
})

describe('EMP-06b: POST ignora organization_id do corpo', () => {
  it('organization_id=org-b no corpo logado em A -> criado em A, nada em B', async () => {
    const bBefore = structuredClone(employees().filter(e => e.organization_id === 'org-b'))
    const res = await create({ ...VALID, organization_id: 'org-b' })
    expect(res.status).toBe(200)
    const item = (res.body as ItemBody).item
    expect(item.organization_id).toBe('org-a')
    expect((empWrites()[0]!.values as Record<string, unknown>).organization_id).toBe('org-a')
    expect(row(item.id).organization_id).toBe('org-a')
    expect(employees().filter(e => e.organization_id === 'org-b')).toEqual(bBefore)
  })
})

describe('EMP-12: PUT atualiza só a lista permitida', () => {
  it('{phone, role} em funcionário de A sem usuário -> 200, só phone, role e updated_by mudam', async () => {
    const before = structuredClone(row('e-a1'))
    const res = await update('e-a1', { phone: '11000001111', role: 'Gerente' })
    expect(res.status).toBe(200)
    expect(row('e-a1')).toEqual({ ...before, phone: '11000001111', role: 'Gerente', updated_by: 'owner@a.com' })
    expect(Object.keys(empWrites()[0]!.values as object).sort()).toEqual(['phone', 'role', 'updated_by'])
    expect((res.body as ItemBody).item).toMatchObject({ id: 'e-a1', phone: '11000001111', role: 'Gerente', updated_by: 'owner@a.com' })
    // sem usuário vinculado, nenhum perfil é tocado
    expect(profileWrites()).toHaveLength(0)
  })

  it('campos fora da lista (organization_id, id, created_by, deleted_at, deleted_by) são ignorados', async () => {
    const before = structuredClone(row('e-a1'))
    const res = await update('e-a1', { phone: '11000001111', organization_id: 'org-b', id: 'zzz', created_by: 'hack@x.com', deleted_at: '2026-02-02T00:00:00.000Z', deleted_by: 'hack@x.com' })
    expect(res.status).toBe(200)
    expect(row('e-a1')).toEqual({ ...before, phone: '11000001111', updated_by: 'owner@a.com' })
    expect(Object.keys(empWrites()[0]!.values as object).sort()).toEqual(['phone', 'updated_by'])
  })

  it('o PUT filtra o UPDATE também por organization_id', async () => {
    await update('e-a1', { phone: '1' })
    expect(empWrites()[0]!.filters).toContain('organization_id=org-a')
    expect(empWrites()[0]!.filters).toContain('id=e-a1')
  })
})

describe('EMP-13: PUT não troca o e-mail de funcionário com usuário vinculado', () => {
  it('e-mail diferente -> 400, nada gravado (funcionário e perfil intactos)', async () => {
    const empBefore = structuredClone(row('e-a-link'))
    const profBefore = structuredClone(profile('p-edu'))
    const res = await update('e-a-link', { email: 'outro@a.com', phone: '9' })
    expect(res.status).toBe(400)
    expect(res.error?.statusMessage).toContain('Não é possível alterar o e-mail')
    expect(row('e-a-link')).toEqual(empBefore)
    expect(profile('p-edu')).toEqual(profBefore)
    expect(fake.writes).toHaveLength(0)
  })

  it('limpar o e-mail ("") também é troca -> 400', async () => {
    const res = await update('e-a-link', { email: '' })
    expect(res.status).toBe(400)
    expect(row('e-a-link').email).toBe('edu@a.com')
    expect(fake.writes).toHaveLength(0)
  })

  it('mesmo e-mail -> 200 e o e-mail não muda; os demais campos são gravados', async () => {
    const res = await update('e-a-link', { email: 'edu@a.com', phone: '11555550000' })
    expect(res.status).toBe(200)
    expect(row('e-a-link')).toMatchObject({ email: 'edu@a.com', phone: '11555550000' })
  })

  it('sem usuário vinculado o e-mail pode mudar -> 200', async () => {
    const res = await update('e-a1', { email: 'ana.nova@a.com' })
    expect(res.status).toBe(200)
    expect(row('e-a1').email).toBe('ana.nova@a.com')
  })
})

describe('EMP-03a: PUT com termination_date passada revoga o acesso do usuário vinculado', () => {
  it('termination_date passada -> 200, perfil inativo e sem organização nem papel; outros perfis intactos', async () => {
    const others = structuredClone(profiles().filter(p => p.id !== 'p-edu'))
    const res = await update('e-a-link', { termination_date: '2020-01-01' })
    expect(res.status).toBe(200)
    expect(row('e-a-link').termination_date).toBe('2020-01-01')
    expect(profile('p-edu')).toMatchObject({ is_active: false, organization_id: null, role_id: null, employee_id: 'e-a-link', updated_by: 'owner@a.com' })
    expect(profiles().filter(p => p.id !== 'p-edu')).toEqual(others)
  })

  it('controle: termination_date futura mantém o acesso (perfil ativo, org A, papel employee)', async () => {
    const res = await update('e-a-link', { termination_date: '2099-01-01' })
    expect(res.status).toBe(200)
    expect(profile('p-edu')).toMatchObject({ is_active: true, organization_id: 'org-a', role_id: 'r-employee' })
  })
})

describe('EMP-14: PUT não encontrado', () => {
  for (const [label, id] of [['id inexistente', 'nope'], ['funcionário excluído', 'e-a-del']] as const) {
    it(`${label} -> 404, nada alterado`, async () => {
      const before = structuredClone(fake.tables)
      const res = await update(id, { phone: '1' })
      expect(res.status).toBe(404)
      expect(res.error?.statusMessage).toBe('Employee not found or access denied')
      expect(fake.writes).toHaveLength(0)
      expect(fake.tables).toEqual(before)
    })
  }
})

describe('EMP-06d: PUT em funcionário de B logado em A', () => {
  it('-> 404, B e user_profiles de B inalterados (mesmo com role_id, termination_date e organization_id no corpo)', async () => {
    const before = structuredClone(fake.tables)
    const res = await update('e-b-link', { name: 'Hack', phone: '1', role_id: 'r-employee', termination_date: '2020-01-01', organization_id: 'org-a' })
    expect(res.status).toBe(404)
    expect(row('e-b-link')).toEqual(before.employees!.find(e => e.id === 'e-b-link'))
    expect(profile('p-beto')).toEqual(before.user_profiles!.find(p => p.id === 'p-beto'))
    expect(fake.writes).toHaveLength(0)
    expect(fake.tables).toEqual(before)
  })
})

describe('EMP-01c: PUT role_id de funcionário vinculado (G1-SD-05, KF-53; permissão KF-52/KF-09)', () => {
  // r-admin-b é o papel "admin" de sistema da org B.
  it('controle [caracteriza comportamento atual; decisão em G1-OQ-01 e KF-09]: emp-sem PUT {role_id} em funcionário vinculado -> 200 e user_profiles é escrito', async () => {
    loginAs('emp-sem')
    const res = await update('e-a-link', { role_id: 'r-admin-b' })
    expect(res.status).toBe(200)
    expect(profileWrites().length).toBeGreaterThan(0)
  })
  it.fails('EMP-01c: PUT {role_id de B} por emp-sem -> 403 e nenhum user_profiles alterado [KF-52]', async () => {
    loginAs('emp-sem')
    const profBefore = structuredClone(profiles())
    const res = await update('e-a-link', { role_id: 'r-admin-b' })
    expect(res.status).toBe(403)
    expect(profileWrites()).toHaveLength(0)
    expect(profiles()).toEqual(profBefore)
  })
  // Caracterização (não é contrato correto): sem o papel `employee` de sistema, o sync lança 422 DEPOIS de o PUT já ter gravado o role_id de B.
  it('caracteriza comportamento atual: PUT com role_id de B persiste quando o papel employee de sistema não existe', async () => {
    fake.tables.roles = fake.tables.roles!.filter(r => !(r.name === 'employee' && r.organization_id === 'org-a'))
    const res = await update('e-a-link', { role_id: 'r-admin-b' })
    expect(res.status).toBe(422)
    expect(profile('p-edu').role_id).toBe('r-admin-b')
  })
  it.fails('EMP-01c: PUT {role_id de B} por quem pode editar (owner) -> 400/404 e nenhum user_profiles escrito com o papel de B [KF-53]', async () => {
    const res = await update('e-a-link', { role_id: 'r-admin-b' })
    expect([400, 404]).toContain(res.status)
    expect(profileWrites().some(w => (w.values as Record<string, unknown>).role_id === 'r-admin-b')).toBe(false)
  })
})

describe('EMP-03b / EMP-15 / EMP-06f: DELETE (soft)', () => {
  it('EMP-03b: funcionário vinculado -> 200 {success:true}, deleted_at/deleted_by gravados, linha continua na tabela', async () => {
    const res = await remove('e-a-link')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(row('e-a-link').deleted_at).toBeTruthy()
    expect(row('e-a-link').deleted_by).toBe('owner@a.com')
    expect(employees()).toHaveLength(SEED_SIZE)
    expect(empWrites().every(w => w.op === 'update')).toBe(true)
  })

  it('EMP-03b: desativa o usuário vinculado (inativo, sem org e sem papel) e o funcionário some da lista', async () => {
    await remove('e-a-link')
    expect(profile('p-edu')).toMatchObject({ is_active: false, organization_id: null, role_id: null, employee_id: 'e-a-link' })
    const ids = ((await list()).body as ListBody).items.map(i => i.id)
    expect(ids).not.toContain('e-a-link')
    expect(ids).toContain('e-a1')
    // perfis de outras pessoas não mudam
    expect(profile('p-beto')).toMatchObject({ is_active: true, organization_id: 'org-b' })
    expect(profile('p-owner')).toMatchObject({ is_active: true, organization_id: 'org-a' })
  })

  it('funcionário sem usuário vinculado -> 200 e nenhum perfil é escrito', async () => {
    const res = await remove('e-a1')
    expect(res.status).toBe(200)
    expect(profileWrites()).toHaveLength(0)
  })

  it('EMP-15: segundo DELETE -> 404, deleted_at original mantido', async () => {
    await remove('e-a1')
    const first = row('e-a1').deleted_at
    const writes = fake.writes.length
    const res = await remove('e-a1')
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Employee not found or access denied')
    expect(row('e-a1').deleted_at).toBe(first)
    expect(fake.writes).toHaveLength(writes)
  })

  for (const [label, id] of [['inexistente', 'nope'], ['já excluído no seed', 'e-a-del']] as const) {
    it(`EMP-15: DELETE em funcionário ${label} -> 404, nada alterado`, async () => {
      const before = structuredClone(fake.tables)
      const res = await remove(id)
      expect(res.status).toBe(404)
      expect(fake.writes).toHaveLength(0)
      expect(fake.tables).toEqual(before)
    })
  }

  it('EMP-06f: funcionário de B logado em A -> 404, B e o perfil de B intactos', async () => {
    const before = structuredClone(fake.tables)
    const res = await remove('e-b-link')
    expect(res.status).toBe(404)
    expect(row('e-b-link').deleted_at).toBeNull()
    expect(profile('p-beto')).toMatchObject({ is_active: true, organization_id: 'org-b', role_id: 'r-employee-b' })
    expect(fake.writes).toHaveLength(0)
    expect(fake.tables).toEqual(before)
  })
})

describe('EMP-06c / EMP-06e / EMP-06g: emp-sem não deveria escrever (KF-09, KF-52)', () => {
  beforeEach(() => loginAs('emp-sem'))
  it('controle EMP-06c [caracteriza comportamento atual; decisão em G1-OQ-01 e KF-09]: emp-sem POST -> 200 e linha criada', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(empWrites()).toHaveLength(1)
    expect(employees()).toHaveLength(SEED_SIZE + 1)
  })
  it('controle EMP-06e [caracteriza comportamento atual; decisão em G1-OQ-01 e KF-09]: emp-sem PUT -> 200 e phone gravado', async () => {
    const res = await update('e-a1', { phone: '11000001111' })
    expect(res.status).toBe(200)
    expect(row('e-a1').phone).toBe('11000001111')
    expect(empWrites()).toHaveLength(1)
  })
  it('controle EMP-06g [caracteriza comportamento atual; decisão em G1-OQ-01 e KF-09]: emp-sem DELETE -> 200 e deleted_at gravado', async () => {
    const res = await remove('e-a1')
    expect(res.status).toBe(200)
    expect(row('e-a1').deleted_at).toBeTruthy()
    expect(empWrites()).toHaveLength(1)
  })
  it.fails('EMP-06c: POST como emp-sem -> 403 [KF-52]', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(403)
  })
  it.fails('EMP-06e: PUT como emp-sem -> 403 [KF-52]', async () => {
    const res = await update('e-a1', { phone: '11000001111' })
    expect(res.status).toBe(403)
  })
  it.fails('EMP-06g: DELETE como emp-sem -> 403 [KF-52]', async () => {
    const res = await remove('e-a1')
    expect(res.status).toBe(403)
  })
})

describe('Decisões de produto pendentes (it.todo)', () => {
  it.todo('EMP-11: POST com tax_id já existente na org (duplicado). Aguarda G1-OQ-09 (a regra de duplicidade não está definida; sem constraint única no fake)')
  it.todo('EMP-04a: DELETE de funcionário com comissão pendente e paga e bônus atribuído: efeito em comissões pendentes e atribuições. Aguarda G1-OQ-10 (G1-SD-10)')
})

// Verificado por grep em server/api/employees: index.post, [id].put e [id].delete não chamam requireOrgPermission (KF-09, KF-52).
// Chaves definidas em action-codes.ts: employees.create/update/delete (ActionCode.EMPLOYEES_*), usadas pela página de funcionários.
// emp-com (role r-com do seed, com as 3 chaves concedidas) é controle positivo: o 200 vale hoje com ou sem a chave.
describe('EMP-06c / EMP-06e / EMP-06g: emp-com -> 200', () => {
  beforeEach(() => loginAs('emp-com'))
  it('EMP-06c: POST como emp-com -> 200 (caracteriza comportamento atual; chave employees.create definida em action-codes.ts, handler sem guarda (KF-09))', async () => {
    const res = await create(VALID)
    expect(res.status).toBe(200)
    expect(employees()).toHaveLength(SEED_SIZE + 1)
  })
  it('EMP-06e: PUT como emp-com -> 200 (caracteriza comportamento atual; chave employees.update definida em action-codes.ts, handler sem guarda (KF-09))', async () => {
    const res = await update('e-a1', { phone: '11000001111' })
    expect(res.status).toBe(200)
    expect(row('e-a1').phone).toBe('11000001111')
  })
  it('EMP-06g: DELETE como emp-com -> 200 (caracteriza comportamento atual; chave employees.delete definida em action-codes.ts, handler sem guarda (KF-09))', async () => {
    const res = await remove('e-a1')
    expect(res.status).toBe(200)
    expect(row('e-a1').deleted_at).toBeTruthy()
  })
})
