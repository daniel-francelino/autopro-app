import { describe, expect, it } from 'vitest'
import { getAccessTokenExpiresAt, isInvalidAuthError, resolveSessionExpiresAt } from '../../../server/utils/auth-session'
import { isEmployeeAccessRevoked, syncEmployeeLinkedUserAccess } from '../../../server/utils/employee-access'
import { filterActionsByPlan, PLAN_GATED_RESOURCES } from '../../../server/utils/license'
import { createFakeSupabase } from '../../helpers/fake-supabase'

const jwt = (payload: unknown) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`

describe('auth-session', () => {
  it('getAccessTokenExpiresAt: JWT válido, malformado e vazio', () => {
    expect(getAccessTokenExpiresAt(jwt({ exp: 1234 }))).toBe(1234)
    expect(getAccessTokenExpiresAt(jwt({ exp: 'x' }))).toBeNull()
    expect(getAccessTokenExpiresAt('semponto')).toBeNull()
    expect(getAccessTokenExpiresAt('a.%%%.c')).toBeNull()
    expect(getAccessTokenExpiresAt(null)).toBeNull()
  })
  it('resolveSessionExpiresAt: prioridade sessão > existente > token', () => {
    const accessToken = jwt({ exp: 3 })
    expect(resolveSessionExpiresAt({ sessionExpiresAt: 1, existingExpiresAt: 2, accessToken })).toBe(1)
    expect(resolveSessionExpiresAt({ existingExpiresAt: 2, accessToken })).toBe(2)
    expect(resolveSessionExpiresAt({ accessToken })).toBe(3)
    expect(resolveSessionExpiresAt({})).toBeNull()
  })
  it('isInvalidAuthError: 400/401/403 são inválidos; 5xx e rede não', () => {
    for (const status of [400, 401, 403]) expect(isInvalidAuthError({ status })).toBe(true)
    for (const status of [500, 502, 503, 429]) expect(isInvalidAuthError({ status })).toBe(false)
    expect(isInvalidAuthError({ status: undefined })).toBe(false)
    expect(isInvalidAuthError({ status: '401' })).toBe(false)
    expect(isInvalidAuthError(null)).toBe(false)
  })
})

describe('employee-access', () => {
  it('isEmployeeAccessRevoked', () => {
    expect(isEmployeeAccessRevoked(null, null)).toBe(false)
    expect(isEmployeeAccessRevoked('2000-01-01', null)).toBe(true)
    expect(isEmployeeAccessRevoked('2999-01-01', null)).toBe(false)
    expect(isEmployeeAccessRevoked(null, '2026-01-01T00:00:00Z')).toBe(true)
    expect(isEmployeeAccessRevoked('data inválida', null)).toBe(false)
  })

  const seed = () => createFakeSupabase({
    user_profiles: [{ id: 'p1', employee_id: 'e1', organization_id: 'org-a', role_id: 'old', is_active: true, display_name: 'Antigo' }],
    roles: [{ id: 'role-emp', organization_id: 'org-a', name: 'employee', is_system_role: true }]
  })

  it('sem usuário vinculado: nada acontece', async () => {
    const fake = createFakeSupabase({ user_profiles: [] })
    expect(await syncEmployeeLinkedUserAccess(fake.client, { employeeId: 'e1', organizationId: 'org-a' })).toEqual({ revoked: false, linked: false })
    expect(fake.writes).toHaveLength(0)
  })
  it('desligado: desativa e remove organização e papel', async () => {
    const fake = seed()
    const r = await syncEmployeeLinkedUserAccess(fake.client, { employeeId: 'e1', organizationId: 'org-a', terminationDate: '2000-01-01' })
    expect(r).toEqual({ revoked: true, linked: true })
    expect(fake.tables.user_profiles![0]).toMatchObject({ is_active: false, organization_id: null, role_id: null })
  })
  it('ativo: reativa com o papel "employee" de sistema e atualiza o nome', async () => {
    const fake = seed()
    await syncEmployeeLinkedUserAccess(fake.client, { employeeId: 'e1', organizationId: 'org-a', employeeName: ' Maria ' })
    expect(fake.tables.user_profiles![0]).toMatchObject({ is_active: true, organization_id: 'org-a', role_id: 'role-emp', display_name: 'Maria' })
  })
  it('ativo sem papel "employee" → 422', async () => {
    const fake = seed()
    fake.tables.roles!.length = 0
    await expect(syncEmployeeLinkedUserAccess(fake.client, { employeeId: 'e1', organizationId: 'org-a' })).rejects.toMatchObject({ statusCode: 422 })
  })
  it('erro ao localizar perfil → 500', async () => {
    const fake = seed()
    fake.failNext('user_profiles')
    await expect(syncEmployeeLinkedUserAccess(fake.client, { employeeId: 'e1', organizationId: 'org-a' })).rejects.toMatchObject({ statusCode: 500 })
  })
})

describe('license: filterActionsByPlan', () => {
  const actions = [{ resource: 'clients' }, { resource: 'service_invoice' }, { resource: 'fiscal' }, { resource: null }, {}]
  it('recursos fiscais somem fora do plano fiscal', () => {
    for (const plan of ['starter', 'pro', null]) {
      expect(filterActionsByPlan(actions, plan)).toEqual([{ resource: 'clients' }, { resource: null }, {}])
    }
  })
  it('plano fiscal vê tudo', () => {
    expect(filterActionsByPlan(actions, 'fiscal')).toHaveLength(5)
  })
  it('todos os recursos gated exigem o plano fiscal', () => {
    expect(new Set(Object.values(PLAN_GATED_RESOURCES))).toEqual(new Set(['fiscal']))
  })
})
