// Fase 3 do plano de acesso (cobrança, D9): subscription.manage em cancel/checkout/portal e stripe/cancel-subscription/checkout;
// subscription.view em billing/status e billing/invoices. Exceção: usuário SEM organização (primeira assinatura; a org nasce no
// webhook do Stripe) mantém stripe/checkout, billing/checkout e a leitura de status/faturas; só quem já tem organização é guardado.
// Em todo 403 nenhuma chamada ao Stripe e nenhuma escrita acontece.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { guardSeed, USERS, type Persona } from '../../support/phase3-guard-fixture'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

const stripe = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn() } },
  billingPortal: { sessions: { create: vi.fn() } },
  subscriptions: { update: vi.fn(), retrieve: vi.fn() }
}))

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('../../../server/utils/stripe', () => ({ getStripe: () => stripe, getAllowedStripePriceIds: () => null }))
vi.mock('../../../server/utils/stripe-customer', () => ({ getOrCreateStripeCustomer: async () => 'cus_1' }))
vi.mock('../../../server/utils/focus-nfe', () => ({ deleteFocusNfeCompanyForOrg: vi.fn() }))
vi.mock('stripe', () => ({ default: class {} }))
// billing/invoices importa getQuery de 'h3'; o evento do harness não é um H3Event real.
vi.mock('h3', async importOriginal => ({ ...(await importOriginal<typeof import('h3')>()), getQuery: (e: { query: unknown }) => e.query }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const api = (p: string) => `server/api/${p}`
const NO_ORG = { id: 'u-noorg', email: 'noorg@x.com' }

type Case = { name: string, file: string, method: string, body?: unknown, code: string, noOrgOk: boolean }

const CASES: Case[] = [
  { name: 'billing/cancel', file: api('billing/cancel.post.ts'), method: 'POST', code: 'subscription.manage', noOrgOk: false },
  { name: 'billing/portal', file: api('billing/portal.post.ts'), method: 'POST', code: 'subscription.manage', noOrgOk: false },
  { name: 'stripe/cancel-subscription', file: api('stripe/cancel-subscription.post.ts'), method: 'POST', code: 'subscription.manage', noOrgOk: false },
  { name: 'billing/checkout', file: api('billing/checkout.post.ts'), method: 'POST', body: { priceId: 'price_1' }, code: 'subscription.manage', noOrgOk: true },
  { name: 'stripe/checkout', file: api('stripe/checkout.post.ts'), method: 'POST', body: { priceId: 'price_1' }, code: 'subscription.manage', noOrgOk: true },
  { name: 'billing/status', file: api('billing/status.get.ts'), method: 'GET', code: 'subscription.view', noOrgOk: true },
  { name: 'billing/invoices', file: api('billing/invoices.get.ts'), method: 'GET', code: 'subscription.view', noOrgOk: true }
]

const SUB_ROW = { id: 'sub-1', organization_id: 'org-a', user_email: 'owner@a.com', status: 'active', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_stripe_1', deleted_at: null }
const TABLES = {
  subscriptions: [SUB_ROW],
  stripe_customers: [{ user_id: 'u-owner', stripe_customer_id: 'cus_1' }, { user_id: 'u-com', stripe_customer_id: 'cus_2' }, { user_id: 'u-admin', stripe_customer_id: 'cus_3' }],
  billing_invoices: [],
  organizations: [{ id: 'org-a', is_active: true }]
}

function login(persona: Persona | 'noorg') {
  const u = persona === 'noorg' ? NO_ORG : USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

function seed(code: string, withGrant = true) {
  const s = guardSeed(withGrant ? [code] : [], TABLES)
  s.user_profiles!.push({ id: 'p-noorg', user_id: 'u-noorg', organization_id: null, role_id: null, is_owner: false, is_active: true, employee_id: null, display_name: 'Novo' })
  // stripe/cancel-subscription procura a assinatura pelo e-mail do usuário
  s.subscriptions = ['owner@a.com', 'admin@a.com', 'com@a.com', 'sem@a.com'].map((email, i) => ({ ...SUB_ROW, id: `sub-${i}`, user_email: email }))
  fake = createFakeSupabase(s)
}

beforeEach(() => {
  auth.refreshSession.mockReset()
  stripe.checkout.sessions.create.mockReset().mockResolvedValue({ url: 'https://stripe.test/s' })
  stripe.billingPortal.sessions.create.mockReset().mockResolvedValue({ url: 'https://stripe.test/p' })
  stripe.subscriptions.update.mockReset().mockResolvedValue({ cancel_at_period_end: true })
  stripe.subscriptions.retrieve.mockReset().mockRejectedValue(new Error('offline'))
})

const run = (c: Case) => callHandler(c.file, fakeEvent({ method: c.method, cookies, body: c.body }))
const stripeCalls = () => [
  stripe.checkout.sessions.create, stripe.billingPortal.sessions.create, stripe.subscriptions.update, stripe.subscriptions.retrieve
].reduce((n, f) => n + f.mock.calls.length, 0)

describe.each(CASES)('$name exige $code', (c) => {
  it('membro sem o código -> 403, sem chamada ao Stripe e sem escrita', async () => {
    seed(c.code)
    login('sem')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(stripeCalls()).toBe(0)
    expect(fake.writes).toHaveLength(0)
  })

  it('membro com o código -> sucesso', async () => {
    seed(c.code)
    login('com')
    const res = await run(c)
    expect(res.error?.message ?? '').toBe('')
    expect(res.status).toBe(200)
  })

  it.each(['admin', 'owner'] as const)('%s passa sem concessão', async (persona) => {
    seed(c.code, false)
    login(persona)
    const res = await run(c)
    expect(res.status).toBe(200)
  })

  if (c.noOrgOk) {
    it('usuário SEM organização (primeira assinatura) não é bloqueado pelo guarda', async () => {
      seed(c.code)
      login('noorg')
      const res = await run(c)
      // checkout: 200 com sessão criada; status/invoices: o guarda passa e o handler segue o caminho antigo
      // (resolveOrganizationId -> 400 "Usuário não vinculado a uma organização")
      if (c.name.endsWith('checkout')) {
        expect(res.status).toBe(200)
        expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1)
      } else {
        expect(res.status).toBe(400)
      }
    })
  } else {
    it('usuário sem organização continua recusado (rota não faz parte do fluxo de primeira assinatura)', async () => {
      seed(c.code)
      login('noorg')
      const res = await run(c)
      expect([400, 403]).toContain(res.status)
      expect(stripeCalls()).toBe(0)
    })
  }
})

describe('membro sem subscription.manage no checkout: nenhuma sessão criada', () => {
  it.each(['billing/checkout', 'stripe/checkout'])('%s', async (name) => {
    const c = CASES.find(x => x.name === name)!
    seed(c.code)
    login('sem')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })
})

describe('membro com organização e role_id nulo (não owner, não admin)', () => {
  it.each(['billing/checkout', 'stripe/checkout', 'billing/status'])('%s -> 403 sem chamar o Stripe', async (name) => {
    const c = CASES.find(x => x.name === name)!
    seed(c.code)
    fake.tables.user_profiles!.push({ id: 'p-norole', user_id: 'u-norole', organization_id: 'org-a', role_id: null, is_owner: false, is_active: true, employee_id: null })
    auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u-norole', email: 'norole@a.com' } }, error: null })
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(stripeCalls()).toBe(0)
  })
})

describe('erro transitório ao ler o perfil não libera o checkout', () => {
  it.each(['billing/checkout', 'stripe/checkout'])('%s -> 503 sem chamar o Stripe', async (name) => {
    const c = CASES.find(x => x.name === name)!
    seed(c.code)
    login('noorg')
    fake.failNext('user_profiles', 'boom')
    const res = await run(c)
    expect(res.status).toBe(503)
    expect(stripeCalls()).toBe(0)
  })
})
