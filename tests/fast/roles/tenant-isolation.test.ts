// Isolamento por tenant das leituras de papeis (RE-01 / D-1: papel de sistema = global, organization_id nulo).
// Handlers reais + Supabase falso; o `or()` do fake interpreta o filtro de verdade.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { roleScopeFilter } from '../../../server/utils/role-scope'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }

const role = (id: string, organization_id: string | null, is_system_role: boolean) =>
  ({ id, organization_id, name: id, display_name: id, description: null, is_system_role, deleted_at: null })

beforeEach(() => {
  auth.getUser.mockReset()
  auth.getUser.mockResolvedValue({ data: { user: { id: 'u-a', email: 'dono@a.com' } }, error: null })
  fake = createFakeSupabase({
    // dono da org A (bypass de permissao); o foco aqui e o escopo dos papeis
    user_profiles: [
      { id: 'p-a', user_id: 'u-a', email: 'dono@a.com', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true, employee_id: null }
    ],
    roles: [
      role('global-admin', null, true),
      role('sys-org-a', 'org-a', true),
      role('sys-org-b', 'org-b', true),
      role('custom-a', 'org-a', false),
      role('custom-b', 'org-b', false)
    ],
    actions: [{ id: 'act-1', code: 'customers.create', name: 'Criar', description: null, resource: 'customers', deleted_at: null }],
    role_actions: [
      { id: 'ra-1', role_id: 'sys-org-b', action_id: 'act-1', is_granted: true },
      { id: 'ra-2', role_id: 'global-admin', action_id: 'act-1', is_granted: true }
    ],
    subscriptions: []
  })
})

const get = (file: string, params: Record<string, string> = {}) =>
  callHandler(file, fakeEvent({ cookies, params }))

describe('roleScopeFilter', () => {
  it('usa organizacao propria OU organization_id nulo, nunca is_system_role', () => {
    expect(roleScopeFilter('org-a')).toBe('organization_id.eq.org-a,organization_id.is.null')
    expect(roleScopeFilter('org-a')).not.toContain('is_system_role')
  })
})

describe('GET /api/roles', () => {
  const file = 'server/api/roles/index.get.ts'

  it('lista globais e da propria org; nao lista papel de sistema de outra org', async () => {
    const r = await get(file)
    expect(r.status).toBe(200)
    const ids = ((r.body as { items: Array<{ id: string }> }).items).map(i => i.id).sort()
    expect(ids).toEqual(['custom-a', 'global-admin', 'sys-org-a'])
    expect(ids).not.toContain('sys-org-b')
    expect(ids).not.toContain('custom-b')
  })
})

describe('GET /api/roles/:id', () => {
  const file = 'server/api/roles/[id].get.ts'

  it.each(['global-admin', 'sys-org-a', 'custom-a'])('le %s', async (id) => {
    const r = await get(file, { id })
    expect(r.status).toBe(200)
  })
  it.each(['sys-org-b', 'custom-b'])('404 para %s (outra org)', async (id) => {
    const r = await get(file, { id })
    expect(r.status).toBe(404)
  })
})

describe('GET /api/roles/:id/actions', () => {
  const file = 'server/api/roles/[id]/actions.get.ts'

  it.each(['global-admin', 'sys-org-a', 'custom-a'])('le %s', async (id) => {
    const r = await get(file, { id })
    expect(r.status).toBe(200)
  })
  it.each(['sys-org-b', 'custom-b'])('404 para %s (outra org) e nao expoe role_actions', async (id) => {
    const r = await get(file, { id })
    expect(r.status).toBe(404)
    expect(r.body).toBeUndefined()
  })
})
