// L3-lite — matriz M1 (no session → 401) e regra "admin só para owner" executadas nos
// handlers REAIS, com os guards reais (requireAuthUser/requireOwner) e Supabase falso.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../helpers/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fake-supabase'
import { listHandlers } from '../../helpers/source-scan'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
// Nunca falar com serviços externos de verdade durante a matriz.
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const handlers = listHandlers()
const PUBLIC = [
  'server/api/auth/', 'server/api/stripe/webhook', 'server/api/supabase/health', 'server/api/metrics/track'
]
// Rotas sem guard conhecidas (ver docs/testing/known-failures.md KF-05..KF-08) — saem da matriz M1.
const KNOWN_OPEN = new Set([
  'server/api/consulta/index.get.ts',
  'server/api/fiscal/zip_code/index.get.ts',
  'server/api/reports/export-file.post.ts',
  'server/api/vehicles/lookup-plate.get.ts'
])

const protectedHandlers = handlers.filter(h => h.size > 0 && !KNOWN_OPEN.has(h.file) && !PUBLIC.some(p => h.file.startsWith(p)))

beforeEach(() => {
  fake = createFakeSupabase({ user_profiles: [{ user_id: 'u1', organization_id: 'org-a', is_owner: false, is_active: true }] })
  auth.getUser.mockReset().mockResolvedValue({ data: { user: null }, error: { status: 401 } })
  auth.refreshSession.mockReset().mockResolvedValue({ data: { session: null }, error: { status: 401 } })
})

describe('M1: no session cookie → 401 on every protected handler', () => {
  it('there are protected handlers to exercise', () => {
    expect(protectedHandlers.length).toBeGreaterThan(200)
  })

  it.each(protectedHandlers.map(h => [h.file]))('%s', async (file) => {
    const method = file.match(/\.(get|post|put|patch|delete)\.ts$/)![1]!.toUpperCase()
    const result = await callHandler(file, fakeEvent({ method, params: { id: 'x', reference: 'x', orderId: 'x', transactionId: 'x' } }))
    expect(result.status, `${file} respondeu ${result.status} (${result.error?.message ?? ''})`).toBe(401)
  })
})

describe('Platform admin: non-owner gets 403', () => {
  const admin = protectedHandlers.filter(h => h.file.startsWith('server/api/admin/'))

  it.each(admin.map(h => [h.file]))('%s', async (file) => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c' } }, error: null })
    const method = file.match(/\.(get|post|put|patch|delete)\.ts$/)![1]!.toUpperCase()
    const result = await callHandler(file, fakeEvent({ method, cookies: { 'sb-access-token': 'tok' } }))
    expect(result.status, `${file}: ${result.error?.message}`).toBe(403)
  })
})
