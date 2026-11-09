// Fase 0a do plano do painel do owner (docs/admin/owner-panel-plan.md §2): isolamento entre oficinas.
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
const login = (id: string, email: string) => auth.getUser.mockResolvedValue({ data: { user: { id, email } }, error: null })

beforeEach(() => {
  fake = createFakeSupabase({
    user_profiles: [
      { id: 'p-admin-a', user_id: 'u-admin-a', email: 'admin@a.com', organization_id: 'org-a', role_id: 'role-admin-a', is_owner: false, is_active: true, employee_id: null },
      { id: 'p-emp-a', user_id: 'u-emp-a', email: 'func@a.com', organization_id: 'org-a', role_id: 'role-emp-a', is_owner: false, is_active: true, employee_id: null },
      { id: 'p-owner', user_id: 'u-owner', email: 'owner@x.com', organization_id: null, role_id: null, is_owner: true, is_active: true, employee_id: null }
    ],
    roles: [
      { id: 'role-admin-a', organization_id: 'org-a', name: 'admin', is_system_role: true, deleted_at: null },
      { id: 'role-emp-a', organization_id: 'org-a', name: 'employee', is_system_role: true, deleted_at: null }
    ],
    actions: [{ id: 'a1', code: 'service_invoice.delete', deleted_at: null }, { id: 'a2', code: 'fiscal.manage', deleted_at: null }],
    role_actions: [],
    subscriptions: [{ id: 's', organization_id: 'org-a', status: 'active', plan_key: 'fiscal', deleted_at: null }],
    service_order_nfse: [
      { id: 'n-a', organization_id: 'org-a', provider_reference: 'ref-a', deleted_at: null },
      { id: 'n-b', organization_id: 'org-b', provider_reference: 'ref-b', deleted_at: null }
    ]
  })
  auth.getUser.mockReset()
  login('u-admin-a', 'admin@a.com')
})

const del = (reference: string) =>
  callHandler('server/api/fiscal/nfse/[reference]/index.delete.ts', fakeEvent({ method: 'DELETE', cookies, params: { reference }, body: {} }))

describe('NFS-e: cancelar (antes dava 403 para toda oficina; agora respeita oficina e permissão)', () => {
  it('NFS-e de OUTRA oficina → 404 (não revela que existe) e não chama a Focus NFe', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const r = await del('ref-b')
    expect(r.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('funcionário sem `service_invoice.delete` → 403', async () => {
    login('u-emp-a', 'func@a.com')
    expect((await del('ref-a')).status).toBe(403)
  })

  it('a oficina não é mais barrada por ser "não-owner": passa pelas checagens e só falha por falta de integração', async () => {
    const r = await del('ref-a')
    expect(r.status).not.toBe(403)
    expect(r.status).not.toBe(404)
  })
})

describe('hook/email/get de NFS-e também respeitam a oficina', () => {
  it.each([
    ['POST', 'server/api/fiscal/nfse/[reference]/hook.post.ts'],
    ['POST', 'server/api/fiscal/nfse/[reference]/email.post.ts'],
    ['GET', 'server/api/fiscal/nfse/[reference]/index.get.ts']
  ])('%s %s com referência de outra oficina → 404', async (method, file) => {
    const r = await callHandler(file, fakeEvent({ method, cookies, params: { reference: 'ref-b' }, body: {} }))
    expect(r.status).toBe(404)
  })
})

describe('fiscal/company/sync', () => {
  it('funcionário sem `fiscal.manage` → 403, mesmo enviando organization_id de outra oficina', async () => {
    login('u-emp-a', 'func@a.com')
    const r = await callHandler('server/api/fiscal/company/sync.post.ts', fakeEvent({ method: 'POST', cookies, body: { organization_id: 'org-b', business_id: '11222333000181', name: 'X' } }))
    expect(r.status).toBe(403)
    expect(fake.tables.fiscal_sync_status ?? []).toHaveLength(0)
  })
})

describe('rotas do owner agora vivem em /api/admin', () => {
  it.each([
    ['GET', 'server/api/admin/fiscal/companies/index.get.ts'],
    ['POST', 'server/api/admin/fiscal/companies/index.post.ts'],
    ['GET', 'server/api/admin/feedbacks/index.get.ts'],
    ['GET', 'server/api/admin/fiscal/logs.get.ts']
  ])('usuário de oficina (não owner) recebe 403 em %s %s', async (method, file) => {
    const r = await callHandler(file, fakeEvent({ method, cookies, body: {} }))
    expect(r.status).toBe(403)
  })

  it('o owner passa', async () => {
    login('u-owner', 'owner@x.com')
    const r = await callHandler('server/api/admin/feedbacks/index.get.ts', fakeEvent({ method: 'GET', cookies }))
    expect(r.status).not.toBe(403)
    expect(r.status).not.toBe(401)
  })

  it('as rotas antigas (sem guard de owner) não existem mais', async () => {
    const { existsSync } = await import('node:fs')
    for (const f of ['server/api/fiscal/company/index.get.ts', 'server/api/fiscal/company/index.post.ts', 'server/api/fiscal/company/[id].get.ts', 'server/api/fiscal/config/logs.get.ts', 'server/api/feedback/admin/index.get.ts'])
      expect(existsSync(f), f).toBe(false)
  })
})

describe('lookup-plate exige login', () => {
  it('sem sessão → 401', async () => {
    const r = await callHandler('server/api/vehicles/lookup-plate.get.ts', fakeEvent({ method: 'GET', query: { plate: 'ABC1D23' } }))
    expect(r.status).toBe(401)
  })
})

describe('admin/stats', () => {
  it('conta com head:true e inclui trial (nunca "trialing")', async () => {
    login('u-owner', 'owner@x.com')
    const r = await callHandler('server/api/admin/stats.get.ts', fakeEvent({ method: 'GET', cookies }))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ total_organizations: 0, active_subscriptions: 1 })
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('server/api/admin/stats.get.ts', 'utf8')).not.toContain('trialing\'')
  })
})
