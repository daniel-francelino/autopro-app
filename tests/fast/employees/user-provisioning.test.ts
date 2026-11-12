// ensureUserProvisioned: atribuir uma role não sobrescreve o acesso existente (Fase 3 do plano de acesso).
// Perfil existente com outra role, admin de sistema ou owner -> 409 e nada é escrito; perfil novo (ou com a mesma role) é provisionado.
import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '../../support/fake-supabase'
import { ensureUserProvisioned } from '../../../server/utils/user-provisioning'

globalThis.createError = ((o: { statusCode: number, statusMessage: string }) => Object.assign(new Error(o.statusMessage), o)) as never

const ROLES = [
  { id: 'r-employee', name: 'employee', is_system_role: true },
  { id: 'r-admin', name: 'admin', is_system_role: true },
  { id: 'r-custom', name: 'gerente-loja', is_system_role: false }
]

const input = (userId: string) => ({
  userId, email: 'x@a.com', displayName: 'X', organizationId: 'org-a', roleId: 'r-employee', employeeId: 'e1', isActive: true
})

function setup(profiles: Array<Record<string, unknown>>) {
  const fake = createFakeSupabase({ roles: ROLES, user_profiles: profiles })
  return { fake, client: fake.client }
}

describe('ensureUserProvisioned com roleId', () => {
  it('perfil novo -> provisionado (perfil, preferências e notificações)', async () => {
    const { fake, client } = setup([])
    await ensureUserProvisioned(client, input('u-new'))
    expect(fake.writes.filter(w => w.op === 'upsert').map(w => w.table).sort()).toEqual(['notification_preferences', 'user_preferences', 'user_profiles'])
    expect(fake.tables.user_profiles![0]).toMatchObject({ user_id: 'u-new', role_id: 'r-employee', organization_id: 'org-a' })
  })

  it('perfil existente sem role -> provisionado', async () => {
    const { fake, client } = setup([{ id: 'p1', user_id: 'u1', role_id: null, is_owner: false }])
    await ensureUserProvisioned(client, input('u1'))
    expect(fake.writes.some(w => w.table === 'user_profiles' && w.op === 'upsert')).toBe(true)
  })

  it('perfil existente com a mesma role -> provisionado', async () => {
    const { fake, client } = setup([{ id: 'p1', user_id: 'u1', role_id: 'r-employee', is_owner: false }])
    await ensureUserProvisioned(client, input('u1'))
    expect(fake.writes.some(w => w.table === 'user_profiles' && w.op === 'upsert')).toBe(true)
  })

  it.each([
    ['outra role', { role_id: 'r-custom', is_owner: false }],
    ['admin de sistema', { role_id: 'r-admin', is_owner: false }],
    ['owner (sem role)', { role_id: null, is_owner: true }]
  ])('perfil existente com %s -> 409, nada escrito e role preservada', async (_label, profile) => {
    const { fake, client } = setup([{ id: 'p1', user_id: 'u1', organization_id: 'org-a', ...profile }])
    const before = structuredClone(fake.tables.user_profiles)
    await expect(ensureUserProvisioned(client, input('u1'))).rejects.toMatchObject({ statusCode: 409 })
    expect(fake.writes).toHaveLength(0)
    expect(fake.tables.user_profiles).toEqual(before)
  })

  it('sem roleId (cadastro) mantém o comportamento anterior, sem consultar o perfil', async () => {
    const { fake, client } = setup([{ id: 'p1', user_id: 'u1', role_id: 'r-custom', is_owner: false }])
    await ensureUserProvisioned(client, { userId: 'u1', email: 'x@a.com', displayName: 'X' })
    expect(fake.writes.some(w => w.table === 'user_profiles' && w.op === 'upsert')).toBe(true)
  })

  it('erro no SELECT do perfil -> 503 e nada escrito', async () => {
    const { fake, client } = setup([{ id: 'p1', user_id: 'u1', role_id: 'r-custom', is_owner: false }])
    fake.failNext('user_profiles', 'boom')
    await expect(ensureUserProvisioned(client, input('u1'))).rejects.toMatchObject({ statusCode: 503 })
    expect(fake.writes).toHaveLength(0)
    expect(fake.tables.user_profiles![0]).toMatchObject({ role_id: 'r-custom' })
  })

  it('erro no SELECT da role existente -> 503 e nada escrito', async () => {
    const { fake, client } = setup([{ id: 'p1', user_id: 'u1', role_id: 'r-custom', is_owner: false }])
    fake.failNext('roles', 'boom')
    await expect(ensureUserProvisioned(client, input('u1'))).rejects.toMatchObject({ statusCode: 503 })
    expect(fake.writes).toHaveLength(0)
  })
})
