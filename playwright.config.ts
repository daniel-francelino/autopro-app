import { defineConfig, devices } from '@playwright/test'

// E2E (L5). Poucos cenários, só o que depende de navegador. Ver docs/testing/test-plan.md §9.
// O servidor sobe com URLs de Supabase FALSAS e locais: nenhum teste aqui fala com o projeto real.
// Cenários que precisam de usuário logado exigem o Supabase local (E2E_AUTH=1) e ficam fora do padrão.
const PORT = Number(process.env.E2E_PORT ?? 3100)

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }, grep: /@mobile/ }
  ],
  webServer: {
    command: `pnpm exec nuxt dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NUXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
      SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? 'e2e-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? 'e2e-service-key',
      STRIPE_SECRET_KEY: 'sk_test_e2e_placeholder',
      STRIPE_WEBHOOK_SECRET: 'whsec_e2e_placeholder'
    }
  }
})
