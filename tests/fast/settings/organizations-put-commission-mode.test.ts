// ORG-1..ORG-10: PUT /api/organizations com commission_release_mode (docs/testing/commission-launch-mode-test-scenarios.md).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { guardSeed, USERS, type Persona } from '../../support/phase3-guard-fixture'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const FILE = 'server/api/organizations/index.put.ts'
const cookies = { 'sb-access-token': 'tok' }

function seed(orgAMode: 'full' | 'proportional' = 'full', orgBMode: 'full' | 'proportional' = 'full') {
  fake = createFakeSupabase(guardSeed(['settings.update'], {
    organizations: [
      { id: 'org-a', name: 'A', commission_release_mode: orgAMode },
      { id: 'org-b', name: 'B', commission_release_mode: orgBMode }
    ],
    service_orders: [{ id: 'o1', organization_id: 'org-a', commission_release_mode: 'proportional' }],
    employee_financial_records: [{ id: 'r1', organization_id: 'org-a', service_order_id: 'o1', record_type: 'commission' }]
  }))
}
function login(persona: Persona = 'owner') {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}
async function put(body: unknown) {
  const event = fakeEvent({ method: 'PUT', cookies, body }) as ReturnType<typeof fakeEvent> & { context: { audit: Record<string, any> } }
  event.context = { audit: { requestId: 'req-1', startedAt: 0 } }
  const res = await callHandler(FILE, event)
  return { res, audit: event.context.audit }
}
const orgRow = (id: string) => fake.tables.organizations!.find(o => o.id === id)!
const orgWrites = () => fake.writes.filter(w => w.table === 'organizations')

beforeEach(() => {
  seed()
  login()
  auth.refreshSession.mockReset()
})

describe('PUT organizations: commission_release_mode', () => {
  it('ORG-1: full -> proportional persists, returns 200 and sets updated_by', async () => {
    const { res } = await put({ commission_release_mode: 'proportional' })
    expect(res.status).toBe(200)
    expect(orgRow('org-a').commission_release_mode).toBe('proportional')
    expect(orgRow('org-a').updated_by).toBe(USERS.owner.email)
  })

  it.each([['x'], [''], [null], [1], [true], ['FULL'], [['full']]])('ORG-2: invalid value %j -> 400 and no write', async (value) => {
    const { res } = await put({ commission_release_mode: value })
    expect(res.status).toBe(400)
    expect(orgWrites()).toHaveLength(0)
    expect(orgRow('org-a').commission_release_mode).toBe('full')
  })

  it('ORG-3: role without settings.update -> 403 and org untouched', async () => {
    login('sem')
    const { res } = await put({ commission_release_mode: 'proportional' })
    expect(res.status).toBe(403)
    expect(orgWrites()).toHaveLength(0)
    expect(orgRow('org-a').commission_release_mode).toBe('full')
  })

  it('ORG-4: org-a user changes org-a only; id/organization_id in the body cannot redirect the update to org-b', async () => {
    const { res } = await put({ commission_release_mode: 'proportional', id: 'org-b', organization_id: 'org-b' })
    expect(res.status).toBe(200)
    expect(orgRow('org-a').commission_release_mode).toBe('proportional')
    expect(orgRow('org-b').commission_release_mode).toBe('full')
    expect(orgWrites().every(w => w.filters.includes('id=org-a'))).toBe(true)
    expect(JSON.stringify(orgWrites().map(w => w.values))).not.toContain('org-b')
  })

  it('ORG-5: audits before/after exactly when the mode changes', async () => {
    const { res, audit } = await put({ commission_release_mode: 'proportional' })
    expect(res.status).toBe(200)
    expect(audit.resourceType).toBe('organization')
    expect(audit.resourceId).toBe('org-a')
    const changes = JSON.stringify(audit.changes)
    expect(changes).toContain('full')
    expect(changes).toContain('proportional')
    expect(changes).toContain('commission_release_mode')
  })

  it('ORG-6: same value (full -> full) -> 200 and no audit', async () => {
    const { res, audit } = await put({ commission_release_mode: 'full' })
    expect(res.status).toBe(200)
    expect(audit.changes).toBeUndefined()
    expect(audit.resourceType).toBeUndefined()
  })

  it('ORG-7: body without the field keeps the mode, no audit and no previous read', async () => {
    const reads = vi.spyOn(fake.client, 'from')
    const { res, audit } = await put({ name: 'Novo nome' })
    expect(res.status).toBe(200)
    expect(orgRow('org-a')).toMatchObject({ name: 'Novo nome', commission_release_mode: 'full' })
    expect(audit.changes).toBeUndefined()
    expect(reads.mock.calls.filter(c => c[0] === 'organizations')).toHaveLength(1) // só o update
  })

  it('ORG-8: fields outside the whitelist are ignored (mass-assignment)', async () => {
    const { res } = await put({ commission_release_mode: 'proportional', is_owner: true, plan: 'pro', id: 'x' })
    expect(res.status).toBe(200)
    const values = orgWrites()[0]!.values as Record<string, unknown>
    expect(Object.keys(values).sort()).toEqual(['commission_release_mode', 'updated_by'])
  })

  it('ORG-9: failure reading the current org -> 500 and nothing written', async () => {
    fake.failNext('organizations')
    const { res } = await put({ commission_release_mode: 'proportional' })
    expect(res.status).toBe(500)
    expect(orgWrites()).toHaveLength(0)
    expect(orgRow('org-a').commission_release_mode).toBe('full')
  })

  it('ORG-10: changing the org mode does not touch service_orders or employee_financial_records', async () => {
    const { res } = await put({ commission_release_mode: 'proportional' })
    expect(res.status).toBe(200)
    expect(fake.writes.filter(w => w.table !== 'organizations')).toHaveLength(0)
    expect(fake.tables.service_orders![0]!.commission_release_mode).toBe('proportional')
    expect(fake.tables.employee_financial_records).toHaveLength(1)
  })
})
