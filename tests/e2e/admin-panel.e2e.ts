// Fluxo: painel do dono da plataforma (/admin): menu agrupado, navegação entre as telas e menu do usuário.
// Precisa do Supabase local (ver support/env.ts); sem ele o spec é pulado.
import { expect, skipUnlessAuth, test } from './support/fixtures'

skipUnlessAuth(test)

const GROUPS: Record<string, string[]> = {
  'Visão geral': ['Dashboard', 'Métricas de uso'],
  'Clientes': ['Organizações', 'Usuários', 'Cobrança'],
  'Aquisição e retorno': ['Feedbacks', 'SEO e GEO'],
  'Plataforma': ['Auditoria', 'Sistema'],
  'Fiscal': ['Fiscal empresas', 'Fiscal logs']
}

const ROUTES: Array<[string, RegExp]> = [
  ['Dashboard', /\/admin$/],
  ['Métricas de uso', /\/admin\/metrics/],
  ['Organizações', /\/admin\/organizations/],
  ['Usuários', /\/admin\/users/],
  ['Cobrança', /\/admin\/billing/],
  ['Feedbacks', /\/admin\/feedbacks/],
  ['SEO e GEO', /\/admin\/geo/],
  ['Auditoria', /\/admin\/audit/],
  ['Sistema', /\/admin\/system/],
  ['Fiscal empresas', /\/admin\/fiscal\/companies/],
  ['Fiscal logs', /\/admin\/fiscal\/logs/]
]

test.describe('Fluxo: painel admin', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('platformOwner')
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin$/)
  })

  test('o menu mostra os 5 grupos, cada item no grupo certo', async ({ page }) => {
    for (const [group, items] of Object.entries(GROUPS)) {
      await expect(page.getByText(group, { exact: true }).first(), `grupo ${group}`).toBeVisible()
      for (const item of items) await expect(page.getByRole('link', { name: item }).first(), item).toBeVisible()
    }
    // a ordem dos grupos na página é a do menu
    const labels = await page.getByText(new RegExp(`^(${Object.keys(GROUPS).join('|')})$`)).allInnerTexts()
    expect(labels.slice(0, 5)).toEqual(Object.keys(GROUPS))
  })

  test('cada item do menu abre a sua tela, sem erro de JavaScript', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    for (const [label, url] of ROUTES) {
      await page.getByRole('link', { name: label }).first().click()
      await expect(page, label).toHaveURL(url)
    }
    expect(errors, errors.join('\n')).toEqual([])
  })

  test('menu do usuário: só tema, aparência e sair (nada da oficina)', async ({ page, world }) => {
    await page.getByRole('button', { name: world.users.platformOwner.displayName }).first().click()
    for (const name of ['Tema', 'Aparência', 'Sair']) await expect(page.getByRole('menuitem', { name }), name).toBeVisible()
    for (const name of ['Perfil', 'Empresa', 'Assinatura', 'Configurações', 'Documentação']) {
      await expect(page.getByRole('menuitem', { name }), `não deve ter ${name}`).toHaveCount(0)
    }
  })

  test('Ctrl+K abre a busca com os itens agrupados como no menu', async ({ page }) => {
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('combobox').fill('Auditoria')
    await expect(page.getByRole('dialog').getByText('Auditoria').first()).toBeVisible()
  })

  test('trocar para o tema escuro persiste ao navegar', async ({ page, world }) => {
    await page.getByRole('button', { name: world.users.platformOwner.displayName }).first().click()
    await page.getByRole('menuitem', { name: 'Aparência' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Escuro' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.getByRole('link', { name: 'Auditoria' }).first().click()
    await expect(page.locator('html')).toHaveClass(/dark/)
  })
})
