import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fake-supabase'

let fake: FakeSupabase

vi.mock('../../../server/utils/supabase', () => ({
  getSupabaseAdminClient: () => fake.client
}))

// requireAuthUser: colaboradores externos
const anon = {
  getUser: vi.fn(),
  refreshSession: vi.fn()
}
let cookies: { access?: string, refresh?: string, userCookie?: unknown }
const setAuthCookies = vi.fn()
const setAuthUserCookie = vi.fn()

vi.mock('../../../server/utils/supabase-anon', () => ({
  getSupabaseAnonClient: () => ({ auth: anon })
}))
vi.mock('../../../server/utils/auth-cookies', () => ({
  getAccessTokenFromCookies: () => cookies.access,
  getRefreshTokenFromCookies: () => cookies.refresh,
  setAuthCookies: (...a: unknown[]) => setAuthCookies(...a),
  clearAuthCookies: vi.fn()
}))
vi.mock('../../../server/utils/auth-user', () => ({
  getAuthUserCookie: () => cookies.userCookie ?? null,
  setAuthUserCookie: (...a: unknown[]) => setAuthUserCookie(...a),
  clearAuthUserCookie: vi.fn(),
  toAuthUser: (u: { id: string, email?: string }) => ({ id: u.id, email: u.email ?? null, user_metadata: {} })
}))

const { resolveOrganizationId } = await import('../../../server/utils/organization')
const { requireOrgPermission } = await import('../../../server/utils/require-org-permission')
const { requireOwner } = await import('../../../server/utils/require-owner')
const { requireAuthUser } = await import('../../../server/utils/require-auth')
const { enforceEmployeeLimit, enforceReportAccess, resolveOrgLicense } = await import('../../../server/utils/license')

const event = {} as never

// ───────────────────────────── resolveOrganizationId ─────────────────────────────
describe('resolveOrganizationId', () => {
  const profile = (o: Record<string, unknown> = {}) => ({ user_id: 'u1', organization_id: 'org-a', employee_id: null, is_active: true, ...o })

  it('sem perfil → 400', async () => {
    fake = createFakeSupabase({ user_profiles: [] })
    await expect(resolveOrganizationId(event, 'u1')).rejects.toMatchObject({ statusCode: 400 })
  })
  it('perfil sem organização → 400', async () => {
    fake = createFakeSupabase({ user_profiles: [profile({ organization_id: null })] })
    await expect(resolveOrganizationId(event, 'u1')).rejects.toMatchObject({ statusCode: 400 })
  })
  it('is_active=false → 403', async () => {
    fake = createFakeSupabase({ user_profiles: [profile({ is_active: false })] })
    await expect(resolveOrganizationId(event, 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('ok → devolve a organização', async () => {
    fake = createFakeSupabase({ user_profiles: [profile()] })
    expect(await resolveOrganizationId(event, 'u1')).toBe('org-a')
  })
  it('erro de banco → 500', async () => {
    fake = createFakeSupabase({ user_profiles: [profile()] })
    fake.failNext('user_profiles')
    await expect(resolveOrganizationId(event, 'u1')).rejects.toMatchObject({ statusCode: 500 })
  })
  it('funcionário ativo (sem desligamento) passa', async () => {
    fake = createFakeSupabase({
      user_profiles: [profile({ employee_id: 'e1' })],
      employees: [{ id: 'e1', name: 'Zé', termination_date: null, deleted_at: null }]
    })
    expect(await resolveOrganizationId(event, 'u1')).toBe('org-a')
  })
  it('funcionário desligado → 403 e revoga o acesso do perfil', async () => {
    fake = createFakeSupabase({
      user_profiles: [profile({ employee_id: 'e1', role_id: 'r1' })],
      employees: [{ id: 'e1', name: 'Zé', termination_date: '2020-01-01', deleted_at: null }]
    })
    await expect(resolveOrganizationId(event, 'u1')).rejects.toMatchObject({ statusCode: 403 })
    expect(fake.tables.user_profiles![0]).toMatchObject({ is_active: false, organization_id: null, role_id: null })
  })
  it('funcionário com desligamento futuro ainda tem acesso', async () => {
    fake = createFakeSupabase({
      user_profiles: [profile({ employee_id: 'e1' })],
      employees: [{ id: 'e1', name: 'Zé', termination_date: '2999-01-01', deleted_at: null }]
    })
    expect(await resolveOrganizationId(event, 'u1')).toBe('org-a')
  })
  it('funcionário excluído (deleted_at) → 403', async () => {
    fake = createFakeSupabase({
      user_profiles: [profile({ employee_id: 'e1' })],
      employees: [{ id: 'e1', name: 'Zé', termination_date: null, deleted_at: '2026-01-01' }]
    })
    await expect(resolveOrganizationId(event, 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ───────────────────────────── requireOrgPermission ─────────────────────────────
describe('requireOrgPermission', () => {
  const base = (over: Record<string, Array<Record<string, unknown>>> = {}) => createFakeSupabase({
    user_profiles: [{ user_id: 'u1', organization_id: 'org-a', role_id: 'r1', is_owner: false, is_active: true }],
    roles: [{ id: 'r1', name: 'mecanico', is_system_role: false }],
    actions: [{ id: 'a1', code: 'clients.create', deleted_at: null }],
    role_actions: [{ role_id: 'r1', action_id: 'a1', is_granted: true }],
    subscriptions: [{ organization_id: 'org-a', plan_key: 'starter', status: 'active', deleted_at: null }],
    ...over
  })

  it('sem perfil → 403', async () => {
    fake = base({ user_profiles: [] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('perfil inativo → 403', async () => {
    fake = base({ user_profiles: [{ user_id: 'u1', organization_id: 'org-a', role_id: 'r1', is_active: false }] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('sem organização → 403', async () => {
    fake = base({ user_profiles: [{ user_id: 'u1', organization_id: null, role_id: 'r1', is_active: true }] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('papel com a ação concedida passa', async () => {
    fake = base()
    await expect(requireOrgPermission('u1', 'clients.create')).resolves.toBeUndefined()
  })
  it('is_owner passa sem papel', async () => {
    fake = base({ user_profiles: [{ user_id: 'u1', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true }] })
    await expect(requireOrgPermission('u1', 'clients.create')).resolves.toBeUndefined()
  })
  it('papel admin de sistema passa', async () => {
    fake = base({ roles: [{ id: 'r1', name: 'admin', is_system_role: true }], role_actions: [] })
    await expect(requireOrgPermission('u1', 'clients.create')).resolves.toBeUndefined()
  })
  it('papel chamado "admin" mas NÃO de sistema não passa', async () => {
    fake = base({ roles: [{ id: 'r1', name: 'admin', is_system_role: false }], role_actions: [] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('sem papel atribuído → 403', async () => {
    fake = base({ user_profiles: [{ user_id: 'u1', organization_id: 'org-a', role_id: null, is_owner: false, is_active: true }] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('ação inexistente → 403', async () => {
    fake = base()
    await expect(requireOrgPermission('u1', 'nao.existe')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('is_granted=false → 403', async () => {
    fake = base({ role_actions: [{ role_id: 'r1', action_id: 'a1', is_granted: false }] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('sem linha em role_actions → 403', async () => {
    fake = base({ role_actions: [] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('ação fiscal no plano starter → 403 com nome do plano', async () => {
    fake = base({ actions: [{ id: 'a1', code: 'service_invoice.create', deleted_at: null }] })
    await expect(requireOrgPermission('u1', 'service_invoice.create')).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: expect.stringContaining('Fiscal')
    })
  })
  it('plano é verificado ANTES do bypass de owner', async () => {
    fake = base({ user_profiles: [{ user_id: 'u1', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true }] })
    await expect(requireOrgPermission('u1', 'fiscal.manage')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('ação fiscal no plano fiscal passa', async () => {
    fake = base({
      subscriptions: [{ organization_id: 'org-a', plan_key: 'fiscal', status: 'active', deleted_at: null }],
      actions: [{ id: 'a1', code: 'service_invoice.create', deleted_at: null }]
    })
    await expect(requireOrgPermission('u1', 'service_invoice.create')).resolves.toBeUndefined()
  })
  it('relatório pro no plano starter → 403; no pro passa', async () => {
    fake = base({ actions: [{ id: 'a1', code: 'reports.debtors', deleted_at: null }] })
    await expect(requireOrgPermission('u1', 'reports.debtors')).rejects.toMatchObject({ statusCode: 403 })
    fake.tables.subscriptions![0]!.plan_key = 'pro'
    await expect(requireOrgPermission('u1', 'reports.debtors')).resolves.toBeUndefined()
  })
  it('sem assinatura ativa e ação com plano → 403', async () => {
    fake = base({ subscriptions: [], actions: [{ id: 'a1', code: 'reports.costs', deleted_at: null }] })
    await expect(requireOrgPermission('u1', 'reports.costs')).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ───────────────────────────── requireOwner ─────────────────────────────
describe('requireOwner', () => {
  beforeEach(() => {
    cookies = { access: 'tok' }
    anon.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c' } }, error: null })
    anon.refreshSession.mockReset()
  })
  it('owner passa e devolve o usuário', async () => {
    fake = createFakeSupabase({ user_profiles: [{ user_id: 'u1', is_owner: true }] })
    await expect(requireOwner(event)).resolves.toMatchObject({ id: 'u1' })
  })
  it('não-owner → 403', async () => {
    fake = createFakeSupabase({ user_profiles: [{ user_id: 'u1', is_owner: false }] })
    await expect(requireOwner(event)).rejects.toMatchObject({ statusCode: 403 })
  })
  it('sem perfil → 403', async () => {
    fake = createFakeSupabase({ user_profiles: [] })
    await expect(requireOwner(event)).rejects.toMatchObject({ statusCode: 403 })
  })
  it('erro de banco → 500', async () => {
    fake = createFakeSupabase({ user_profiles: [{ user_id: 'u1', is_owner: true }] })
    fake.failNext('user_profiles')
    await expect(requireOwner(event)).rejects.toMatchObject({ statusCode: 500 })
  })
  it('deslogado → 401', async () => {
    cookies = {}
    fake = createFakeSupabase()
    await expect(requireOwner(event)).rejects.toMatchObject({ statusCode: 401 })
  })
})

// ───────────────────────────── requireAuthUser ─────────────────────────────
describe('requireAuthUser', () => {
  const okUser = { data: { user: { id: 'u1', email: 'a@b.c' } }, error: null }
  const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.y`

  beforeEach(() => {
    cookies = {}
    anon.getUser.mockReset()
    anon.refreshSession.mockReset()
    setAuthCookies.mockReset()
    setAuthUserCookie.mockReset()
  })

  it('token válido', async () => {
    cookies = { access: jwt(4102444800) }
    anon.getUser.mockResolvedValue(okUser)
    await expect(requireAuthUser(event)).resolves.toMatchObject({ id: 'u1' })
    expect(anon.refreshSession).not.toHaveBeenCalled()
    expect(setAuthUserCookie).toHaveBeenCalledOnce()
  })
  it('token inválido + refresh válido → renova cookies', async () => {
    cookies = { access: 'ruim', refresh: 'ref' }
    anon.getUser
      .mockResolvedValueOnce({ data: { user: null }, error: { status: 401 } })
      .mockResolvedValueOnce(okUser)
    anon.refreshSession.mockResolvedValue({ data: { session: { access_token: jwt(4102444800), refresh_token: 'r2', expires_at: 4102444800 } }, error: null })
    await expect(requireAuthUser(event)).resolves.toMatchObject({ id: 'u1' })
    expect(setAuthCookies).toHaveBeenCalledOnce()
  })
  it('sem nada → 401', async () => {
    await expect(requireAuthUser(event)).rejects.toMatchObject({ statusCode: 401 })
  })
  it('token inválido sem refresh → 401', async () => {
    cookies = { access: 'ruim' }
    anon.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } })
    await expect(requireAuthUser(event)).rejects.toMatchObject({ statusCode: 401 })
  })
  it('token e refresh inválidos → 401', async () => {
    cookies = { access: 'ruim', refresh: 'ruim' }
    anon.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } })
    anon.refreshSession.mockResolvedValue({ data: { session: null }, error: { status: 400 } })
    await expect(requireAuthUser(event)).rejects.toMatchObject({ statusCode: 401 })
  })
  it('Supabase Auth fora do ar (5xx no getUser) → 503, não 401', async () => {
    cookies = { access: 'tok' }
    anon.getUser.mockResolvedValue({ data: { user: null }, error: { status: 500 } })
    await expect(requireAuthUser(event)).rejects.toMatchObject({ statusCode: 503 })
  })
  it('Supabase Auth fora do ar no refresh → 503', async () => {
    cookies = { refresh: 'ref' }
    anon.refreshSession.mockResolvedValue({ data: { session: null }, error: { status: 502 } })
    await expect(requireAuthUser(event)).rejects.toMatchObject({ statusCode: 503 })
  })
  it('refresh ok mas getUser seguinte cai (5xx) → 503', async () => {
    cookies = { refresh: 'ref' }
    anon.refreshSession.mockResolvedValue({ data: { session: { access_token: 'n', refresh_token: 'r', expires_at: 1 } }, error: null })
    anon.getUser.mockResolvedValue({ data: { user: null }, error: { status: 500 } })
    await expect(requireAuthUser(event)).rejects.toMatchObject({ statusCode: 503 })
  })
})

// ───────────────────────────── license ─────────────────────────────
describe('license', () => {
  const withPlan = (plan: string | null, employees = 0) => {
    fake = createFakeSupabase({
      subscriptions: plan ? [{ organization_id: 'org-a', plan_key: plan, status: 'active', deleted_at: null }] : [],
      employees: Array.from({ length: employees }, (_, n) => ({ id: `e${n}`, organization_id: 'org-a', deleted_at: null, termination_date: null }))
    })
  }

  it('resolveOrgLicense: limites por plano', async () => {
    withPlan('starter')
    expect(await resolveOrgLicense('org-a')).toEqual({ planKey: 'starter', maxEmployees: 2 })
    withPlan('pro')
    expect((await resolveOrgLicense('org-a')).maxEmployees).toBe(10)
    withPlan('fiscal')
    expect((await resolveOrgLicense('org-a')).maxEmployees).toBeNull()
  })
  it('resolveOrgLicense: assinatura de outra organização não conta', async () => {
    withPlan('pro')
    expect(await resolveOrgLicense('org-b')).toEqual({ planKey: null, maxEmployees: null })
  })
  it('starter bloqueia o 3º funcionário', async () => {
    withPlan('starter', 2)
    await expect(enforceEmployeeLimit('org-a')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('starter permite o 2º', async () => {
    withPlan('starter', 1)
    await expect(enforceEmployeeLimit('org-a')).resolves.toBeUndefined()
  })
  it('pro bloqueia o 11º', async () => {
    withPlan('pro', 10)
    await expect(enforceEmployeeLimit('org-a')).rejects.toMatchObject({ statusCode: 403 })
    withPlan('pro', 9)
    await expect(enforceEmployeeLimit('org-a')).resolves.toBeUndefined()
  })
  it('fiscal não tem limite', async () => {
    withPlan('fiscal', 500)
    await expect(enforceEmployeeLimit('org-a')).resolves.toBeUndefined()
  })
  // KF-03: sem assinatura ativa, maxEmployees=null e o limite NÃO é aplicado.
  it.fails('sem assinatura ativa não deveria liberar funcionários ilimitados', async () => {
    withPlan(null, 50)
    await expect(enforceEmployeeLimit('org-a')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('erro ao contar → 500', async () => {
    withPlan('starter', 0)
    // 1ª consulta (subscriptions) ok; falha na contagem de employees
    fake.failNext('employees')
    await expect(enforceEmployeeLimit('org-a')).rejects.toMatchObject({ statusCode: 500 })
  })
  it('enforceReportAccess: starter e sem plano bloqueados nos relatórios restritos', async () => {
    withPlan('starter')
    await expect(enforceReportAccess('org-a', 'debtors')).rejects.toMatchObject({ statusCode: 403 })
    withPlan(null)
    await expect(enforceReportAccess('org-a', 'sales-items')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('enforceReportAccess: pro/fiscal liberados; relatório livre passa no starter', async () => {
    withPlan('pro')
    await expect(enforceReportAccess('org-a', 'customers')).resolves.toBeUndefined()
    withPlan('starter')
    await expect(enforceReportAccess('org-a', 'overview')).resolves.toBeUndefined()
  })
})
