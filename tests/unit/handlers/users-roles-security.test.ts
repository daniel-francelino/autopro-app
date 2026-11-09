// L3-lite P0: users e roles (R1/R2). Handlers reais + Supabase falso.
// KF-11 a KF-15, KF-17 e KF-16 (papéis) foram corrigidos em 2026-11-09 (Fase 0a do plano do painel do owner):
// os testes abaixo agora são normais. `users/assign-organization` foi APAGADA (sem chamador).
// Ver docs/testing/known-failures.md.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../helpers/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fake-supabase'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const login = (id: string, email: string) =>
  auth.getUser.mockResolvedValue({ data: { user: { id, email } }, error: null })

function seed() {
  fake = createFakeSupabase({
    // p1 = funcionário comum da org A, sem permissão de administrar nada
    // p2 = usuário da org B (vítima), p3 = usuário sem organização
    user_profiles: [
      { id: 'p1', user_id: 'u1', email: 'func@a.com', organization_id: 'org-a', role_id: 'role-emp-a', is_owner: false, is_active: true, employee_id: null },
      { id: 'p2', user_id: 'u2', email: 'dono@b.com', organization_id: 'org-b', role_id: 'role-admin-b', is_owner: false, is_active: true, employee_id: null },
      { id: 'p3', user_id: 'u3', email: 'novo@x.com', organization_id: null, role_id: null, is_owner: false, is_active: true, employee_id: null },
      { id: 'p4', user_id: 'u4', email: 'colega@a.com', organization_id: 'org-a', role_id: 'role-emp-a', is_owner: false, is_active: true, employee_id: null },
      // p5 = administrador da org A (papel de sistema `admin`)
      { id: 'p5', user_id: 'u5', email: 'admin@a.com', organization_id: 'org-a', role_id: 'role-admin-a', is_owner: false, is_active: true, employee_id: null }
    ],
    roles: [
      { id: 'role-emp-a', organization_id: 'org-a', name: 'employee', display_name: 'Funcionário', is_system_role: true, deleted_at: null },
      { id: 'role-admin-a', organization_id: 'org-a', name: 'admin', display_name: 'Admin', is_system_role: true, deleted_at: null },
      { id: 'role-admin-b', organization_id: 'org-b', name: 'admin', display_name: 'Admin B', is_system_role: true, deleted_at: null }
    ],
    actions: [{ id: 'act-1', code: 'customers.create', deleted_at: null }],
    role_actions: [],
    subscriptions: []
  })
}

const asAdmin = () => login('u5', 'admin@a.com')
const profile = (id: string) => fake.tables.user_profiles!.find(p => p.id === id)!

beforeEach(() => {
  seed()
  auth.getUser.mockReset()
  auth.refreshSession.mockReset()
  login('u1', 'func@a.com')
})

const post = (file: string, body: unknown, params: Record<string, string> = {}) =>
  callHandler(file, fakeEvent({ method: 'POST', cookies, body, params }))

describe('users/update-role', () => {
  const file = 'server/api/users/update-role.post.ts'

  it('exige user_id e role_id', async () => {
    expect((await post(file, {})).status).toBe(400)
    expect((await post(file, { user_id: 'p4' })).status).toBe(400)
  })
  it('recusa usuário alvo de OUTRA organização (isolamento)', async () => {
    asAdmin()
    const r = await post(file, { user_id: 'p2', role_id: 'role-emp-a' })
    expect(r.status).toBe(403)
    expect(profile('p2').role_id).toBe('role-admin-b')
  })
  it('alvo inexistente → 404', async () => {
    asAdmin()
    expect((await post(file, { user_id: 'nao-existe', role_id: 'x' })).status).toBe(404)
  })
  it('funcionário SEM permissão não pode mudar papéis (R2)', async () => {
    const r = await post(file, { user_id: 'p4', role_id: 'role-admin-a' })
    expect(r.status).toBe(403)
    expect(profile('p4').role_id).toBe('role-emp-a')
  })
  it('funcionário não consegue se promover a admin', async () => {
    await post(file, { user_id: 'p1', role_id: 'role-admin-a' })
    expect(profile('p1').role_id).toBe('role-emp-a')
  })
  it('role_id de OUTRA organização é recusado', async () => {
    asAdmin()
    const r = await post(file, { user_id: 'p4', role_id: 'role-admin-b' })
    expect(r.status).toBe(404)
    expect(profile('p4').role_id).toBe('role-emp-a')
  })
  it('administrador da oficina troca o papel de um colega da própria oficina', async () => {
    asAdmin()
    const r = await post(file, { user_id: 'p4', role_id: 'role-admin-a' })
    expect(r.status).toBe(200)
    expect(profile('p4').role_id).toBe('role-admin-a')
  })
})

describe('users/update-fields', () => {
  const file = 'server/api/users/update-fields.post.ts'

  it('exige user_id', async () => {
    expect((await post(file, {})).status).toBe(400)
  })
  it('sem campos → no-op', async () => {
    expect((await post(file, { user_id: 'p4' })).body).toMatchObject({ success: true })
  })
  it('não permite alterar usuário de OUTRA organização (R1)', async () => {
    asAdmin()
    const r = await post(file, { user_id: 'p2', role_id: 'role-emp-a' })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(profile('p2').role_id).toBe('role-admin-b')
  })
  it('ignora organization_id, employee_id e email do corpo (entrar em outra oficina)', async () => {
    await post(file, { user_id: 'p1', organization_id: 'org-b', role_id: 'role-admin-b', employee_id: 'e', email: 'x@x.com' })
    expect(profile('p1')).toMatchObject({ organization_id: 'org-a', role_id: 'role-emp-a', employee_id: null, email: 'func@a.com' })
    asAdmin()
    await post(file, { user_id: 'p4', organization_id: 'org-b', email: 'x@x.com', role_id: 'role-admin-a' })
    expect(profile('p4')).toMatchObject({ organization_id: 'org-a', email: 'colega@a.com', role_id: 'role-admin-a' })
  })
  it('funcionário sem permissão não altera papel de colega', async () => {
    await post(file, { user_id: 'p4', role_id: 'role-admin-a' })
    expect(profile('p4').role_id).toBe('role-emp-a')
  })
})

describe('rotas removidas (sem chamador no front)', () => {
  it.each([
    'server/api/users/assign-organization.post.ts',
    'server/api/users/get-by-email.post.ts',
    'server/api/service-orders/commission-seed-status.get.ts',
    'server/api/consulta/index.get.ts',
    'server/api/reports/export-file.post.ts'
  ])('%s não existe mais', async (file) => {
    const { existsSync } = await import('node:fs')
    expect(existsSync(file)).toBe(false)
  })
})

describe('roles', () => {
  const grant = 'server/api/roles/[id]/actions.post.ts'

  it('papel de outra organização é invisível (404)', async () => {
    asAdmin()
    const r = await post(grant, { action_id: 'act-1', is_granted: true }, { id: 'role-admin-b' })
    expect(r.status).toBe(404)
    expect(fake.tables.role_actions).toHaveLength(0)
  })
  it('valida corpo', async () => {
    asAdmin()
    expect((await post(grant, {}, { id: 'role-emp-a' })).status).toBe(400)
  })
  it('funcionário sem permissão não consegue se dar permissões (R2)', async () => {
    const r = await post(grant, { action_id: 'act-1', is_granted: true }, { id: 'role-emp-a' })
    expect(r.status).toBe(403)
    expect(fake.tables.role_actions).toHaveLength(0)
  })
  it.fails('papel de sistema não pode ser excluído', async () => {
    asAdmin()
    const r = await callHandler('server/api/roles/[id].delete.ts', fakeEvent({ method: 'DELETE', cookies, params: { id: 'role-admin-a' } }))
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(fake.tables.roles!.find(x => x.id === 'role-admin-a')!.deleted_at).toBeNull()
  })
  it('papel de outra organização não pode ser excluído', async () => {
    asAdmin()
    const r = await callHandler('server/api/roles/[id].delete.ts', fakeEvent({ method: 'DELETE', cookies, params: { id: 'role-admin-b' } }))
    expect(r.status).toBe(404)
    expect(fake.tables.roles!.find(x => x.id === 'role-admin-b')!.deleted_at).toBeNull()
  })
  it('POST /roles ignora organization_id do corpo e nasce como papel comum', async () => {
    asAdmin()
    const r = await post('server/api/roles/index.post.ts', { name: 'novo', display_name: 'Novo', organization_id: 'org-b', is_system_role: true })
    expect(r.status).toBe(200)
    const created = fake.tables.roles!.find(x => x.name === 'novo')!
    expect(created.organization_id).toBe('org-a')
    expect(created.is_system_role).toBe(false)
  })
  it('funcionário sem permissão não cria papéis', async () => {
    const r = await post('server/api/roles/index.post.ts', { name: 'x', display_name: 'X' })
    expect(r.status).toBe(403)
  })
})
