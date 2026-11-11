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

  it('no profile → 400', async () => {
    fake = createFakeSupabase({ user_profiles: [] })
    await expect(resolveOrganizationId(event, 'u1')).rejects.toMatchObject({ statusCode: 400 })
  })
  it('profile without organization → 400', async () => {
    fake = createFakeSupabase({ user_profiles: [profile({ organization_id: null })] })
    await expect(resolveOrganizationId(event, 'u1')).rejects.toMatchObject({ statusCode: 400 })
  })
  it('is_active=false → 403', async () => {
    fake = createFakeSupabase({ user_profiles: [profile({ is_active: false })] })
    await expect(resolveOrganizationId(event, 'u1')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('ok → returns the organization', async () => {
    fake = createFakeSupabase({ user_profiles: [profile()] })
    expect(await resolveOrganizationId(event, 'u1')).toBe('org-a')
  })
  it('database error → 500', async () => {
    fake = createFakeSupabase({ user_profiles: [profile()] })
    fake.failNext('user_profiles')
    await expect(resolveOrganizationId(event, 'u1')).rejects.toMatchObject({ statusCode: 500 })
  })
  it('active employee (not terminated) passes', async () => {
    fake = createFakeSupabase({
      user_profiles: [profile({ employee_id: 'e1' })],
      employees: [{ id: 'e1', name: 'Zé', termination_date: null, deleted_at: null }]
    })
    expect(await resolveOrganizationId(event, 'u1')).toBe('org-a')
  })
  it('terminated employee → 403 and revokes profile access', async () => {
    fake = createFakeSupabase({
      user_profiles: [profile({ employee_id: 'e1', role_id: 'r1' })],
      employees: [{ id: 'e1', name: 'Zé', termination_date: '2020-01-01', deleted_at: null }]
    })
    await expect(resolveOrganizationId(event, 'u1')).rejects.toMatchObject({ statusCode: 403 })
    expect(fake.tables.user_profiles![0]).toMatchObject({ is_active: false, organization_id: null, role_id: null })
  })
  it('employee with future termination still has access', async () => {
    fake = createFakeSupabase({
      user_profiles: [profile({ employee_id: 'e1' })],
      employees: [{ id: 'e1', name: 'Zé', termination_date: '2999-01-01', deleted_at: null }]
    })
    expect(await resolveOrganizationId(event, 'u1')).toBe('org-a')
  })
  it('deleted employee (deleted_at) → 403', async () => {
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

  it('no profile → 403', async () => {
    fake = base({ user_profiles: [] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('inactive profile → 403', async () => {
    fake = base({ user_profiles: [{ user_id: 'u1', organization_id: 'org-a', role_id: 'r1', is_active: false }] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('no organization → 403', async () => {
    fake = base({ user_profiles: [{ user_id: 'u1', organization_id: null, role_id: 'r1', is_active: true }] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('role with the granted action passes', async () => {
    fake = base()
    await expect(requireOrgPermission('u1', 'clients.create')).resolves.toBeUndefined()
  })
  it('is_owner passes without role', async () => {
    fake = base({ user_profiles: [{ user_id: 'u1', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true }] })
    await expect(requireOrgPermission('u1', 'clients.create')).resolves.toBeUndefined()
  })
  it('system admin role passes', async () => {
    fake = base({ roles: [{ id: 'r1', name: 'admin', is_system_role: true }], role_actions: [] })
    await expect(requireOrgPermission('u1', 'clients.create')).resolves.toBeUndefined()
  })
  it('role named "admin" but NOT system does not pass', async () => {
    fake = base({ roles: [{ id: 'r1', name: 'admin', is_system_role: false }], role_actions: [] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('no assigned role → 403', async () => {
    fake = base({ user_profiles: [{ user_id: 'u1', organization_id: 'org-a', role_id: null, is_owner: false, is_active: true }] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('nonexistent action → 403', async () => {
    fake = base()
    await expect(requireOrgPermission('u1', 'nao.existe')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('is_granted=false → 403', async () => {
    fake = base({ role_actions: [{ role_id: 'r1', action_id: 'a1', is_granted: false }] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('no row in role_actions → 403', async () => {
    fake = base({ role_actions: [] })
    await expect(requireOrgPermission('u1', 'clients.create')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('fiscal action on starter plan → 403 with plan name', async () => {
    fake = base({ actions: [{ id: 'a1', code: 'service_invoice.create', deleted_at: null }] })
    await expect(requireOrgPermission('u1', 'service_invoice.create')).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: expect.stringContaining('Fiscal')
    })
  })
  it('plan is checked BEFORE the owner bypass', async () => {
    fake = base({ user_profiles: [{ user_id: 'u1', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true }] })
    await expect(requireOrgPermission('u1', 'fiscal.manage')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('fiscal action on fiscal plan passes', async () => {
    fake = base({
      subscriptions: [{ organization_id: 'org-a', plan_key: 'fiscal', status: 'active', deleted_at: null }],
      actions: [{ id: 'a1', code: 'service_invoice.create', deleted_at: null }]
    })
    await expect(requireOrgPermission('u1', 'service_invoice.create')).resolves.toBeUndefined()
  })
  it('pro report on starter plan → 403; on pro passes', async () => {
    fake = base({ actions: [{ id: 'a1', code: 'reports.debtors', deleted_at: null }] })
    await expect(requireOrgPermission('u1', 'reports.debtors')).rejects.toMatchObject({ statusCode: 403 })
    fake.tables.subscriptions![0]!.plan_key = 'pro'
    await expect(requireOrgPermission('u1', 'reports.debtors')).resolves.toBeUndefined()
  })
  it('no active subscription and action requiring a plan → 403', async () => {
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
  it('owner passes and returns the user', async () => {
    fake = createFakeSupabase({ user_profiles: [{ user_id: 'u1', is_owner: true }] })
    await expect(requireOwner(event)).resolves.toMatchObject({ id: 'u1' })
  })
  it('non-owner → 403', async () => {
    fake = createFakeSupabase({ user_profiles: [{ user_id: 'u1', is_owner: false }] })
    await expect(requireOwner(event)).rejects.toMatchObject({ statusCode: 403 })
  })
  it('no profile → 403', async () => {
    fake = createFakeSupabase({ user_profiles: [] })
    await expect(requireOwner(event)).rejects.toMatchObject({ statusCode: 403 })
  })
  it('database error → 500', async () => {
    fake = createFakeSupabase({ user_profiles: [{ user_id: 'u1', is_owner: true }] })
    fake.failNext('user_profiles')
    await expect(requireOwner(event)).rejects.toMatchObject({ statusCode: 500 })
  })
  it('logged out → 401', async () => {
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

  it('valid token', async () => {
    cookies = { access: jwt(4102444800) }
    anon.getUser.mockResolvedValue(okUser)
    await expect(requireAuthUser(event)).resolves.toMatchObject({ id: 'u1' })
    expect(anon.refreshSession).not.toHaveBeenCalled()
    expect(setAuthUserCookie).toHaveBeenCalledOnce()
  })
  it('invalid token + valid refresh → renews cookies', async () => {
    cookies = { access: 'ruim', refresh: 'ref' }
    anon.getUser
      .mockResolvedValueOnce({ data: { user: null }, error: { status: 401 } })
      .mockResolvedValueOnce(okUser)
    anon.refreshSession.mockResolvedValue({ data: { session: { access_token: jwt(4102444800), refresh_token: 'r2', expires_at: 4102444800 } }, error: null })
    await expect(requireAuthUser(event)).resolves.toMatchObject({ id: 'u1' })
    expect(setAuthCookies).toHaveBeenCalledOnce()
  })
  it('nothing → 401', async () => {
    await expect(requireAuthUser(event)).rejects.toMatchObject({ statusCode: 401 })
  })
  it('invalid token without refresh → 401', async () => {
    cookies = { access: 'ruim' }
    anon.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } })
    await expect(requireAuthUser(event)).rejects.toMatchObject({ statusCode: 401 })
  })
  it('invalid token and refresh → 401', async () => {
    cookies = { access: 'ruim', refresh: 'ruim' }
    anon.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } })
    anon.refreshSession.mockResolvedValue({ data: { session: null }, error: { status: 400 } })
    await expect(requireAuthUser(event)).rejects.toMatchObject({ statusCode: 401 })
  })
  it('Supabase Auth down (5xx on getUser) → 503, not 401', async () => {
    cookies = { access: 'tok' }
    anon.getUser.mockResolvedValue({ data: { user: null }, error: { status: 500 } })
    await expect(requireAuthUser(event)).rejects.toMatchObject({ statusCode: 503 })
  })
  it('Supabase Auth down on refresh → 503', async () => {
    cookies = { refresh: 'ref' }
    anon.refreshSession.mockResolvedValue({ data: { session: null }, error: { status: 502 } })
    await expect(requireAuthUser(event)).rejects.toMatchObject({ statusCode: 503 })
  })
  it('refresh ok but the following getUser fails (5xx) → 503', async () => {
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

  it('resolveOrgLicense: limits per plan', async () => {
    withPlan('starter')
    expect(await resolveOrgLicense('org-a')).toEqual({ planKey: 'starter', maxEmployees: 2 })
    withPlan('pro')
    expect((await resolveOrgLicense('org-a')).maxEmployees).toBe(10)
    withPlan('fiscal')
    expect((await resolveOrgLicense('org-a')).maxEmployees).toBeNull()
  })
  it('resolveOrgLicense: subscription from another organization does not count', async () => {
    withPlan('pro')
    expect(await resolveOrgLicense('org-b')).toEqual({ planKey: null, maxEmployees: null })
  })
  it('starter blocks the 3rd employee', async () => {
    withPlan('starter', 2)
    await expect(enforceEmployeeLimit('org-a')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('starter allows the 2nd', async () => {
    withPlan('starter', 1)
    await expect(enforceEmployeeLimit('org-a')).resolves.toBeUndefined()
  })
  it('pro blocks the 11th', async () => {
    withPlan('pro', 10)
    await expect(enforceEmployeeLimit('org-a')).rejects.toMatchObject({ statusCode: 403 })
    withPlan('pro', 9)
    await expect(enforceEmployeeLimit('org-a')).resolves.toBeUndefined()
  })
  it('fiscal has no limit', async () => {
    withPlan('fiscal', 500)
    await expect(enforceEmployeeLimit('org-a')).resolves.toBeUndefined()
  })
  // KF-03: sem assinatura ativa, maxEmployees=null e o limite NÃO é aplicado.
  it('no active subscription should not grant unlimited employees', async () => {
    withPlan(null, 50)
    await expect(enforceEmployeeLimit('org-a')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('error when counting → 500', async () => {
    withPlan('starter', 0)
    // 1ª consulta (subscriptions) ok; falha na contagem de employees
    fake.failNext('employees')
    await expect(enforceEmployeeLimit('org-a')).rejects.toMatchObject({ statusCode: 500 })
  })
  it('enforceReportAccess: starter and no plan blocked from restricted reports', async () => {
    withPlan('starter')
    await expect(enforceReportAccess('org-a', 'debtors')).rejects.toMatchObject({ statusCode: 403 })
    withPlan(null)
    await expect(enforceReportAccess('org-a', 'sales-items')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('enforceReportAccess: pro/fiscal allowed; free report passes on starter', async () => {
    withPlan('pro')
    await expect(enforceReportAccess('org-a', 'customers')).resolves.toBeUndefined()
    withPlan('starter')
    await expect(enforceReportAccess('org-a', 'overview')).resolves.toBeUndefined()
  })
})
