// Fluxo: para onde cada tipo de usuário é levado (E2/E3 do plano). Regras de app/middleware/auth.global.ts.
// Precisa do Supabase local (ver support/env.ts); sem ele o spec é pulado.
import { expect, skipUnlessAuth, test, type UserKind } from './support/fixtures'

skipUnlessAuth(test)

const cases: Array<{ who: UserKind, from: string, to: RegExp, why: string }> = [
  { who: 'platformOwner', from: '/app', to: /\/admin(\/|$)/, why: 'dono da plataforma nunca fica no /app' },
  { who: 'platformOwner', from: '/subscription', to: /\/admin(\/|$)/, why: 'dono da plataforma não vê assinatura' },
  { who: 'platformOwner', from: '/login', to: /\/admin(\/|$)/, why: 'logado em /login vai para o destino dele' },
  { who: 'admin', from: '/admin', to: /\/app(\/|$)/, why: 'admin de oficina é barrado em /admin (R1/R2)' },
  { who: 'staff', from: '/admin', to: /\/app(\/|$)/, why: 'funcionário é barrado em /admin' },
  { who: 'admin', from: '/onboarding', to: /\/app(\/|$)/, why: 'onboarding já concluído' },
  { who: 'admin', from: '/subscription', to: /\/app(\/|$)/, why: 'quem já tem oficina não vê a assinatura inicial' },
  { who: 'noOrg', from: '/app', to: /\/subscription/, why: 'sem oficina → assinatura' },
  { who: 'noOrg', from: '/onboarding', to: /\/subscription/, why: 'sem oficina não faz onboarding' },
  { who: 'pendingOnboarding', from: '/app', to: /\/onboarding/, why: 'onboarding pendente trava o /app' },
  { who: 'pendingOnboarding', from: '/app/financial', to: /\/onboarding/, why: 'qualquer rota do /app respeita o onboarding' }
]

test.describe('Flow: redirect by profile', () => {
  for (const c of cases) {
    test(`${c.who}: ${c.from} → ${c.to} (${c.why})`, async ({ page, loginAs }) => {
      await loginAs(c.who)
      await page.goto(c.from)
      await expect(page).toHaveURL(c.to, { timeout: 20_000 })
    })
  }
})

test.describe('Flow: the API respects the same profile', () => {
  test('workshop admin → 403 on platform owner routes', async ({ apiAs }) => {
    const api = await apiAs('admin')
    for (const path of ['/api/admin/audit-logs', '/api/admin/organizations', '/api/admin/users']) {
      const res = await api.get(path)
      expect(res.status, path).toBe(403)
    }
  })
  test('platform owner accesses the audit log (default period)', async ({ apiAs }) => {
    const api = await apiAs('platformOwner')
    const res = await api.get('/api/admin/audit-logs')
    expect(res.status).toBe(200)
  })
})
