import { expect, test } from '@playwright/test'

// E1 (parte visitante) e E11 — não precisam de usuário logado nem de banco.

test.describe('E1: guest is blocked from protected areas', () => {
  for (const path of ['/app', '/admin', '/onboarding', '/subscription']) {
    test(`${path} → /login`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login/)
    })
  }

  test('authentication pages open for guests', async ({ page }) => {
    for (const path of ['/login', '/signup', '/forgot-password']) {
      const response = await page.goto(path)
      expect(response?.status(), path).toBe(200)
    }
  })
})

test.describe('E11: public pages', () => {
  for (const path of ['/', '/pricing', '/perguntas-frequentes']) {
    test(`${path} responds 200 with <title> and canonical`, async ({ page }) => {
      const response = await page.goto(path)
      expect(response?.status()).toBe(200)
      await expect(page).toHaveTitle(/.+/)
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
      expect(canonical, `canonical em ${path}`).toBeTruthy()
    })
  }

  test('robots.txt and sitemap.xml exist', async ({ request }) => {
    expect((await request.get('/robots.txt')).status()).toBe(200)
    expect((await request.get('/sitemap.xml')).status()).toBe(200)
  })
})

test.describe('E10: mobile @mobile', () => {
  test('home has no horizontal scroll at 390 px', async ({ page }) => {
    await page.goto('/')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
