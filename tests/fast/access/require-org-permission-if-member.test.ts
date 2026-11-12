// requireOrgPermissionIfMember: só aplica requireOrgPermission quando o usuário já tem organização.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { guardSeed } from '../../support/phase3-guard-fixture'

let fake: FakeSupabase
vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))

const { requireOrgPermissionIfMember } = await import('../../../server/utils/require-org-permission-if-member')

const CODE = 'subscription.manage'

beforeEach(() => {
  const s = guardSeed([CODE])
  s.user_profiles!.push(
    { id: 'p-noorg', user_id: 'u-noorg', organization_id: null, role_id: null, is_owner: false, is_active: true },
    { id: 'p-norole', user_id: 'u-norole', organization_id: 'org-a', role_id: null, is_owner: false, is_active: true },
    { id: 'p-susp', user_id: 'u-susp', organization_id: 'org-s', role_id: 'r-com', is_owner: false, is_active: true }
  )
  fake = createFakeSupabase(s)
})

describe('requireOrgPermissionIfMember', () => {
  it('perfil sem organização -> passa (primeira assinatura)', async () => {
    await expect(requireOrgPermissionIfMember('u-noorg', CODE)).resolves.toBeUndefined()
  })

  it('usuário sem perfil -> passa (também não tem organização)', async () => {
    await expect(requireOrgPermissionIfMember('u-ghost', CODE)).resolves.toBeUndefined()
  })

  it('membro sem o código -> 403', async () => {
    await expect(requireOrgPermissionIfMember('u-sem', CODE)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('membro com o código -> passa', async () => {
    await expect(requireOrgPermissionIfMember('u-com', CODE)).resolves.toBeUndefined()
  })

  it('admin e owner passam sem concessão', async () => {
    await expect(requireOrgPermissionIfMember('u-admin', CODE)).resolves.toBeUndefined()
    await expect(requireOrgPermissionIfMember('u-owner', CODE)).resolves.toBeUndefined()
  })

  it('membro inativo -> 403 (o guarda normal continua valendo para quem tem organização)', async () => {
    fake.tables.user_profiles!.find(p => p.user_id === 'u-com')!.is_active = false
    await expect(requireOrgPermissionIfMember('u-com', CODE)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('membro com organização e role_id nulo (não owner, não admin) -> 403', async () => {
    await expect(requireOrgPermissionIfMember('u-norole', CODE)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('erro no SELECT do perfil -> 503 (não libera o acesso)', async () => {
    fake.failNext('user_profiles', 'boom')
    await expect(requireOrgPermissionIfMember('u-noorg', CODE)).rejects.toMatchObject({ statusCode: 503 })
  })
})
