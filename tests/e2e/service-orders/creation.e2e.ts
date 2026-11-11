// OS-B — Create an order through the UI (docs/testing/e2e-service-orders.md §4).
// The action happens in the interface; verification looks at the screen and the database. Setup data comes from the fixed catalog (support/catalog.ts).
import { expect, skipUnlessAuth, test } from './support/order-fixtures'
import { addGroupProduct, countAllOrders, countOrders, expectToast, num } from './support/helpers-order'
import { OrdersPage } from './support/pages'

skipUnlessAuth(test)
test.describe.configure({ timeout: 180_000 })

test.describe('OS-B: create order', () => {
  test('OS-B-01 creates the full order (client, vehicle, items and responsible) and stores total, items and commission', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()

    const form = await orders.newOrder()
    await form.setClient(c.clients.c1)
    await form.setVehicle(c.vehicles.v1)
    await form.addProduct(c.products.S1)
    await form.addProduct(c.products.P1, 2)
    await form.addResponsible(c.employees.ana)

    // preview on screen before saving
    expect(await form.summary('Subtotal')).toBe(1400)
    expect(await form.summary('Custo')).toBe(540)
    await expect.poll(() => form.summary('Comissão'), { timeout: 20_000 }).toBe(140)
    await expect.poll(() => form.margin(), { timeout: 20_000 }).toBe(720) // 1,400 − 540 − 140

    const number = await form.number().inputValue()
    await form.submit()
    await expectToast(page, 'OS criada com sucesso')

    // list
    await orders.expectCard(number.replace(/^#/, ''))

    // database
    const row = await shop.orderByNumber(number)
    expect(row.client_id).toBe(c.clients.c1.id)
    expect(row.vehicle_id).toBe(c.vehicles.v1.id)
    expect(Number(row.total_amount)).toBe(1400)
    expect(Number(row.total_cost_amount)).toBe(540)
    expect(Number(row.commission_amount)).toBe(140)
    expect(row.payment_status).toBe('pending')
    expect(row.status).toBe('estimate')
    expect(row.entry_date).toBe(new Date().toISOString().slice(0, 10))
    expect(row.items).toHaveLength(2)
    const [s1, p1] = row.items
    expect([s1.product_id, Number(s1.quantity), Number(s1.total_price), s1.category_id]).toEqual([c.products.S1.id, 1, 1000, c.categories.servicos])
    expect([p1.product_id, Number(p1.quantity), Number(p1.total_price), p1.category_id]).toEqual([c.products.P1.id, 2, 400, c.categories.pecas])
    expect(row.responsible_employees).toEqual([{ employee_id: c.employees.ana.id }])
    expect(row.items.map((i: any) => Number(i.commission_total))).toEqual([100, 40])
  })

  test('OS-B-02 automatic numbering: each order created in the UI gets the next number', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const numbers: string[] = []
    for (let i = 0; i < 3; i++) {
      const form = await orders.newOrder()
      await expect(form.number()).toHaveValue(/^OS\d+$/) // the field already comes with the next number
      await form.addProduct(c.products.S2)
      numbers.push(await form.number().inputValue())
      await form.submit()
      await expectToast(page, 'OS criada com sucesso')
      await expect(form.dialog).toBeHidden()
      await orders.expectCard(numbers[i]!)
    }
    expect(num(numbers[1]!)).toBe(num(numbers[0]!) + 1)
    expect(num(numbers[2]!)).toBe(num(numbers[1]!) + 1)
    for (const n of numbers) expect(await countOrders(shop, 'number', n)).toBe(1)
  })

  test('OS-B-03 duplicate number warns, suggests another one and only saves on the second attempt', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const existing = await shop.createOrder({ items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()
    await form.addProduct(c.products.S2)
    await form.number().fill(existing.number)
    await form.submit()
    await expectToast(page, 'Número já existe')
    await expect(form.dialog).toBeVisible() // it did not close
    const suggested = await form.number().inputValue()
    expect(suggested).not.toBe(existing.number)
    expect(await countOrders(shop, 'number', existing.number)).toBe(1) // nothing saved on the first attempt
    await form.submit()
    await expectToast(page, 'OS criada com sucesso')
    expect(await countOrders(shop, 'number', suggested)).toBe(1)
    expect(await countOrders(shop, 'number', existing.number)).toBe(1)
  })

  test('OS-B-04 the vehicle depends on the client: only the client\'s vehicles show and changing client clears the vehicle', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()

    await form.setClient(c.clients.c1)
    await form.dialog.getByText('Veículo', { exact: true }).locator('xpath=following::button[1]').click()
    await expect(page.getByRole('button', { name: new RegExp(c.vehicles.v1.plate) })).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(c.vehicles.v2.plate) })).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(c.vehicles.v3.plate) })).toHaveCount(0) // client 2's vehicle
    await page.getByRole('button', { name: new RegExp(c.vehicles.v1.plate) }).first().click()
    await expect(form.dialog.getByRole('button', { name: new RegExp(c.vehicles.v1.plate) })).toBeVisible()

    await form.setClient(c.clients.c2) // change client
    await expect(form.dialog.getByRole('button', { name: 'Sem veículo' })).toBeVisible() // the previous vehicle was cleared
    await form.dialog.getByText('Veículo', { exact: true }).locator('xpath=following::button[1]').click()
    await expect(page.getByRole('button', { name: new RegExp(c.vehicles.v3.plate) })).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(c.vehicles.v1.plate) })).toHaveCount(0)
  })

  test('OS-B-07 one item of each kind: service, part, kit (group) and manual item', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()
    await form.addProduct(c.products.S1)
    await form.addProduct(c.products.P1)
    await addGroupProduct(form, c.products.K1, 2) // the kit expands into 2 rows
    await form.addManualItem(c.manual.name, 1, 100, 0)
    expect(await form.itemCount()).toBe(5)
    expect(await form.summary('Subtotal')).toBe(1490) // 1000 + 200 + (150 + 40) + 100
    expect(await form.summary('Custo')).toBe(490) // 300 + 120 + (50 + 20) + 0
    const number = await form.number().inputValue()
    await form.submit()
    await expectToast(page, 'OS criada com sucesso')

    const row = await shop.orderByNumber(number)
    expect(Number(row.total_amount)).toBe(1490)
    expect(Number(row.total_cost_amount)).toBe(490)
    const items = row.items as any[]
    expect(items.map(i => i.description)).toEqual([c.products.S1.name, c.products.P1.name, 'Troca de óleo (kit)', 'Filtro de óleo (kit)', c.manual.name])
    expect(items.map(i => i.product_id ?? null)).toEqual([c.products.S1.id, c.products.P1.id, c.products.K1.id, c.products.K1.id, null])
    expect(items.map(i => i.category_id ?? null)).toEqual([c.categories.servicos, c.categories.pecas, c.categories.servicos, c.categories.servicos, null])
    expect(items.map(i => Number(i.total_price))).toEqual([1000, 200, 150, 40, 100])
  })

  test('OS-B-08 quantity: total = price × quantity; zero and negative become 0', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()
    await form.addProduct(c.products.P3) // R$ 10.00
    const cases: Array<[string, string, number]> = [['3', '3', 30], ['10', '10', 100], ['0', '0', 0], ['-1', '0', 0], ['1.5', '1.5', 15]]
    for (const [typed, shown, subtotal] of cases) {
      await form.row(0).getByRole('spinbutton').fill(typed)
      // observation: after "0" the model stays 0 when "-1" is typed, so the field keeps showing "-1" (the total is what matters)
      if (typed !== '-1') await expect(form.row(0).getByRole('spinbutton')).toHaveValue(shown)
      expect(await form.summary('Subtotal'), `quantity ${typed}`).toBe(subtotal)
    }
    // characterization: with 1.5 the form accepts a decimal and stores the proportional total
    const number = await form.number().inputValue()
    await form.submit()
    await expectToast(page, 'OS criada com sucesso')
    const row = await shop.orderByNumber(number)
    expect(Number(row.total_amount)).toBe(15)
    expect(Number((row.items as any[])[0].quantity)).toBe(1.5)
  })

  test('OS-B-09 price and cost edited on the item override the catalog values', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()
    await form.addProduct(c.products.P1) // catalog: sale 200, cost 120
    await form.setMoney(0, 'sale', 250)
    await form.setMoney(0, 'cost', 100)
    expect(await form.summary('Subtotal')).toBe(250)
    expect(await form.summary('Custo')).toBe(100)
    await expect.poll(() => form.margin(), { timeout: 20_000 }).toBe(150)
    const number = await form.number().inputValue()
    await form.submit()
    await expectToast(page, 'OS criada com sucesso')
    const row = await shop.orderByNumber(number)
    expect(Number(row.total_amount)).toBe(250)
    expect(Number(row.total_cost_amount)).toBe(100)
    expect(Number((row.items as any[])[0].unit_price)).toBe(250)
  })

  test('OS-B-10 removing the middle item recalculates the total and keeps the others', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()
    await form.addResponsible(c.employees.ana)
    await form.addProduct(c.products.S1)
    await form.addProduct(c.products.P1)
    await form.addProduct(c.products.S2)
    expect(await form.summary('Subtotal')).toBe(1350)
    await expect.poll(() => form.summary('Comissão'), { timeout: 20_000 }).toBe(135) // Ana: 10% of 1,350
    await form.removeItem(1) // P1
    await expect.poll(() => form.itemCount()).toBe(2)
    expect(await form.summary('Subtotal')).toBe(1150)
    await expect.poll(() => form.summary('Comissão'), { timeout: 20_000 }).toBe(115)
    const number = await form.number().inputValue()
    await form.submit()
    await expectToast(page, 'OS criada com sucesso')
    const row = await shop.orderByNumber(number)
    expect((row.items as any[]).map(i => i.product_id)).toEqual([c.products.S1.id, c.products.S2.id])
    expect(Number(row.total_amount)).toBe(1150)
    expect(Number(row.commission_amount)).toBe(115)
  })

  test('OS-B-12 discount: the total on screen and in the database is the subtotal minus the discount', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()
    await form.addProduct(c.products.S1)
    await form.addProduct(c.products.P1, 2)
    await form.setDiscount(140)
    expect(await form.summary('Subtotal')).toBe(1400)
    expect(await form.summary('Valor previsto para o cliente')).toBe(1260)
    const number = await form.number().inputValue()
    await form.submit()
    await expectToast(page, 'OS criada com sucesso')
    const row = await shop.orderByNumber(number)
    expect(Number(row.total_amount)).toBe(1260)
    expect(Number(row.discount)).toBe(140)
  })

  test('OS-B-15 rounding: 3 × 33.33 with a 10.00 discount closes at 89.99, with no extra cent', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()
    await form.addProduct(c.products.S4, 3)
    await form.setDiscount(10)
    expect(await form.summary('Subtotal')).toBe(99.99)
    expect(await form.summary('Valor previsto para o cliente')).toBe(89.99)
    const number = await form.number().inputValue()
    await form.submit()
    await expectToast(page, 'OS criada com sucesso')
    const row = await shop.orderByNumber(number)
    expect(Number(row.total_amount)).toBe(89.99)
    expect(Number((row.items as any[])[0].total_price)).toBe(99.99)
  })

  test('OS-B-16 estimated margin: total − cost − commission (Ana + Bruno + Carla, with discount)', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()
    await form.addProduct(c.products.S1)
    await form.addProduct(c.products.P1, 2)
    await form.setDiscount(140)
    for (const e of [c.employees.ana, c.employees.bruno, c.employees.carla]) await form.addResponsible(e)
    await expect.poll(() => form.summary('Comissão'), { timeout: 20_000 }).toBe(364) // 126 + 198 + 40
    await expect.poll(() => form.margin(), { timeout: 20_000 }).toBe(356) // 1,260 − 540 − 364
    const number = await form.number().inputValue()
    await form.submit()
    await expectToast(page, 'OS criada com sucesso')
    const row = await shop.orderByNumber(number)
    expect(Number(row.commission_amount)).toBe(364)
    expect(Number(row.total_amount)).toBe(1260)
  })

  test('OS-B-18 free text (accents, emoji, quotes, line break, 5,000 characters) is stored and shown faithfully', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()
    await form.addProduct(c.products.S2)
    const defect = 'Ruído no cabeçote ✓ — "aspas" & <tags> ação 😀'
    const diagnosis = 'Linha 1\nLinha 2 com acentuação: çãõéü'
    const notes = 'x'.repeat(5000)
    await form.dialog.getByRole('textbox', { name: 'Defeito relatado' }).fill(defect)
    await form.dialog.getByRole('textbox', { name: 'Diagnóstico' }).fill(diagnosis)
    await form.dialog.getByRole('textbox', { name: 'Observações internas' }).fill(notes)
    const number = await form.number().inputValue()
    await form.submit()
    await expectToast(page, 'OS criada com sucesso')
    const row = await shop.orderByNumber(number)
    expect(row.reported_defect).toBe(defect)
    expect(row.diagnosis).toBe(diagnosis)
    expect(row.notes).toBe(notes)
    const detail = await orders.openDetail(number)
    await expect(detail.dialog.getByText(defect)).toBeVisible()
  })

  test('OS-B-22 cancelling the modal saves nothing and the next "Nova OS" opens clean', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const before = await countAllOrders(shop)
    const form = await orders.newOrder()
    await form.setClient(c.clients.c1)
    await form.addProduct(c.products.S1)
    await form.addResponsible(c.employees.ana)
    await form.dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(form.dialog).toBeHidden()
    expect(await countAllOrders(shop)).toBe(before)

    const fresh = await orders.newOrder()
    await expect(fresh.dialog.getByRole('button', { name: 'Sem cliente' })).toBeVisible()
    await expect(fresh.dialog.getByText('Nenhum item adicionado ainda')).toBeVisible()
    await expect(fresh.dialog.getByText('Nenhum responsável adicionado')).toBeVisible()
    expect(await fresh.itemCount()).toBe(0)
  })

  test('OS-B-23 double click on "Criar OS" saves a single order', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const marker = `double-click-${Date.now()}`
    const form = await orders.newOrder()
    await form.addProduct(c.products.S2)
    await form.dialog.getByRole('textbox', { name: 'Defeito relatado' }).fill(marker)
    await form.submitButton().dblclick()
    await expectToast(page, 'OS criada com sucesso')
    await expect(form.dialog).toBeHidden()
    expect(await countOrders(shop, 'reported_defect', marker)).toBe(1)
  })

  test('OS-B-24 server error on save: warns, keeps the modal with the data and leaves no ghost order', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const marker = `server-error-${Date.now()}`
    const form = await orders.newOrder()
    await form.addProduct(c.products.S2)
    await form.dialog.getByRole('textbox', { name: 'Defeito relatado' }).fill(marker)
    await page.route('**/api/service-orders', route => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()))
    await form.submit()
    await expectToast(page, 'Erro ao criar OS')
    await expect(form.dialog).toBeVisible()
    expect(await form.itemCount()).toBe(1) // the data is still in the form
    await expect(form.dialog.getByRole('textbox', { name: 'Defeito relatado' })).toHaveValue(marker)
    expect(await countOrders(shop, 'reported_defect', marker)).toBe(0)
    // with the network back, resending saves a single order
    await page.unroute('**/api/service-orders')
    await form.submit()
    await expectToast(page, 'OS criada com sucesso')
    expect(await countOrders(shop, 'reported_defect', marker)).toBe(1)
  })

  test('OS-B-25 tampered body (organization_id, created_by) is ignored: saved in the session workshop', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const marker = `tampered-body-${Date.now()}`
    const form = await orders.newOrder()
    await form.addProduct(c.products.S2)
    await form.dialog.getByRole('textbox', { name: 'Defeito relatado' }).fill(marker)
    await page.route('**/api/service-orders', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const body = route.request().postDataJSON()
      body.orderData.organization_id = shop.world.orgB
      body.orderData.created_by = 'intruder@example.test'
      body.organization_id = shop.world.orgB
      return route.continue({ postData: JSON.stringify(body) })
    })
    await form.submit()
    await expectToast(page, 'OS criada com sucesso')
    const { data } = await shop.world.db.from('service_orders').select('organization_id, created_by').eq('reported_defect', marker)
    expect(data).toHaveLength(1)
    expect(data![0]!.organization_id).toBe(shop.world.orgA)
    expect(data![0]!.created_by).not.toBe('intruder@example.test')
  })
})
