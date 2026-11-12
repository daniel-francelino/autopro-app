// Handler de POST /api/employees/:id/grant-access contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 4 (EMP-01a, 01b, 01d, 01e, 01f, 06n). EMP-01c (PUT role_id) está em crud.test.ts.
//  - 401 sem sessão já é provado por guard-matrix.test.ts; não se repete aqui.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md, KF-52; faceta do KF-09).
//    Ao corrigir o handler o Vitest acusa "unexpected pass": troque it.fails por it.
//  - Mocks: o handler usa `supabase.auth.admin.createUser` (cliente admin) e `supabaseAnon.auth.resetPasswordForEmail`.
//    O fake de tabelas não tem `auth`; aqui o cliente admin é o fake + `auth.admin.createUser` (vi.fn), e o anon ganha `resetPasswordForEmail`.
//  - Limitações do fake: `upsert` sempre insere (não resolve onConflict 'user_id'), então "1 perfil por e-mail" não se prova contando linhas
//    após um segundo POST; prova-se que todo upsert usa o mesmo user_id (a unicidade de user_id fica no banco, não coberta aqui).
//    `or()` é no-op, `range()` só limita.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { employeesSeed, USERS, type Persona } from './employees-seed'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn(), resetPasswordForEmail: vi.fn() }
const { createUser } = vi.hoisted(() => ({ createUser: vi.fn() }))

vi.mock('../../../server/utils/supabase', () => ({
  getSupabaseAdminClient: () => ({ from: (table: string) => fake.client.from(table), auth: { admin: { createUser } } })
}))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const GRANT = 'server/api/employees/[id]/grant-access.post.ts'

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

let created = 0
beforeEach(() => {
  fake = createFakeSupabase(employeesSeed())
  loginAs('owner')
  auth.refreshSession.mockReset()
  auth.resetPasswordForEmail.mockReset().mockResolvedValue({ error: null })
  created = 0
  createUser.mockReset().mockImplementation(async () => ({ data: { user: { id: `auth-new-${++created}` } }, error: null }))
})

const grant = (id: string) => callHandler(GRANT, fakeEvent({ method: 'POST', cookies, params: { id } }))
const table = (name: string) => fake.tables[name]!
const profilesByEmail = (email: string) => table('user_profiles').filter(p => p.email === email)
const profileWrites = () => fake.writes.filter(w => w.table === 'user_profiles')
const provisioningWrites = () => fake.writes.filter(w => ['user_profiles', 'user_preferences', 'notification_preferences'].includes(w.table))
const SEED_PROFILES = employeesSeed().user_profiles!.length

describe('EMP-01a: grant-access cria usuário e vínculo', () => {
  it('funcionário de A com e-mail: 200, usuário criado, perfil de A com employee_id e papel employee, e-mail de redefinição enviado', async () => {
    const res = await grant('e-a1')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true })
    expect(createUser).toHaveBeenCalledTimes(1)
    expect(createUser.mock.calls[0]![0]).toMatchObject({ email: 'ana@a.com', email_confirm: true, user_metadata: { name: 'Ana Ativa' } })
    // a senha temporária nunca é fixa nem vazia
    expect(typeof createUser.mock.calls[0]![0].password).toBe('string')
    expect(createUser.mock.calls[0]![0].password.length).toBeGreaterThan(20)

    const profiles = profilesByEmail('ana@a.com')
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({
      user_id: 'auth-new-1', organization_id: 'org-a', employee_id: 'e-a1', role_id: 'r-employee', is_active: true, created_by: 'owner@a.com'
    })
    expect(profiles[0]!.is_owner).toBeUndefined()
    // preferências padrão criadas para o mesmo usuário
    expect(table('user_preferences').map(p => p.user_id)).toEqual(['auth-new-1'])
    expect(table('notification_preferences').map(p => p.user_id)).toEqual(['auth-new-1'])

    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1)
    expect(auth.resetPasswordForEmail.mock.calls[0]![0]).toBe('ana@a.com')
    expect(String(auth.resetPasswordForEmail.mock.calls[0]![1].redirectTo)).toMatch(/\/reset-password$/)
  })

  it('e-mail do funcionário é aparado e passa para minúsculas antes de criar usuário e perfil', async () => {
    const res = await grant('e-a-case')
    expect(res.status).toBe(200)
    expect(createUser.mock.calls[0]![0].email).toBe('caso@a.com')
    expect(profilesByEmail('caso@a.com')).toHaveLength(1)
    expect(auth.resetPasswordForEmail.mock.calls[0]![0]).toBe('caso@a.com')
  })

  it('não altera o funcionário nem usuários de outras pessoas', async () => {
    const employeesBefore = structuredClone(table('employees'))
    const profilesBefore = structuredClone(table('user_profiles'))
    await grant('e-a1')
    expect(table('employees')).toEqual(employeesBefore)
    expect(table('user_profiles').slice(0, SEED_PROFILES)).toEqual(profilesBefore)
  })
})

describe('EMP-01e: e-mail já existente', () => {
  it('(a) já é usuário da mesma org: reaproveita o user_id e vincula, sem criar usuário novo', async () => {
    table('user_profiles').push({ id: 'p-ana-old', user_id: 'u-ana', organization_id: 'org-a', role_id: null, employee_id: null, is_active: true, email: 'ana@a.com' })
    const res = await grant('e-a1')
    expect(res.status).toBe(200)
    expect(createUser).not.toHaveBeenCalled()
    const upsert = profileWrites().find(w => w.op === 'upsert')!
    expect(upsert.values).toMatchObject({ user_id: 'u-ana', organization_id: 'org-a', employee_id: 'e-a1', role_id: 'r-employee', is_active: true })
    // nenhum user_id diferente do existente aparece para este e-mail
    expect(new Set(profilesByEmail('ana@a.com').map(p => p.user_id))).toEqual(new Set(['u-ana']))
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1)
  })

  it('(a2) o funcionário já tinha perfil vinculado na mesma org, com outro e-mail no perfil: reaproveita o user_id dele', async () => {
    // perfil do funcionário e-a-link (u-edu); o e-mail do funcionário não tem perfil por e-mail -> usa o vínculo existente
    table('employees').find(e => e.id === 'e-a-link')!.email = 'novo-edu@a.com'
    const res = await grant('e-a-link')
    expect(res.status).toBe(200)
    expect(createUser).not.toHaveBeenCalled()
    expect(profileWrites().find(w => w.op === 'upsert')!.values).toMatchObject({ user_id: 'u-edu', employee_id: 'e-a-link', organization_id: 'org-a' })
  })

  it('(b) e-mail já é usuário de outra org: 400 "outra organização", nada criado ou enviado', async () => {
    table('user_profiles').push({ id: 'p-ana-b', user_id: 'u-ana-b', organization_id: 'org-b', role_id: 'r-employee-b', employee_id: null, is_active: true, email: 'ana@a.com' })
    const before = structuredClone(table('user_profiles'))
    const res = await grant('e-a1')
    expect(res.status).toBe(400)
    expect(res.error?.statusMessage).toContain('outra organização')
    expect(createUser).not.toHaveBeenCalled()
    expect(provisioningWrites()).toHaveLength(0)
    expect(table('user_profiles')).toEqual(before)
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('(b2) o funcionário já está vinculado a um perfil de outra org: 400 "outra organização", nada criado', async () => {
    table('user_profiles').push({ id: 'p-ana-link-b', user_id: 'u-ana-link-b', organization_id: 'org-b', role_id: 'r-employee-b', employee_id: 'e-a1', is_active: true, email: 'outro@b.com' })
    const res = await grant('e-a1')
    expect(res.status).toBe(400)
    expect(res.error?.statusMessage).toContain('outra organização')
    expect(createUser).not.toHaveBeenCalled()
    expect(provisioningWrites()).toHaveLength(0)
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('(c) POST repetido: dois 200, um único usuário criado e o mesmo user_id nos dois upserts (idempotente)', async () => {
    const first = await grant('e-a1')
    const second = await grant('e-a1')
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(createUser).toHaveBeenCalledTimes(1)
    const upserts = profileWrites().filter(w => w.op === 'upsert')
    expect(upserts).toHaveLength(2)
    expect(new Set(upserts.map(w => (w.values as Record<string, unknown>).user_id))).toEqual(new Set(['auth-new-1']))
    expect(upserts.every(w => (w.values as Record<string, unknown>).employee_id === 'e-a1')).toBe(true)
    // limitação do fake: o upsert não faz merge, então não se conta linhas (ver cabeçalho do arquivo)
  })
})

describe('EMP-01f: grant-access recusa entradas inválidas', () => {
  for (const [label, id] of [['null', 'e-a-noemail'], ['só espaços', 'e-a-blank']] as const) {
    it(`funcionário sem e-mail (${label}) -> 400, nada criado`, async () => {
      const res = await grant(id)
      expect(res.status).toBe(400)
      expect(res.error?.statusMessage).toContain('não tem email')
      expect(createUser).not.toHaveBeenCalled()
      expect(provisioningWrites()).toHaveLength(0)
      expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
    })
  }

  it('sem papel de sistema "employee" na org de A (o de B continua existindo) -> 422, nada criado', async () => {
    fake.tables.roles = table('roles').filter(r => r.id !== 'r-employee')
    expect(table('roles').some(r => r.id === 'r-employee-b')).toBe(true)
    const res = await grant('e-a1')
    expect(res.status).toBe(422)
    expect(res.error?.statusMessage).toContain('Role de funcionário não encontrada')
    expect(createUser).not.toHaveBeenCalled()
    expect(provisioningWrites()).toHaveLength(0)
  })

  it('papel "employee" que não é de sistema não conta -> 422', async () => {
    table('roles').find(r => r.id === 'r-employee')!.is_system_role = false
    const res = await grant('e-a1')
    expect(res.status).toBe(422)
    expect(createUser).not.toHaveBeenCalled()
  })

  for (const [label, id] of [['excluído', 'e-a-del'], ['inexistente', 'nope']] as const) {
    it(`funcionário ${label} -> 404 "Funcionário não encontrado", nada criado`, async () => {
      const res = await grant(id)
      expect(res.status).toBe(404)
      expect(res.error?.statusMessage).toBe('Funcionário não encontrado')
      expect(createUser).not.toHaveBeenCalled()
      expect(provisioningWrites()).toHaveLength(0)
    })
  }

  it('falha no envio do e-mail -> 500 com mensagem explicando; o vínculo já está criado', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'smtp down' } })
    const res = await grant('e-a1')
    expect(res.status).toBe(500)
    expect(res.error?.statusMessage).toContain('A conta foi criada e vinculada')
    expect(res.error?.statusMessage).toContain('não foi possível enviar o email')
    expect(profilesByEmail('ana@a.com')[0]).toMatchObject({ user_id: 'auth-new-1', organization_id: 'org-a', employee_id: 'e-a1', role_id: 'r-employee' })
  })

  it('falha ao criar o usuário de autenticação -> 500, nenhum perfil e nenhum e-mail', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { message: 'duplicate' } })
    const res = await grant('e-a1')
    expect(res.status).toBe(500)
    expect(provisioningWrites()).toHaveLength(0)
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })
})

describe('EMP-06n: funcionário de B logado em A', () => {
  it('POST -> 404, nenhum usuário criado, nada gravado nem enviado', async () => {
    const before = structuredClone(fake.tables)
    const res = await grant('e-b1')
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Funcionário não encontrado')
    expect(createUser).not.toHaveBeenCalled()
    expect(fake.writes).toHaveLength(0)
    expect(fake.tables).toEqual(before)
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })
})

describe('EMP-01b: emp-sem não deveria conceder acesso (KF-09, KF-52)', () => {
  beforeEach(() => loginAs('emp-sem'))
  it('controle [caracteriza comportamento atual; decisão em G1-OQ-01 e KF-09]: emp-sem POST -> 200, usuário criado e papel concedido é sempre o "employee" da org', async () => {
    const res = await grant('e-a1')
    expect(res.status).toBe(200)
    expect(createUser).toHaveBeenCalledTimes(1)
    const profile = profilesByEmail('ana@a.com')[0]!
    expect(profile).toMatchObject({ organization_id: 'org-a', employee_id: 'e-a1', role_id: 'r-employee', created_by: 'emp@a.com' })
    expect(profile.is_owner).toBeUndefined()
    // o papel concedido é o de sistema "employee": nunca o papel de quem concede nem um admin
    expect(table('roles').find(r => r.id === profile.role_id)).toMatchObject({ name: 'employee', is_system_role: true })
    expect(profile.role_id).not.toBe('r-operador')
  })
  it.fails('EMP-01b: POST como emp-sem -> 403 e nenhum usuário criado [KF-52]', async () => {
    const res = await grant('e-a1')
    expect(res.status).toBe(403)
    expect(createUser).not.toHaveBeenCalled()
    expect(table('user_profiles')).toHaveLength(SEED_PROFILES)
  })
})

describe('Decisões de produto pendentes (it.todo)', () => {
  it.todo('EMP-01d: org no limite de usuários do plano -> grant-access respeita o limite. Aguarda G1-OQ-11 (G1-SD-07 não confirmado); não é it.fails')
  it.todo('EMP-01b emp-com: POST 200 com a permissão de gestão de funcionários. Aguarda G1-OQ-01 (chave de permissão indefinida)')
})
