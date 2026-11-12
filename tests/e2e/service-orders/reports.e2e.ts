// OS-J — The order reflected in the other modules (docs/testing/e2e-service-orders.md §4).
// Setup (create/pay the order) goes through the API; the thing under test is what each SCREEN shows.
// Expected numbers come from the database (independent of the report APIs), not from the report endpoints.
import { skipUnlessAuth, buildOrderData } from './support/order-fixtures'
import { expect, freshClient, freshVehicle, test } from './support/helpers-list'
import { OrdersPage, parseBRL } from './support/pages'

skipUnlessAuth(test)
test.describe.configure({ timeout: 180_000 })

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00A0/g, ' ')
const today = () => new Date().toISOString().slice(0, 10)
const monthBounds = () => {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0')}` }
}

/** OS-REF1 from the catalog (S1 + 2 × P1 = 1,400) with a R$ 140 discount (total 1,260), Ana + Bruno + Carla. */
async function refOrder(shop: any, client: any, status = 'completed') {
  const c = shop.catalog
  return shop.createOrder({
    client, vehicle: null, status, discount: 140,
    items: [{ p: c.products.S1 }, { p: c.products.P1, qty: 2 }],
    employees: [c.employees.ana, c.employees.bruno, c.employees.carla]
  })
}
async function payInFull(shop: any, order: { id: string, total: number }, accountId: string) {
  const res = await shop.api.post(`/api/service-orders/${order.id}/process-payment`, {
    paymentMethod: 'pix', bankAccountId: accountId, installments: [{ amount: order.total, status: 'paid' }]
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

test.describe('OS-J: the order in the other modules', () => {
  test('OS-J-01 dashboard and overview show the same monthly revenue, equal to the completed orders in the database', async ({ page, loginAs, shop }) => {
    const client = await freshClient(shop)
    const account = await shop.newAccount(1000)
    const order = await refOrder(shop, client)
    const { from, to } = monthBounds()
    const sumRevenue = async () => {
      const { data } = await shop.world.db.from('service_orders').select('total_amount')
        .eq('organization_id', shop.world.orgA).is('deleted_at', null).in('status', ['completed', 'invoiced', 'delivered']).gte('entry_date', from).lte('entry_date', to)
      return Number((data ?? []).reduce((s, r) => s + Number(r.total_amount), 0).toFixed(2))
    }
    const readScreens = async () => {
      await page.goto('/app')
      const dash = page.getByText('Faturamento do Mês').locator('xpath=preceding::p[1]')
      await expect(dash).toBeVisible({ timeout: 90_000 })
      const dashboard = parseBRL(await dash.textContent({ timeout: 10_000 }))
      await page.goto('/app/reports')
      const kpi = page.getByText('Receita bruta', { exact: true }).locator('xpath=preceding::p[1]')
      await expect(kpi).toBeVisible({ timeout: 90_000 })
      const overview = parseBRL(await kpi.textContent({ timeout: 10_000 }))
      return { dashboard, overview }
    }

    await loginAs('admin')
    let screens = await readScreens()
    const expected = await sumRevenue()
    expect(expected).toBeGreaterThanOrEqual(order.total)
    expect(screens.dashboard, 'dashboard × database').toBe(expected)
    expect(screens.overview, 'overview × database').toBe(expected)

    // caracterization: revenue is by competence (completed orders), so receiving the payment does not change it
    await payInFull(shop, order, account.id)
    screens = await readScreens()
    expect(screens.dashboard).toBe(expected)
    expect(screens.overview).toBe(expected)
  })

  test('OS-J-02 debtors: the unpaid completed order shows the amount owed and leaves the report once paid', async ({ page, loginAs, shop }) => {
    const client = await freshClient(shop)
    const account = await shop.newAccount(1000)
    const order = await refOrder(shop, client)
    await loginAs('admin')
    await page.goto('/app/reports/debtors')
    const search = page.getByPlaceholder('Buscar por nome, telefone ou e-mail...')
    await expect(search).toBeVisible({ timeout: 90_000 })
    await search.fill(client.name)
    const row = page.getByRole('row').filter({ hasText: client.name })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText(brl(1260))

    await payInFull(shop, order, account.id)
    await page.reload()
    await page.getByPlaceholder('Buscar por nome, telefone ou e-mail...').fill(client.name)
    await expect(page.getByText('Nenhum devedor encontrado')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('row').filter({ hasText: client.name })).toHaveCount(0)
  })

  test('OS-J-02b KF-34 debtors: an order with a paid down payment is listed only by what is still owed', async ({ page, loginAs, shop }) => {
    test.fail(true, 'KF-34: the order without a payment plan is listed by its full total, without discounting the down payment')
    const client = await freshClient(shop)
    const account = await shop.newAccount(1000)
    const order = await refOrder(shop, client, 'open')
    const down = await shop.api.post(`/api/service-orders/${order.id}/down-payment`, { amount: 300, paymentMethod: 'pix', bankAccountId: account.id })
    expect(down.status, JSON.stringify(down.body)).toBe(200)
    const done = await shop.api.post('/api/service-orders', { orderId: order.id, orderData: { status: 'completed' } })
    expect(done.status, JSON.stringify(done.body)).toBe(200)
    await loginAs('admin')
    await page.goto('/app/reports/debtors')
    await page.getByPlaceholder('Buscar por nome, telefone ou e-mail...').fill(client.name)
    const row = page.getByRole('row').filter({ hasText: client.name })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText(brl(960)) // 1,260 − 300
  })

  test('OS-J-03 profit by order: revenue, cost and profit of the order match total − cost − commission', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const client = await freshClient(shop)
    // very high price so the order is among the most profitable of the period (the screen lists the top ones)
    const order = await shop.createOrder({ client, vehicle: null, status: 'completed', items: [{ p: c.products.S1, price: 900000 }], employees: [c.employees.ana, c.employees.bruno] })
    const row = await shop.order(order.id)
    const profit = Number((Number(row.total_amount) - Number(row.total_cost_amount) - Number(row.commission_amount)).toFixed(2))
    expect(Number(row.commission_amount)).toBe(90000 + 269910) // Ana 10 % of revenue + Bruno 30 % of profit
    await loginAs('admin')
    await page.goto('/app/reports/profit?mode=by_order')
    const label = page.locator('p').filter({ hasText: new RegExp(order.number) }).first()
    await expect(label).toBeVisible({ timeout: 90_000 })
    const card = label.locator('xpath=ancestor::div[.//*[text()="Lucro"]][1]')
    await expect(card).toContainText(brl(profit))
    await expect(card).toContainText(brl(Number(row.total_cost_amount)))
  })

  test('OS-J-04 cash flow: the revenue of the cash-flow report equals the paid income in the database', async ({ page, loginAs, shop }) => {
    const client = await freshClient(shop)
    const account = await shop.newAccount(1000)
    const order = await refOrder(shop, client)
    await payInFull(shop, order, account.id)
    const { from, to } = monthBounds()
    const { data } = await shop.world.db.from('financial_transactions').select('amount')
      .eq('organization_id', shop.world.orgA).eq('type', 'income').eq('status', 'paid').is('deleted_at', null).gte('due_date', from).lte('due_date', to)
    const expected = Number((data ?? []).reduce((s, r) => s + Number(r.amount), 0).toFixed(2))
    expect(expected).toBeGreaterThanOrEqual(1260)
    await loginAs('admin')
    await page.goto(`/app/reports/profit?mode=cash_flow&from=${from}&to=${to}&status=paid`)
    const stat = page.getByText('Faturamento', { exact: true }).first().locator('xpath=preceding::p[1]')
    await expect(stat).toBeVisible({ timeout: 90_000 })
    expect(parseBRL(await stat.textContent({ timeout: 10_000 }))).toBe(expected)
  })

  test('OS-J-05 accounts: the balance on screen grows by the received amount and the statement in the database has the movement', async ({ page, loginAs, shop }) => {
    const client = await freshClient(shop)
    const account = await shop.newAccount(1000)
    const order = await refOrder(shop, client)
    await payInFull(shop, order, account.id)
    await loginAs('admin')
    await page.goto('/app/financial/accounts')
    const search = page.getByPlaceholder('Buscar por nome ou banco...')
    await expect(search).toBeVisible({ timeout: 90_000 })
    await search.fill(account.name)
    const row = page.getByRole('row').filter({ hasText: account.name })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText(brl(2260)) // 1,000 + 1,260
    const statements = await shop.statements(account.id)
    expect(statements).toHaveLength(1)
    expect([statements[0]!.transaction_type, statements[0]!.amount]).toEqual(['income', 1260])
    await shop.expectCashConsistent(account.id, 1000)
  })

  test('OS-J-06 financial entries: the income linked to the order shows up with its amount', async ({ page, loginAs, shop }) => {
    const client = await freshClient(shop)
    const account = await shop.newAccount(1000)
    const order = await refOrder(shop, client)
    await payInFull(shop, order, account.id)
    const { data } = await shop.world.db.from('financial_transactions').select('description, amount, status, type').eq('service_order_id', order.id).is('deleted_at', null)
    expect(data).toHaveLength(1)
    const tx = data![0]!
    expect([tx.type, tx.status, Number(tx.amount)]).toEqual(['income', 'paid', 1260])
    await loginAs('admin')
    await page.goto('/app/financial')
    const search = page.getByPlaceholder('Buscar por descrição...')
    await expect(search).toBeVisible({ timeout: 90_000 })
    await search.fill(String(tx.description))
    const row = page.getByRole('row').filter({ hasText: String(tx.description) }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText(brl(1260))
  })

  test('OS-J-07 sales by item: the row shows client, order, item, cost, commission and value of the order', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const client = await freshClient(shop)
    const tag = Date.now().toString(36)
    const itemName = `Item J07 ${tag}`
    const created = await shop.api.post('/api/products', { name: itemName, code: 800000 + Math.floor(Math.random() * 90000), type: 'unit', category_id: c.categories.servicos, unit_sale_price: 500, unit_cost_price: 100, track_inventory: false })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const product = { id: created.body.item.id, name: itemName, categoryId: c.categories.servicos, categoryName: 'Serviços', sale: 500, cost: 100 }
    const order = await shop.createOrder({ client, vehicle: null, status: 'completed', items: [{ p: product, qty: 3 }], employees: [c.employees.ana, c.employees.bruno] })
    // 3 × 500 = 1,500; cost 300; commission: Ana 10 % × 1,500 = 150 + Bruno 30 % × (1,500 − 300) = 360 = 510
    expect(Number((await shop.order(order.id)).commission_amount)).toBe(510)
    await loginAs('admin')
    await page.goto('/app/reports/sales-items?view=item')
    const search = page.getByPlaceholder('Buscar item, OS, cliente, responsável ou categoria...')
    await expect(search).toBeVisible({ timeout: 90_000 })
    await search.fill(order.number)
    const row = page.getByRole('row').filter({ hasText: itemName })
    await expect(row).toBeVisible({ timeout: 30_000 })
    for (const text of [client.name, order.number, brl(300), brl(510), brl(1500)]) await expect(row).toContainText(text)
  })

  test('OS-J-08 client history lists the order, and the list filter by vehicle finds only that order', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const client = await freshClient(shop)
    const vehicle = await freshVehicle(shop, client)
    const other = await shop.createOrder({ client, vehicle: null, status: 'completed', items: [{ p: c.products.S2 }] })
    const order = await shop.createOrder({ client, vehicle, status: 'completed', items: [{ p: c.products.S1 }] })
    await loginAs('admin')
    await page.goto('/app/customers')
    const search = page.getByPlaceholder('Buscar por nome, e-mail ou CPF/CNPJ...')
    await expect(search).toBeVisible({ timeout: 90_000 })
    await search.fill(client.name)
    const row = page.getByRole('row').filter({ hasText: client.name })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.locator('button:has([class~="i-lucide:dollar-sign"])').click()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Histórico Financeiro' })
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await expect(dialog).toContainText(`OS #${order.number}`)
    await expect(dialog).toContainText(`OS #${other.number}`)
    await expect(dialog).toContainText(brl(1000))

    // the order list filtered by the vehicle brings only that order
    const orders = new OrdersPage(page)
    await orders.open(`?clientId=${client.id}&vehicleId=${vehicle.id}`)
    await orders.expectCard(order.number)
    await expect(orders.numberLabel(other.number)).toHaveCount(0)
  })

  test('OS-J-09 an order created with an appointment shows up on the calendar on the day, and the two are linked', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const client = await freshClient(shop)
    const vehicle = await freshVehicle(shop, client)
    const serviceType = `Agenda J09 ${Date.now().toString(36)}`
    const orderData = buildOrderData(c, { client, vehicle, status: 'open', items: [{ p: c.products.S2 }] })
    const res = await shop.api.post('/api/service-orders', {
      orderData, appointmentData: { appointment_date: today(), time: '09:30', service_type: serviceType, priority: 'high' }
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const row = await shop.order(res.body.order.id)
    expect(row.appointment_id, 'order linked to the appointment').toBeTruthy()
    const { data: appointment } = await shop.world.db.from('appointments').select('*').eq('id', row.appointment_id).single()
    expect([appointment?.service_type, appointment?.client_id, appointment?.appointment_date]).toEqual([serviceType, client.id, today()])

    await loginAs('admin')
    await page.goto('/app/appointments')
    const pill = page.getByText(serviceType).first()
    await expect(pill).toBeVisible({ timeout: 90_000 })
    await pill.click()
    // caracterization: opening the event shows its data (the exact link to the order depends on the form)
    await expect(page.getByRole('dialog').filter({ hasText: serviceType })).toBeVisible({ timeout: 30_000 })
  })

  test.skip('OS-J-10 issue NFS-e from the order: needs the Focus NFe API mocked on the server side and a workshop on the fiscal plan, neither available in this stack', () => {})
})
