// OS-L (volume) + OS-A-12/A-13 (infinite scroll and filtered total) against the demo seed (`pnpm seed:demo`: 1,265 anonymized orders).
// Read-only: nothing here writes to the demo workshop. Skipped with a clear reason when the seed is not loaded.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2E } from '../support/env'
import { authSkipReason } from '../support/env'
import { loginViaApi, type TestUser } from '../support/fixtures'
import { cardNumbers, expect, ListFilters, test } from './support/helpers-lista'
import { OrdersPage, parseBRL } from './support/pages'

const DEMO_LOGIN = { email: 'admin@demo.autopro.test', password: 'Demo@12345' }
const META = join(process.cwd(), 'supabase', 'seeders', 'demo', 'demo.meta.json')

test.skip(authSkipReason() !== null, authSkipReason() ?? '')
test.describe.configure({ timeout: 600_000 })

let db: SupabaseClient
let orgId = ''
let skipReason: string | null = null

test.beforeAll(async () => {
  if (authSkipReason() !== null) return
  if (!existsSync(META)) { skipReason = 'demo seed metadata not found (supabase/seeders/demo/demo.meta.json); run `pnpm seed:demo`'; return }
  orgId = JSON.parse(readFileSync(META, 'utf8')).organizationId
  db = createClient(E2E.url, E2E.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { count } = await db.from('service_orders').select('id', { count: 'exact', head: true }).eq('organization_id', orgId)
  if (!count) skipReason = 'the demo seed is not loaded in this stack (no orders in the demo workshop); run `pnpm seed:demo`'
})
test.beforeEach(() => { test.skip(skipReason !== null, skipReason ?? '') })

const loginDemo = async (page: any) => {
  await loginViaApi(page.request, { kind: 'admin', id: '', ...DEMO_LOGIN, displayName: 'demo', organizationId: orgId } as TestUser)
}
const activeOrders = () => db.from('service_orders').select('id, number, status, client_id', { count: 'exact' }).eq('organization_id', orgId).is('deleted_at', null).limit(5000)

/** Scrolls the infinite list until the end message shows up (or no progress is made). Returns the total shown in that message. */
async function scrollToEnd(page: any): Promise<number> {
  const done = page.getByText(/Todos os \d+ registro\(s\) foram carregados/)
  let stalled = 0
  let last = -1
  for (let i = 0; i < 200; i++) {
    if (await done.isVisible().catch(() => false)) break
    const cards = page.locator('p').filter({ hasText: /^\s*#OS\d+\s*$/ })
    const count = await cards.count()
    if (count === last) stalled++; else stalled = 0
    if (stalled >= 8) break
    last = count
    await cards.last().scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(400)
  }
  await expect(done).toBeVisible({ timeout: 20_000 })
  return Number((await done.textContent())!.match(/Todos os (\d+)/)![1])
}

test.describe('OS-L: volume with the demo seed', () => {
  test('OS-L-01 the list opens with 1,265 orders in acceptable time and without errors', async ({ page }) => {
    await loginDemo(page)
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    const orders = new OrdersPage(page)
    const started = Date.now()
    await orders.open()
    await expect.poll(async () => (await cardNumbers(page)).length, { timeout: 60_000 }).toBeGreaterThan(0)
    const elapsed = Date.now() - started
    test.info().annotations.push({ type: 'first page (ms)', description: String(elapsed) })
    expect(elapsed, 'time limit still to be defined: dev server is slower than production').toBeLessThan(60_000)
    expect((await cardNumbers(page)).length).toBe(20) // first page: 20 cards
    expect(errors).toEqual([])
  })

  test('OS-A-12 infinite scroll loads 20 at a time without repeating or skipping a card, up to the total of active orders', async ({ page }) => {
    await loginDemo(page)
    const orders = new OrdersPage(page)
    await orders.open()
    await expect.poll(async () => (await cardNumbers(page)).length, { timeout: 60_000 }).toBe(20)
    const total = await scrollToEnd(page)
    const numbers = await cardNumbers(page)
    expect(new Set(numbers).size, 'repeated cards').toBe(numbers.length)
    expect(numbers.length, 'cards shown × total in the end message').toBe(total)
    const { count } = await activeOrders()
    expect(total, 'total shown × active orders in the database').toBe(count)
  })

  test('OS-A-13 filtered total equals the number of cards reached at the end of the scroll', async ({ page }) => {
    await loginDemo(page)
    const orders = new OrdersPage(page)
    await orders.open()
    await expect.poll(async () => (await cardNumbers(page)).length, { timeout: 60_000 }).toBeGreaterThan(0)
    await new ListFilters(page).chooseStatus('Concluída')
    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('completed')
    const total = await scrollToEnd(page)
    const numbers = await cardNumbers(page)
    expect(numbers.length).toBe(total)
    const { count } = await db.from('service_orders').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('deleted_at', null).eq('status', 'completed')
    expect(total).toBe(count)
  })

  test('OS-L-02 search and filters on the big base return the right order, fast', async ({ page }) => {
    const { data } = await db.from('service_orders').select('number, client_id').eq('organization_id', orgId).is('deleted_at', null).not('client_id', 'is', null).limit(1).single()
    const { data: client } = await db.from('clients').select('name').eq('id', data!.client_id).single()
    await loginDemo(page)
    const orders = new OrdersPage(page)
    await orders.open()
    await orders.expectCard((await cardNumbers(page))[0]!)
    // by number
    await orders.search().fill(data!.number)
    await expect.poll(async () => (await cardNumbers(page)).includes(data!.number), { timeout: 20_000 }).toBe(true)
    for (const n of await cardNumbers(page)) expect(n.toLowerCase()).toContain(data!.number.toLowerCase())
    // by client name: every card shown belongs to a client whose name contains the term (checked against the database)
    await orders.search().fill(client!.name)
    await expect.poll(async () => (await cardNumbers(page)).includes(data!.number), { timeout: 20_000 }).toBe(true)
    const shown = await cardNumbers(page)
    const { data: rows } = await db.from('service_orders').select('number, clients(name)').eq('organization_id', orgId).in('number', shown)
    for (const r of rows ?? []) expect(String((r as any).clients?.name).toLowerCase()).toContain(client!.name.toLowerCase())
  })

  test('OS-L-03 old, messy orders open without broken screens, NaN or empty items (20 orders across statuses)', async ({ page }) => {
    const { data } = await activeOrders()
    const byStatus = new Map<string, string[]>()
    for (const o of data ?? []) byStatus.set(o.status, [...(byStatus.get(o.status) ?? []), o.number])
    const picks: string[] = []
    for (const [, nums] of byStatus) picks.push(...nums.slice(0, Math.ceil(20 / byStatus.size)))
    const sample = picks.slice(0, 20)
    expect(sample.length).toBeGreaterThan(5)

    await loginDemo(page)
    const orders = new OrdersPage(page)
    const problems: string[] = []
    page.on('pageerror', e => problems.push(`js error: ${e.message}`))
    for (const number of sample) {
      await orders.open(`?search=${encodeURIComponent(number)}`)
      await orders.expectCard(number)
      const detail = await orders.openDetail(number)
      const text = (await detail.dialog.innerText()).replace(/\s+/g, ' ')
      for (const bad of ['NaN', 'undefined', 'null', 'Invalid Date', '[object Object]']) {
        if (text.includes(bad)) problems.push(`${number}: shows "${bad}"`)
      }
      await expect(detail.dialog.getByRole('heading', { name: new RegExp(number) })).toBeVisible()
      await detail.close()
    }
    expect(problems).toEqual([])
  })

  test('OS-L-04 reports with volume load, and the dashboard revenue equals the overview revenue', async ({ page }) => {
    await loginDemo(page)
    await page.goto('/app')
    const card = page.getByText('Faturamento do Mês').locator('xpath=preceding::p[1]')
    await expect(card).toBeVisible({ timeout: 90_000 })
    const dashboardRevenue = parseBRL(await card.textContent())

    await page.goto('/app/reports')
    const kpi = page.getByText('Receita bruta', { exact: true }).locator('xpath=following::*[contains(text(),"R$")][1]')
    await expect(kpi).toBeVisible({ timeout: 90_000 })
    const overviewRevenue = parseBRL(await kpi.textContent())
    // caracterization: both screens default to the current month
    expect(overviewRevenue).toBe(dashboardRevenue)

    for (const path of ['/app/reports/commissions', '/app/reports/debtors', '/app/reports/profit']) {
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 90_000 })
      expect(errors, path).toEqual([])
    }
  })

  test.skip('OS-L-05 export large CSV: there is no export screen for orders (the route exists but nothing in the UI uses it)', () => {})
})
