// Fluxo: sessão. Entrar pelo formulário, usar a área protegida, sair e provar que a sessão acabou.
// Precisa do Supabase local (ver support/env.ts); sem ele o spec é pulado.
import { expect, skipUnlessAuth, test } from './support/fixtures'

skipUnlessAuth(test)

test.describe('Flow: sign in → use → sign out', () => {
  test('workshop admin signs in via the form and lands on the dashboard', async ({ page, world }) => {
    const user = world.users.admin
    await page.goto('/login')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Senha').fill(user.password)
    await page.getByLabel('Senha').press('Enter')
    await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible()
  })

  test('wrong password for an existing user is refused and creates no session', async ({ page, context, world }) => {
    const user = world.users.admin
    await page.goto('/login')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Senha').fill('SenhaErrada123')
    await page.getByLabel('Senha').press('Enter')
    await expect(page).toHaveURL(/\/login/)
    expect((await context.cookies()).some(c => c.name === 'sb-access-token')).toBe(false)
  })

  test('signing out ends the session: the protected area asks for login again', async ({ page, loginAs }) => {
    const user = await loginAs('admin')
    await page.goto('/app')
    await expect(page).toHaveURL(/\/app(\/|$)/)

    await page.getByRole('button', { name: user.displayName }).first().click()
    await page.getByRole('menuitem', { name: 'Sair' }).click()
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })

    await page.goto('/app')
    await expect(page).toHaveURL(/\/login/)
    const me = await page.request.get('/api/service-orders')
    expect(me.status()).toBe(401)
  })

  test('with an active session, /login redirects to the user area', async ({ page, loginAs }) => {
    await loginAs('admin')
    await page.goto('/login')
    await expect(page).toHaveURL(/\/app(\/|$)/)
  })
})
