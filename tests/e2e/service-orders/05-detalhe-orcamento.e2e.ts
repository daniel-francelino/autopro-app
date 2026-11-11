// OS-E — Order detail, quote (preview, PDF, print) and isolation (docs/testing/e2e-service-orders.md §4).
import { expect, skipUnlessAuth, test, today } from './support/fixtures'
import { cardIcon, dateBR, detailLoaded, detailMoney, ignorePopups } from './support/helpers-os'
import { OrdersPage } from './support/pages'

skipUnlessAuth(test)
test.describe.configure({ timeout: 180_000 })

test.describe('OS-E: detail', () => {
  test('OS-E-01 detail cards match what was created (client, vehicle, dates, items, summary)', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'completed', client: c.clients.c1, vehicle: c.vehicles.v1, items: [{ p: c.products.S1 }, { p: c.products.P1, qty: 2 }], employees: [c.employees.ana] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const detail = await orders.openDetail(os.number)
    await detailLoaded(detail)

    await expect(detail.dialog.getByRole('heading', { level: 1 })).toHaveText(`#${os.number}`)
    // client
    await expect(detail.dialog.getByText(c.clients.c1.name)).toBeVisible()
    await expect(detail.dialog.getByText('(11) 98888-0001')).toBeVisible()
    // vehicle
    await expect(detail.dialog.getByText('Fiat Uno', { exact: true })).toBeVisible()
    await expect(detail.dialog.getByText(c.vehicles.v1.plate)).toBeVisible()
    await expect(detail.dialog.getByText('2018', { exact: true })).toBeVisible()
    // dates
    await expect(detail.dialog.getByText(dateBR(today()))).toBeVisible()
    // items: description, qty, sale, cost, commission, total
    const s1 = detail.dialog.getByRole('row', { name: new RegExp(c.products.S1.name) })
    const p1 = detail.dialog.getByRole('row', { name: new RegExp(c.products.P1.name) })
    await expect(s1.getByRole('cell')).toHaveText([`Serviços ${c.products.S1.name}`, '1', 'R$ 1.000,00', 'R$ 300,00', 'R$ 100,00', 'R$ 1.000,00'])
    await expect(p1.getByRole('cell')).toHaveText([`Peças ${c.products.P1.name}`, '2', 'R$ 200,00', 'R$ 240,00', 'R$ 40,00', 'R$ 400,00'])
    // financial summary
    expect(await detailMoney(detail, 'Valor previsto para o cliente')).toBe(1400)
    expect(await detailMoney(detail, 'Subtotal')).toBe(1400)
    expect(await detailMoney(detail, 'Custo')).toBe(540)
    expect(await detailMoney(detail, 'Impostos')).toBe(0)
    await expect(detail.dialog.getByRole('textbox', { name: 'Desconto' })).toHaveValue('R$ 0,00')
  })

  test('OS-E-02 commission in the detail: per item, per responsible and total (Ana + Bruno + Carla)', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'completed', items: [{ p: c.products.S1 }, { p: c.products.P1, qty: 2 }], employees: [c.employees.ana, c.employees.bruno, c.employees.carla] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const detail = await orders.openDetail(os.number)
    await detailLoaded(detail)

    // per item (sum of the three): S1 = 100 + 210 + 0 · P1 = 40 + 20 + 40
    const s1 = detail.dialog.getByRole('row', { name: new RegExp(c.products.S1.name) })
    const p1 = detail.dialog.getByRole('row', { name: new RegExp(c.products.P1.name) })
    await expect(s1.getByRole('cell').nth(4)).toHaveText('R$ 310,00')
    await expect(p1.getByRole('cell').nth(4)).toHaveText('R$ 100,00')
    // per responsible (Responsáveis card)
    for (const amount of ['R$ 140,00', 'R$ 230,00', 'R$ 40,00']) await expect(detail.dialog.getByText(`Comissão: ${amount}`)).toBeVisible()
    // total in the summary (computed in the browser once the employees' rules load)
    await expect.poll(() => detailMoney(detail, 'Comissão'), { timeout: 20_000 }).toBe(410)
    expect(Number((await shop.order(os.id)).commission_amount)).toBe(410)
  })

  test('OS-E-03 financial summary: the commission shows up after loading (does not stay at R$ 0,00) and the margin deducts it', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const account = await shop.newAccount(1000)
    const os = await shop.createOrder({ status: 'completed', items: [{ p: c.products.S1 }, { p: c.products.P1, qty: 2 }], employees: [c.employees.ana, c.employees.bruno] })
    // partial receipt: 400 paid out of 1,400
    const res = await shop.api.post(`/api/service-orders/${os.id}/process-payment`, { paymentMethod: 'pix', bankAccountId: account.id, installments: [{ amount: 400, status: 'paid' }, { amount: 1000 }] })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const detail = await orders.openDetail(os.number)
    await detailLoaded(detail)
    await expect.poll(() => detailMoney(detail, 'Comissão'), { timeout: 20_000 }).toBe(370) // Ana 140 + Bruno 230
    expect(await detailMoney(detail, 'Valor previsto para o cliente')).toBe(1400)
    expect(await detailMoney(detail, 'Custo')).toBe(540)
    await expect(detail.dialog.getByRole('textbox', { name: 'Margem estimada' })).toHaveValue('R$ 490,00') // 1,400 − 540 − 370
    // installments: one paid (400) and one pending (1,000)
    await expect(detail.dialog.getByText('R$ 400,00').first()).toBeVisible()
    await expect(detail.dialog.getByText('R$ 1.000,00').first()).toBeVisible()
    const commissions = await shop.commissions(os.id)
    // characterization: the released commission is proportional to what was received (400/1,400 of the entitlement)
    console.log(`OBS OS-E-03 commission records: ${commissions.map(r => `${Number(r.amount)}/${r.status}`).join(', ')}`)
  })

  test('OS-E-04 opening from the card and closing keeps the filter, the URL and the list position', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'open', items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open('?status=open')
    await orders.expectCard(os.number)
    const detail = await orders.openDetail(os.number)
    await expect(detail.dialog.getByRole('heading', { level: 1 })).toHaveText(`#${os.number}`)
    await detail.close()
    await expect(detail.dialog).toBeHidden()
    expect(page.url()).toContain('status=open')
    await orders.expectCard(os.number)
    // the detail also opens from the card's "Ver detalhes" icon
    await cardIcon(orders, os.number, 'eye').click()
    await expect(detail.dialog.getByRole('heading', { level: 1 })).toHaveText(`#${os.number}`)
  })

  test('OS-E-05 an order from another workshop neither shows in the list nor opens through the API (404)', async ({ page, loginAs, apiAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'open', items: [{ p: c.products.S2 }] })
    const other = await apiAs('otherOrg')
    const direct = await other.get(`/api/service-orders/${os.id}`)
    expect([403, 404], JSON.stringify(direct.body)).toContain(direct.status)
    expect(JSON.stringify(direct.body)).not.toContain(c.clients.c1.name)

    await loginAs('otherOrg')
    const orders = new OrdersPage(page)
    await orders.open(`?search=${os.number}`)
    await expect(page.getByText(/Todos os \d+ registro|Nenhuma ordem|Nenhum/).first()).toBeVisible({ timeout: 30_000 })
    await expect(orders.numberLabel(os.number)).toHaveCount(0)
    expect(await shop.order(os.id)).toBeTruthy() // still workshop A's, untouched
  })
})

test.describe('OS-E: quote', () => {
  async function openQuote(orders: OrdersPage, number: string) {
    const quote = orders.page.getByRole('dialog', { name: /Orçamento/ })
    await expect(async () => {
      await cardIcon(orders, number, 'file-text').click()
      await expect(quote).toBeVisible({ timeout: 4000 })
    }).toPass({ timeout: 90_000, intervals: [500, 1000, 2000] })
    return quote
  }

  test('OS-E-06 quote: preview with workshop, client, vehicle, items and total correct', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'estimate', client: c.clients.c1, vehicle: c.vehicles.v1, items: [{ p: c.products.S1 }, { p: c.products.P1, qty: 2 }], discount: 140 })
    const { data: org } = await shop.world.db.from('organizations').select('name').eq('id', shop.world.orgA).single()
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const quote = await openQuote(orders, os.number)
    console.log('OBS OS-E-06 snapshot:\n' + await quote.ariaSnapshot())
    await expect(quote.getByText(os.number).first()).toBeVisible({ timeout: 20_000 })
    await expect(quote.getByText(c.clients.c1.name).first()).toBeVisible()
    await expect(quote.getByText(c.vehicles.v1.plate).first()).toBeVisible()
    await expect(quote.getByText(c.products.S1.name).first()).toBeVisible()
    await expect(quote.getByText(c.products.P1.name).first()).toBeVisible()
    await expect(quote.getByText('1.260,00').first()).toBeVisible()
    await expect(quote.getByText(org!.name).first()).toBeVisible()
  })

  test('OS-E-07 quote: "Baixar PDF" downloads a file and "Imprimir" triggers printing', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    ignorePopups(page)
    const os = await shop.createOrder({ status: 'estimate', items: [{ p: c.products.S1 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const quote = await openQuote(orders, os.number)
    await page.evaluate(() => { (window as any).__prints = 0; window.print = () => { (window as any).__prints++ } })
    const download = page.waitForEvent('download', { timeout: 30_000 })
    await quote.getByRole('button', { name: 'Baixar PDF' }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.pdf$/i)
    await quote.getByRole('button', { name: 'Imprimir' }).click()
    await expect.poll(() => page.evaluate(() => (window as any).__prints), { timeout: 10_000 }).toBeGreaterThan(0)
  })

  test('OS-E-08 quote with discount: shows the discount and does NOT show cost nor commission (internal data)', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'estimate', items: [{ p: c.products.S1 }, { p: c.products.P1, qty: 2 }], employees: [c.employees.ana, c.employees.bruno], discount: 140 })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const quote = await openQuote(orders, os.number)
    await expect(quote.getByText('1.260,00').first()).toBeVisible({ timeout: 20_000 })
    await expect(quote.getByText('140,00').first()).toBeVisible() // discount
    const text = (await quote.innerText()).toLowerCase()
    expect(text).not.toContain('comissão')
    expect(text).not.toContain('custo')
    expect(text).not.toContain('margem')
    for (const internal of ['540,00', '370,00', '300,00', '240,00']) expect(text, `internal value ${internal}`).not.toContain(internal)
  })

  test('OS-E-09 quote for a counter-sale order (no client or vehicle) is generated without breaking', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'estimate', client: null, vehicle: null, items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await orders.open()
    const quote = await openQuote(orders, os.number)
    await expect(quote.getByText(c.products.S2.name).first()).toBeVisible({ timeout: 20_000 })
    await expect(quote.getByText('150,00').first()).toBeVisible()
    expect(errors, errors.join('\n')).toEqual([])
  })
})
