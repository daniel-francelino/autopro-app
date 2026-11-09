// Handlers do painel do owner (Fases 2–5): só owner, validações e regras de negócio. Handlers reais + Supabase falso.
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
const ORG = '33333333-3333-4333-8333-333333333333'
const USER_PROFILE = '44444444-4444-4444-8444-444444444444'
const OWNER_PROFILE = '55555555-5555-4555-8555-555555555555'
const login = (id: string, email: string) => auth.getUser.mockResolvedValue({ data: { user: { id, email } }, error: null })

function seed() {
  fake = createFakeSupabase({
    user_profiles: [
      { id: 'p-owner', user_id: 'u-owner', email: 'owner@x.com', organization_id: null, is_owner: true, is_active: true, deleted_at: null },
      { id: 'p-emp', user_id: 'u-emp', email: 'func@a.com', organization_id: ORG, role_id: 'r', is_owner: false, is_active: true, employee_id: null, deleted_at: null },
      { id: USER_PROFILE, user_id: 'u-target', email: 'alvo@a.com', display_name: 'Alvo', organization_id: ORG, role_id: 'r', is_owner: false, is_active: true, deleted_at: null },
      { id: OWNER_PROFILE, user_id: 'u-other-owner', email: 'owner2@x.com', organization_id: null, is_owner: true, is_active: true, deleted_at: null }
    ],
    organizations: [{ id: ORG, name: 'Oficina A', suspended_at: null, deleted_at: null }],
    roles: [{ id: 'r', display_name: 'Funcionário', name: 'employee' }],
    subscriptions: [],
    geo_probe_runs: [],
    audit_logs: []
  })
}

beforeEach(() => {
  seed()
  auth.getUser.mockReset()
  login('u-owner', 'owner@x.com')
})

const call = (file: string, method: string, opts: { params?: Record<string, string>, body?: unknown, query?: Record<string, unknown> } = {}) =>
  callHandler(file, fakeEvent({ method, cookies, ...opts }))

const ORG_ROUTES: Array<[string, string]> = [
  ['GET', 'server/api/admin/organizations/[id].get.ts'],
  ['GET', 'server/api/admin/organizations/[id]/users.get.ts'],
  ['GET', 'server/api/admin/organizations/[id]/billing.get.ts'],
  ['GET', 'server/api/admin/organizations/[id]/activity.get.ts'],
  ['GET', 'server/api/admin/organizations/[id]/usage.get.ts'],
  ['GET', 'server/api/admin/organizations/[id]/fiscal.get.ts'],
  ['POST', 'server/api/admin/organizations/[id]/suspend.post.ts'],
  ['POST', 'server/api/admin/organizations/[id]/reactivate.post.ts'],
  ['POST', 'server/api/admin/users/[id]/deactivate.post.ts'],
  ['POST', 'server/api/admin/users/[id]/reactivate.post.ts']
]
const GLOBAL_ROUTES: Array<[string, string]> = [
  ['GET', 'server/api/admin/billing/summary.get.ts'],
  ['GET', 'server/api/admin/billing/webhooks.get.ts'],
  ['GET', 'server/api/admin/geo/summary.get.ts'],
  ['GET', 'server/api/admin/geo/runs.get.ts'],
  ['POST', 'server/api/admin/geo/runs.post.ts'],
  ['GET', 'server/api/admin/system.get.ts'],
  ['GET', 'server/api/admin/feedbacks/[id].get.ts'],
  ['POST', 'server/api/admin/feedbacks/[id]/respond.post.ts']
]

describe('todas as rotas novas: só o owner', () => {
  it.each([...ORG_ROUTES, ...GLOBAL_ROUTES])('%s %s → 401 sem sessão', async (method, file) => {
    expect((await callHandler(file, fakeEvent({ method, params: { id: ORG }, body: {} }))).status).toBe(401)
  })

  it.each([...ORG_ROUTES, ...GLOBAL_ROUTES])('%s %s → 403 para usuário de oficina', async (method, file) => {
    login('u-emp', 'func@a.com')
    expect((await call(file, method, { params: { id: ORG }, body: { reason: 'motivo válido' } })).status).toBe(403)
    expect(fake.writes.filter(w => w.table !== 'audit_logs')).toHaveLength(0)
  })
})

describe('ficha da oficina', () => {
  it('id que não é UUID → 400; oficina inexistente → 404', async () => {
    expect((await call('server/api/admin/organizations/[id].get.ts', 'GET', { params: { id: 'abc' } })).status).toBe(400)
    expect((await call('server/api/admin/organizations/[id].get.ts', 'GET', { params: { id: '99999999-9999-4999-8999-999999999999' } })).status).toBe(404)
  })

  it('cabeçalho devolve a oficina', async () => {
    const r = await call('server/api/admin/organizations/[id].get.ts', 'GET', { params: { id: ORG } })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: ORG, name: 'Oficina A', subscription: null })
  })

  it('usuários trazem o nome do papel', async () => {
    const r = await call('server/api/admin/organizations/[id]/users.get.ts', 'GET', { params: { id: ORG } })
    const users = (r.body as any).data as Array<Record<string, unknown>>
    expect(users.map(u => u.email).sort()).toEqual(['alvo@a.com', 'func@a.com'])
    expect(users[0]).toMatchObject({ role_name: 'Funcionário' })
  })

  it('uso: devolve 6 meses e os módulos', async () => {
    const r = await call('server/api/admin/organizations/[id]/usage.get.ts', 'GET', { params: { id: ORG } })
    expect(r.status).toBe(200)
    expect((r.body as any).service_orders_by_month).toHaveLength(6)
    expect((r.body as any).modules.length).toBeGreaterThan(3)
  })
})

describe('suspender e reativar oficina', () => {
  const suspend = (reason?: string) => call('server/api/admin/organizations/[id]/suspend.post.ts', 'POST', { params: { id: ORG }, body: { reason } })
  const reactivate = (reason?: string) => call('server/api/admin/organizations/[id]/reactivate.post.ts', 'POST', { params: { id: ORG }, body: { reason } })
  const org = () => fake.tables.organizations![0]!

  it('exige motivo (mínimo 5 caracteres) e não altera nada sem ele', async () => {
    expect((await suspend()).status).toBe(400)
    expect((await suspend('abc')).status).toBe(400)
    expect(org().suspended_at).toBeNull()
  })

  it('suspende com motivo, registra quem e quando; segunda vez → 409', async () => {
    const r = await suspend('Inadimplência há 60 dias')
    expect(r.status).toBe(200)
    expect(org()).toMatchObject({ suspended_reason: 'Inadimplência há 60 dias', suspended_by: 'owner@x.com' })
    expect(org().suspended_at).toBeTruthy()
    expect((await suspend('de novo, sem efeito')).status).toBe(409)
  })

  it('reativar limpa os campos; reativar quem não está suspenso → 409', async () => {
    expect((await reactivate('já regularizou')).status).toBe(409)
    await suspend('Inadimplência há 60 dias')
    expect((await reactivate('Pagamento confirmado')).status).toBe(200)
    expect(org()).toMatchObject({ suspended_at: null, suspended_reason: null, suspended_by: null })
  })

  it('oficina inexistente → 404', async () => {
    const r = await call('server/api/admin/organizations/[id]/suspend.post.ts', 'POST', { params: { id: '99999999-9999-4999-8999-999999999999' }, body: { reason: 'motivo válido' } })
    expect(r.status).toBe(404)
  })
})

describe('desativar e reativar usuário', () => {
  const deactivate = (id: string, reason?: string) => call('server/api/admin/users/[id]/deactivate.post.ts', 'POST', { params: { id }, body: { reason } })
  const reactivate = (id: string, reason?: string) => call('server/api/admin/users/[id]/reactivate.post.ts', 'POST', { params: { id }, body: { reason } })
  const target = () => fake.tables.user_profiles!.find(p => p.id === USER_PROFILE)!

  it('exige motivo', async () => {
    expect((await deactivate(USER_PROFILE)).status).toBe(400)
    expect(target().is_active).toBe(true)
  })

  it('desativa e reativa; repetir a mesma ação → 409', async () => {
    expect((await deactivate(USER_PROFILE, 'Desligado da oficina')).status).toBe(200)
    expect(target().is_active).toBe(false)
    expect((await deactivate(USER_PROFILE, 'Desligado da oficina')).status).toBe(409)
    expect((await reactivate(USER_PROFILE, 'Voltou a trabalhar')).status).toBe(200)
    expect(target().is_active).toBe(true)
    expect((await reactivate(USER_PROFILE, 'Voltou a trabalhar')).status).toBe(409)
  })

  it('não age sobre owners nem sobre si mesmo', async () => {
    expect((await deactivate(OWNER_PROFILE, 'tentativa de abuso')).status).toBe(409)
    expect((await deactivate('55555555-0000-4000-8000-000000000000', 'não existe')).status).toBe(404)
    expect(fake.tables.user_profiles!.find(p => p.id === OWNER_PROFILE)!.is_active).toBe(true)
  })
})

describe('bateria GEO', () => {
  const run = (over: Record<string, unknown> = {}) => ({
    run_date: '2026-11-09', question_id: 19, engine: 'chatgpt', search_enabled: true,
    brand_mentioned: true, brand_linked: false, recommended: false, ...over
  })
  const post = (body: unknown) => call('server/api/admin/geo/runs.post.ts', 'POST', { body })

  it('grava o texto da pergunta a partir da bateria fixa (ignora o enviado)', async () => {
    const r = await post(run({ question_text: 'pergunta trocada' }))
    expect(r.status).toBe(200)
    const saved = fake.tables.geo_probe_runs![0]!
    expect(saved.question_text).toContain('AutoPro')
    expect(saved.created_by).toBe('owner@x.com')
  })

  it('aceita lista e rejeita motor, pergunta e data inválidos', async () => {
    expect((await post([run(), run({ question_id: 20 })])).body).toMatchObject({ saved: 2 })
    expect((await post(run({ engine: 'bing' }))).status).toBe(400)
    expect((await post(run({ question_id: 21 }))).status).toBe(400)
    expect((await post(run({ run_date: '09/11/2026' }))).status).toBe(400)
    expect((await post({})).status).toBe(400)
  })

  it('o resumo calcula taxas das linhas gravadas', async () => {
    fake.tables.geo_probe_runs!.push(
      { run_date: new Date().toISOString().slice(0, 10), engine: 'claude', search_enabled: true, brand_mentioned: true, brand_linked: true, recommended: false, price_correct: true, fiscal_correct: null },
      { run_date: new Date().toISOString().slice(0, 10), engine: 'claude', search_enabled: true, brand_mentioned: false, brand_linked: false, recommended: false, price_correct: null, fiscal_correct: null }
    )
    const r = await call('server/api/admin/geo/summary.get.ts', 'GET')
    expect(r.status).toBe(200)
    expect((r.body as any).overall).toMatchObject({ total: 2, mention_rate: 50, link_rate: 50, price_accuracy: 100 })
    expect((r.body as any).by_engine[0]).toMatchObject({ engine: 'claude' })
  })
})

describe('cobrança e sistema', () => {
  it('summary devolve MRR e série de 12 meses', async () => {
    fake.tables.subscriptions!.push({ status: 'active', plan_key: 'pro', monthly_amount: 120, start_date: '2026-01-01', cancellation_date: null, deleted_at: null })
    fake.tables.billing_invoices = []
    const r = await call('server/api/admin/billing/summary.get.ts', 'GET')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ mrr: 120, active_subscriptions: 1 })
    expect((r.body as any).series).toHaveLength(12)
  })

  it('system: lista owners e alerta quando há um só', async () => {
    fake.tables.user_profiles = fake.tables.user_profiles!.filter(p => p.id !== OWNER_PROFILE)
    const r = await call('server/api/admin/system.get.ts', 'GET')
    expect(r.status).toBe(200)
    expect((r.body as any).owners).toHaveLength(1)
    expect((r.body as any).owner_alert).toMatch(/um owner/)
    expect((r.body as any).checks.map((c: { key: string }) => c.key)).toContain('supabase')
    expect(JSON.stringify(r.body)).not.toMatch(/sk_|whsec_|service_role/i)
  })
})
