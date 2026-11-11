import { defineConfig, devices } from '@playwright/test'

// E2E (L5). Poucos cenários, só o que depende de navegador. Ver docs/testing/test-plan.md §9.
// O servidor sobe com URLs de Supabase FALSAS e locais: nenhum teste aqui fala com o projeto real.
// Fluxos com usuário logado exigem o Supabase local (E2E_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY); sem eles são pulados.
// Ver tests/README.md e tests/e2e/support/env.ts.
const PORT = Number(process.env.E2E_PORT ?? 3100)
const PROD = process.env.E2E_SERVER === 'prod'
// O build escuta em IPv4; evita que `localhost` resolva para ::1 no Windows.
const HOST = PROD ? '127.0.0.1' : 'localhost'

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  outputDir: '.test-output/playwright',
  // Saída mínima fora do CI; VERBOSE=1 volta ao 'list'.
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: '.test-output/playwright-report' }]]
    : process.env.VERBOSE ? 'list' : 'dot',
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: 'retain-on-failure',
    video: 'off'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }, grep: /@mobile/ }
  ],
  webServer: {
    // E2E_SERVER=prod: serve o build (.output) feito por `pnpm test:stack`. É o modo do CI: sobe em segundos e
    // não compila telas sob demanda. Sem a variável, usa o servidor de dev (`pnpm test:e2e` avulso).
    command: PROD ? `node .output/server/index.mjs` : `pnpm exec nuxt dev --port ${PORT}`,
    url: `http://${HOST}:${PORT}`,
    // No modo prod nunca reaproveita: um servidor antigo/de dev na porta serviria código errado (falso verde/vermelho).
    reuseExistingServer: !process.env.CI && !PROD,
    timeout: PROD ? 60_000 : 300_000,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NUXT_PUBLIC_SITE_URL: `http://${HOST}:${PORT}`,
      SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? 'e2e-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? 'e2e-service-key',
      STRIPE_SECRET_KEY: 'sk_test_e2e_placeholder',
      STRIPE_WEBHOOK_SECRET: 'whsec_e2e_placeholder'
    }
  }
})
