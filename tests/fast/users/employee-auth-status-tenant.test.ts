// employee-auth-status: a leitura de user_profiles por employee_id deve ser escopada pela organização da sessão
// (docs/engineering/access-control-rollout-plan.md, seção 6).
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
const HANDLER = 'server/api/users/employee-auth-status.post.ts'
const call = (employee_id: string) => callHandler(HANDLER, fakeEvent({ method: 'POST', cookies, body: { employee_id } }))

beforeEach(() => {
  fake = createFakeSupabase({
    user_profiles: [
      { id: 'p-owner', user_id: 'u-owner', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true, employee_id: null },
      { id: 'p-e1', user_id: 'u-e1', organization_id: 'org-a', role_id: 'r1', is_active: true, employee_id: 'e1', email: 'e1@a.com' },
      // perfil de OUTRA org apontando para o mesmo employee_id (dado inconsistente): não pode vazar
      { id: 'p-e3', user_id: 'u-e3', organization_id: 'org-a', role_id: 'r3', is_active: true, employee_id: null, email: 'e3@a.com' },
      { id: 'p-x', user_id: 'u-x', organization_id: 'org-b', role_id: 'r9', is_active: true, employee_id: 'e2', email: 'x@b.com' }
    ],
    employees: [
      { id: 'e1', organization_id: 'org-a', email: 'e1@a.com', deleted_at: null },
      { id: 'e3', organization_id: 'org-a', email: 'e3@a.com', deleted_at: null },
      { id: 'e2', organization_id: 'org-a', email: '', deleted_at: null }
    ]
  })
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u-owner', email: 'owner@a.com' } }, error: null })
  auth.refreshSession.mockReset()
})

describe('employee-auth-status: tenant scope', () => {
  it('own organization profile -> hasAuthUser true', async () => {
    const res = await call('e1')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ hasAuthUser: true, user_id: 'u-e1' })
  })

  it('profile with the same employee_id in another organization is not returned', async () => {
    const res = await call('e2')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ hasAuthUser: false, user_id: null })
  })

  it('auto-heal by email writes user_profiles filtered by id and organization_id', async () => {
    const res = await call('e3')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ hasAuthUser: true, user_id: 'u-e3' })
    const writes = fake.writes.filter(w => w.table === 'user_profiles')
    expect(writes).toHaveLength(1)
    expect(writes[0]!.filters).toEqual(['id=p-e3', 'organization_id=org-a'])
    expect(fake.tables.user_profiles!.find(p => p.id === 'p-e3')!.employee_id).toBe('e3')
  })
})
