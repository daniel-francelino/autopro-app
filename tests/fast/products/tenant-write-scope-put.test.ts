// Escrita escopada por organização: o UPDATE/DELETE deve carregar .eq('organization_id', ...) além do id
// (defesa em profundidade; docs/engineering/access-control-rollout-plan.md, seção 6).
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
const HANDLER = 'server/api/products/[id].put.ts'

beforeEach(() => {
  fake = createFakeSupabase({
    user_profiles: [
      { id: 'p-owner', user_id: 'u-owner', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true, employee_id: null }
    ],
    products: [
      { id: 'a1', organization_id: 'org-a', name: 'P', deleted_at: null },
      { id: 'b1', organization_id: 'org-b', name: 'P', deleted_at: null }
    ]
  })
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u-owner', email: 'owner@a.com' } }, error: null })
  auth.refreshSession.mockReset()
})

const call = (id: string) => callHandler(HANDLER, fakeEvent({ method: 'PUT', cookies, params: { id }, body: { name: 'Novo' } }))
const writes = () => fake.writes.filter(w => w.table === 'products')

describe('products [id].put: tenant scope on write', () => {
  it('id from another organization -> 404 and no write', async () => {
    const res = await call('b1')
    expect(res.status).toBe(404)
    expect(writes()).toHaveLength(0)
    expect(fake.tables.products!.find(r => r.id === 'b1')).toMatchObject({ deleted_at: null, name: 'P' })
  })

  it('own organization -> 200 and the write is filtered by id and organization_id', async () => {
    const res = await call('a1')
    expect(res.status).toBe(200)
    expect(writes()).toHaveLength(1)
    expect(writes()[0]!.filters).toEqual(['id=a1', 'organization_id=org-a'])
  })
})
