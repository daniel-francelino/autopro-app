// Consulta do log de auditoria (/api/admin/audit-logs): só o platform owner (plano §4.2 e §9).
import { readFileSync } from 'node:fs'
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

const LIST = 'server/api/admin/audit-logs/index.get.ts'
const DETAIL = 'server/api/admin/audit-logs/[id].get.ts'
const cookies = { 'sb-access-token': 'tok' }

const ORG_A = '33333333-3333-4333-8333-333333333333'
const ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const REQ = 'abc12345-0000-4000-8000-000000000001'

const row = (over: Record<string, unknown>) => ({
  organization_id: ORG_A, actor_email: 'maria@oficina.com', action: 'client.create', resource_type: 'client',
  http_method: 'POST', route_pattern: '/api/clients', status_code: 200, outcome: 'success',
  created_at: new Date().toISOString(), request_id: REQ, ...over
})

function seed(isOwner: boolean) {
  fake = createFakeSupabase({
    user_profiles: [{ id: 'p1', user_id: 'u1', organization_id: ORG_A, role_id: 'r', is_owner: isOwner, is_active: true, employee_id: null }],
    organizations: [{ id: ORG_A, name: 'Oficina A' }],
    audit_logs: [
      row({ id: ID_1 }),
      row({ id: ID_2, actor_email: 'joao@outra.com', action: 'service_order.cancel', status_code: 500, outcome: 'error', request_body: { x: 1 }, request_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
      row({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', action: 'client.update', request_id: REQ, created_at: new Date(Date.now() - 40 * 86_400_000).toISOString() })
    ]
  })
}

beforeEach(() => {
  seed(true)
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'owner@x.com' } }, error: null })
})

const list = (query: Record<string, unknown> = {}, ck: Record<string, string> = cookies) =>
  callHandler(LIST, fakeEvent({ cookies: ck, query }))

describe('GET /api/admin/audit-logs', () => {
  it('no session → 401', async () => {
    expect((await list({}, {})).status).toBe(401)
  })

  it('workshop user (not owner) → 403', async () => {
    seed(false)
    expect((await list()).status).toBe(403)
  })

  it('owner: lists the rows of the period (default 24 h) with the workshop name and no bodies', async () => {
    const r = await list()
    expect(r.status).toBe(200)
    const body = r.body as any
    expect(body.total).toBe(2) // a de 40 dias fica fora do período padrão
    expect(body.data[0]).toMatchObject({ organization_name: 'Oficina A' })
    // O fake ignora a lista de colunas; confere no código que a lista nunca seleciona corpos.
    const columns = readFileSync(LIST, 'utf8').match(/LIST_COLUMNS = '([^']+)'/)![1]!
    expect(columns).not.toMatch(/request_body|response_body|changes/)
  })

  it('period longer than 31 days → 400; end before start → 400; invalid date → 400', async () => {
    const to = new Date()
    expect((await list({ from: new Date(to.getTime() - 40 * 86_400_000).toISOString(), to: to.toISOString() })).status).toBe(400)
    expect((await list({ from: to.toISOString(), to: new Date(to.getTime() - 1000).toISOString() })).status).toBe(400)
    expect((await list({ from: 'ontem' })).status).toBe(400)
  })

  it('filters by email (partial), action, outcome and organization', async () => {
    expect(((await list({ actorEmail: 'JOAO' })).body as any).data.map((x: any) => x.id)).toEqual([ID_2])
    expect(((await list({ action: 'client.create' })).body as any).data.map((x: any) => x.id)).toEqual([ID_1])
    expect(((await list({ outcome: 'error,denied' })).body as any).data.map((x: any) => x.id)).toEqual([ID_2])
    expect(((await list({ organizationId: 'outra' })).body as any).total).toBe(0)
  })

  it('filters by the short error code (first 8 characters of request_id)', async () => {
    const r = await list({ requestId: 'abc12345' })
    expect(((r.body as any).data as any[]).map(x => x.id)).toEqual([ID_1])
    expect((await list({ requestId: 'zzzz' })).status).toBe(400)
  })

  it('pageSize is capped at 100', async () => {
    expect(((await list({ pageSize: 9999 })).body as any).pageSize).toBe(100)
  })
})

describe('GET /api/admin/audit-logs/:id', () => {
  const detail = (id: string, ck: Record<string, string> = cookies) =>
    callHandler(DETAIL, fakeEvent({ cookies: ck, params: { id } }))

  it('no session → 401; non-owner → 403', async () => {
    expect((await detail(ID_1, {})).status).toBe(401)
    seed(false)
    expect((await detail(ID_1)).status).toBe(403)
  })

  it('invalid id → 400; nonexistent → 404', async () => {
    expect((await detail('nao-e-uuid')).status).toBe(400)
    expect((await detail('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).status).toBe(404)
  })

  it('returns the full row and the other rows of the same request', async () => {
    const r = await detail(ID_2)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: ID_2, request_body: { x: 1 }, organization_name: 'Oficina A', related: [] })

    const same = await detail(ID_1)
    expect((same.body as any).related.map((x: any) => x.action)).toEqual(['client.update'])
  })
})
