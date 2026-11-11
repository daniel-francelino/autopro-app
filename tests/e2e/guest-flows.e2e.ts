import { expect, test } from '@playwright/test'

// Fluxos do VISITANTE (sem Supabase de verdade): validação de formulário, navegação entre telas de acesso
// e recusa de credenciais inválidas. Rodam sempre, com ou sem E2E_SUPABASE_*.

test.describe('Flow: sign in (validation and refusal)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Bem-vindo de volta' })).toBeVisible()
  })

  test('invalid email is blocked in the form, without calling the API', async ({ page }) => {
    let loginCalls = 0
    page.on('request', (req) => { if (req.url().includes('/api/auth/login')) loginCalls++ })
    await page.getByLabel('Email').fill('isto-nao-e-email')
    await page.getByLabel('Senha').fill('SenhaQualquer1')
    await page.getByLabel('Senha').press('Enter')
    await expect(page.getByText('Email inválido')).toBeVisible()
    expect(loginCalls).toBe(0)
    await expect(page).toHaveURL(/\/login/)
  })

  test('short password is blocked in the form', async ({ page }) => {
    await page.getByLabel('Email').fill('alguem@exemplo.com')
    await page.getByLabel('Senha').fill('curta')
    await page.getByLabel('Senha').press('Enter')
    await expect(page.getByText('A senha deve ter pelo menos 8 caracteres')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('credentials the server refuses keep the user on /login, without session', async ({ page, context }) => {
    const response = page.waitForResponse(r => r.url().includes('/api/auth/login') && r.request().method() === 'POST')
    await page.getByLabel('Email').fill('ninguem@exemplo.com')
    await page.getByLabel('Senha').fill('SenhaErrada123')
    await page.getByLabel('Senha').press('Enter')
    expect((await response).status()).toBeGreaterThanOrEqual(400)
    await expect(page).toHaveURL(/\/login/)
    const cookies = await context.cookies()
    expect(cookies.some(c => c.name === 'sb-access-token')).toBe(false)
    // tentar abrir a área protegida continua mandando para o login
    await page.goto('/app')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('Flow: navigate between access screens', () => {
  test('login → create account → back to sign in', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: 'Crie sua conta' }).click()
    await expect(page).toHaveURL(/\/signup/)
    await expect(page.getByRole('heading', { name: 'Crie sua conta' })).toBeVisible()
    await page.getByRole('link', { name: 'Entrar' }).first().click()
    await expect(page).toHaveURL(/\/login/)
  })

  test('login → forgot password → back', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: 'Esqueceu a senha?' }).click()
    await expect(page).toHaveURL(/\/forgot-password/)
    await expect(page.getByRole('heading', { name: 'Recuperar senha' })).toBeVisible()
  })
})

test.describe('Flow: create account (validation)', () => {
  test('required fields and email/password rules', async ({ page }) => {
    let signupCalls = 0
    page.on('request', (req) => { if (req.url().includes('/api/auth/signup')) signupCalls++ })
    await page.goto('/signup')
    await page.getByRole('button', { name: 'Criar conta' }).click()
    await expect(page.getByText('O nome é obrigatório')).toBeVisible()
    await expect(page.getByText('Email inválido')).toBeVisible()
    await expect(page.getByText('A senha deve ter pelo menos 8 caracteres')).toBeVisible()
    expect(signupCalls).toBe(0)
  })
})

test.describe('Flow: recover password (validation)', () => {
  test('invalid email is blocked', async ({ page }) => {
    let calls = 0
    page.on('request', (req) => { if (req.url().includes('/api/auth/forgot-password')) calls++ })
    await page.goto('/forgot-password')
    await page.getByLabel('Email').fill('xxx')
    await page.getByRole('button', { name: 'Enviar link de recuperação' }).click()
    await expect(page.getByText('Email inválido')).toBeVisible()
    expect(calls).toBe(0)
  })
})

test.describe('Flow: API closed to guests', () => {
  // Rotas de dinheiro e de dados: sem sessão, sempre 401 (a matriz completa está em tests/fast/access/guard-matrix).
  const routes: Array<[string, string]> = [
    ['GET', '/api/service-orders'],
    ['POST', '/api/service-orders'],
    ['POST', '/api/financial/pay-entries-bulk'],
    ['GET', '/api/reports/overview'],
    ['GET', '/api/bank-accounts'],
    ['GET', '/api/admin/audit-logs']
  ]
  for (const [method, path] of routes) {
    test(`${method} ${path} → 401`, async ({ request }) => {
      const res = await request.fetch(path, { method, data: method === 'POST' ? {} : undefined })
      expect(res.status()).toBe(401)
    })
  }
})
