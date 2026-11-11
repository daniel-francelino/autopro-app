// OS-D — Status, editing, duplicating, deleting and cancelling through the UI (docs/testing/e2e-service-orders.md §4).
// Setup via API (ready-made orders); the tested action is done in the interface; verification looks at the screen and the database.
import { expect, skipUnlessAuth, test, today } from './support/fixtures'
import { advanceButton, advanceCount, cardIcon, detailLoaded, expectToast, ignorePopups, openConfirm, payInFull } from './support/helpers-order'
import { OrdersPage } from './support/pages'

skipUnlessAuth(test)
test.describe.configure({ timeout: 180_000 })

test.describe('OS-D: status', () => {
  test('OS-D-01 full cycle from the list: Estimate → Open → In progress → Completed', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    ignorePopups(page) // on completion the app opens the PDF in another window
    const os = await shop.createOrder({ status: 'estimate', items: [{ p: c.products.S1 }, { p: c.products.P1, qty: 2 }], employees: [c.employees.ana] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    await orders.expectCard(os.number)

    const steps: Array<['Abrir OS' | 'Iniciar' | 'Concluir', string, string]> = [['Abrir OS', 'open', 'Aberta'], ['Iniciar', 'in_progress', 'Em andamento'], ['Concluir', 'completed', 'Concluída']]
    for (const [button, dbStatus, badge] of steps) {
      await advanceButton(orders, os.number, button).click()
      await expect.poll(async () => (await shop.order(os.id)).status, { timeout: 20_000 }).toBe(dbStatus)
      await expect(orders.card(os.number).getByText(badge, { exact: true })).toBeVisible()
    }
    expect(await advanceCount(orders, os.number)).toBe(0) // completed: there is no further advance
    expect((await shop.order(os.id)).payment_status).toBe('pending')
  })

  test('OS-D-02 the same advance from the detail header', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    ignorePopups(page)
    const os = await shop.createOrder({ status: 'estimate', items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const detail = await orders.openDetail(os.number)
    await detailLoaded(detail)
    for (const [button, dbStatus] of [['Abrir OS', 'open'], ['Iniciar', 'in_progress'], ['Concluir', 'completed']] as const) {
      await detail.button(button).click()
      await expect.poll(async () => (await shop.order(os.id)).status, { timeout: 20_000 }).toBe(dbStatus)
    }
    await expect(detail.button('Concluir')).toHaveCount(0)
  })

  test('OS-D-03 completing the order creates no paid commission nor one pending payment to the employee', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    ignorePopups(page)
    const os = await shop.createOrder({ status: 'in_progress', items: [{ p: c.products.S1 }, { p: c.products.P1, qty: 2 }], employees: [c.employees.ana, c.employees.bruno] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    await advanceButton(orders, os.number, 'Concluir').click()
    await expect.poll(async () => (await shop.order(os.id)).status, { timeout: 20_000 }).toBe('completed')
    // characterization: commission is only released when the customer pays; completing creates no record
    expect(await shop.commissions(os.id)).toHaveLength(0)
    expect(Number((await shop.order(os.id)).commission_amount)).toBe(370) // the entitlement (Ana 140 + Bruno 230) stays in the order snapshot
  })

  for (const status of ['waiting_for_part', 'invoiced', 'delivered', 'cancelled'] as const) {
    test(`OS-D-04 status ${status}: the card offers no advance button`, async ({ page, loginAs, shop }) => {
      const c = shop.catalog
      const os = await shop.createOrder({ status, items: [{ p: c.products.S2 }] })
      await loginAs('admin')
      const orders = new OrdersPage(page)
      await orders.open()
      await orders.expectCard(os.number)
      expect(await advanceCount(orders, os.number)).toBe(0)
    })
  }

  test('OS-D-04b "Aguard. peça" only changes status through editing', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'waiting_for_part', items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.editOrder(os.number)
    await form.setStatus('Em andamento')
    await form.submit()
    await expectToast(page, 'OS atualizada com sucesso')
    expect((await shop.order(os.id)).status).toBe('in_progress')
  })
})

test.describe('OS-D: edit', () => {
  test('OS-D-05 editing an open order: quantity, discount and responsible recalculate total and commission; the number is kept', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'open', items: [{ p: c.products.S1 }, { p: c.products.P1, qty: 2 }], employees: [c.employees.ana] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.editOrder(os.number)
    await expect(form.number()).toHaveValue(os.number)
    expect(await form.summary('Subtotal')).toBe(1400)

    await form.setQuantity(1, 3) // P1: 2 → 3 (600)
    await form.setDiscount(160)
    await form.addResponsible(c.employees.bruno)
    expect(await form.summary('Subtotal')).toBe(1600)
    expect(await form.summary('Valor previsto para o cliente')).toBe(1440)
    expect(await form.summary('Custo')).toBe(660) // 300 + 360
    await expect.poll(() => form.summary('Comissão'), { timeout: 20_000 }).toBe(351) // Ana 144 + Bruno 207
    await expect.poll(() => form.margin(), { timeout: 20_000 }).toBe(429) // 1,440 − 660 − 351

    await form.submit()
    await expectToast(page, 'OS atualizada com sucesso')
    const row = await shop.order(os.id)
    expect(row.number).toBe(os.number)
    expect(Number(row.total_amount)).toBe(1440)
    expect(Number(row.discount)).toBe(160)
    expect(Number(row.commission_amount)).toBe(351)
    expect((row.items as any[]).map(i => Number(i.quantity))).toEqual([1, 3])
    expect(row.responsible_employees).toEqual([{ employee_id: c.employees.ana.id }, { employee_id: c.employees.bruno.id }])
    expect(row.status).toBe('open')
    expect(row.payment_status).toBe('pending')
    // the list shows the new total
    await expect(orders.card(os.number).getByText('R$ 1.440,00')).toBeVisible()
  })

  test('OS-D-06 a completed order that has not been paid yet can be edited', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'completed', items: [{ p: c.products.S1 }, { p: c.products.P1, qty: 2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    await expect(cardIcon(orders, os.number, 'pencil')).toBeVisible()
    const form = await orders.editOrder(os.number)
    await form.setDiscount(100)
    await form.submit()
    await expectToast(page, 'OS atualizada com sucesso')
    const row = await shop.order(os.id)
    expect(Number(row.total_amount)).toBe(1300)
    expect(row.status).toBe('completed')
  })

  test('OS-D-07 a paid or partially paid order has no Edit button', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const account = await shop.newAccount(1000)
    const paid = await shop.createOrder({ status: 'completed', items: [{ p: c.products.S1 }] })
    const partial = await shop.createOrder({ status: 'completed', items: [{ p: c.products.S1 }] })
    await payInFull(shop, paid.id, account.id, 1000)
    const res = await shop.api.post(`/api/service-orders/${partial.id}/process-payment`, {
      paymentMethod: 'pix', bankAccountId: account.id, installments: [{ amount: 400, status: 'paid' }, { amount: 600 }]
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect((await shop.order(paid.id)).payment_status).toBe('paid')
    expect((await shop.order(partial.id)).payment_status).toBe('partial')

    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    await orders.expectCard(paid.number)
    await orders.expectCard(partial.number)
    await expect(cardIcon(orders, paid.number, 'pencil')).toHaveCount(0)
    await expect(cardIcon(orders, partial.number, 'pencil')).toHaveCount(0)
    const detail = await orders.openDetail(paid.number)
    await detailLoaded(detail)
    await expect(detail.button('Editar')).toHaveCount(0)
  })

  test('OS-D-07b server: editing the total of a paid order should be refused (KF-37/38/39)', async ({ shop }) => {
    test.fail(true, 'KF-37/38/39: POST /api/service-orders with orderId accepts total_amount/status from the body even with a registered payment')
    const c = shop.catalog
    const account = await shop.newAccount(1000)
    const os = await shop.createOrder({ status: 'completed', items: [{ p: c.products.S1 }] })
    await payInFull(shop, os.id, account.id, 1000)
    const res = await shop.api.post('/api/service-orders', { orderId: os.id, orderData: { total_amount: 9999 } })
    expect(res.status, 'the server should refuse editing a paid order').toBeGreaterThanOrEqual(400)
  })

  for (const status of ['invoiced', 'delivered', 'cancelled'] as const) {
    test(`OS-D-08 status ${status} has no Edit button`, async ({ page, loginAs, shop }) => {
      const c = shop.catalog
      const os = await shop.createOrder({ status, items: [{ p: c.products.S2 }] })
      await loginAs('admin')
      const orders = new OrdersPage(page)
      await orders.open()
      await orders.expectCard(os.number)
      await expect(cardIcon(orders, os.number, 'pencil')).toHaveCount(0)
    })
  }

  test('OS-D-10 changing client and vehicle while editing updates the detail and the list', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'open', client: c.clients.c1, vehicle: c.vehicles.v1, items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    await expect(orders.card(os.number).getByText(c.clients.c1.name)).toBeVisible()
    const form = await orders.editOrder(os.number)
    await form.setClient(c.clients.c2)
    await form.setVehicle(c.vehicles.v3)
    await form.submit()
    await expectToast(page, 'OS atualizada com sucesso')
    const row = await shop.order(os.id)
    expect(row.client_id).toBe(c.clients.c2.id)
    expect(row.vehicle_id).toBe(c.vehicles.v3.id)
    await expect(orders.card(os.number).getByText(c.clients.c2.name)).toBeVisible()
    await expect(orders.card(os.number).getByText(c.clients.c1.name)).toHaveCount(0)
    await expect(orders.card(os.number).getByText(c.vehicles.v3.plate)).toBeVisible()
  })

  test('OS-D-11 saving the same order 3 times neither duplicates nor changes the commission', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'open', items: [{ p: c.products.S1 }, { p: c.products.P1, qty: 2 }], employees: [c.employees.ana, c.employees.bruno] })
    const before = await shop.order(os.id)
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    for (let i = 0; i < 3; i++) {
      const form = await orders.editOrder(os.number)
      await form.submit()
      await expectToast(page, 'OS atualizada com sucesso')
      await expect(form.dialog).toBeHidden()
    }
    const after = await shop.order(os.id)
    expect(Number(after.commission_amount)).toBe(Number(before.commission_amount))
    expect(Number(after.commission_amount)).toBe(370)
    expect(after.items).toEqual(before.items) // per-item commission snapshot unchanged
    // characterization: without payment there is no commission record, so saving does not create any either
    expect(await shop.commissions(os.id)).toHaveLength(0)
  })

  test('OS-D-12 changing the number to another order\'s number warns and changes nothing', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const a = await shop.createOrder({ status: 'open', items: [{ p: c.products.S2 }] })
    const b = await shop.createOrder({ status: 'open', items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.editOrder(b.number)
    await form.number().fill(a.number)
    await form.submit()
    await expectToast(page, 'Número já existe')
    await expect(form.dialog).toBeVisible()
    expect((await shop.order(b.id)).number).toBe(b.number)
    expect((await shop.order(a.id)).number).toBe(a.number)
  })
})

test.describe('OS-D: duplicate', () => {
  test('OS-D-13 duplicate: new open order, same content, zeroed payment and the original untouched', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'completed', items: [{ p: c.products.S1 }, { p: c.products.P1, qty: 2 }], employees: [c.employees.ana, c.employees.bruno], discount: 140 })
    const original = await shop.order(os.id)
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    await cardIcon(orders, os.number, 'copy').click()
    await expectToast(page, 'OS duplicada com sucesso')

    const others = () => shop.world.db.from('service_orders').select('*').eq('organization_id', shop.world.orgA).neq('id', os.id).eq('client_id', c.clients.c1.id).is('deleted_at', null)
    await expect.poll(async () => (await others()).data?.length ?? 0, { timeout: 20_000 }).toBe(1)
    const copy = (await others().single()).data!
    expect(copy.number).not.toBe(os.number)
    expect(copy.status).toBe('open')
    expect(copy.payment_status).toBe('pending')
    expect(copy.entry_date).toBe(today())
    expect(Number(copy.total_amount)).toBe(1260)
    expect(Number(copy.discount)).toBe(140)
    expect((copy.items as any[]).map(i => i.product_id)).toEqual([c.products.S1.id, c.products.P1.id])
    expect(copy.responsible_employees).toEqual(original.responsible_employees)
    expect(Number(copy.commission_amount)).toBe(Number(original.commission_amount))
    expect(await shop.installments(copy.id)).toHaveLength(0)
    expect(await shop.commissions(copy.id)).toHaveLength(0)
    // the original stays as it was
    const after = await shop.order(os.id)
    expect(after.status).toBe('completed')
    expect(after.items).toEqual(original.items)
    expect(Number(after.total_amount)).toBe(1260)
    // characterization: duplicating does not send the order's total cost
    console.log(`OBS OS-D-13 total_cost_amount: original=${original.total_cost_amount} copy=${copy.total_cost_amount}`)
  })

  test('OS-D-14 duplicating a paid order: the copy is born pending, with no installments and no released commission', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const account = await shop.newAccount(1000)
    const os = await shop.createOrder({ status: 'completed', items: [{ p: c.products.S1 }], employees: [c.employees.ana] })
    await payInFull(shop, os.id, account.id, 1000)
    expect((await shop.commissions(os.id)).length).toBeGreaterThan(0)
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    await cardIcon(orders, os.number, 'copy').click()
    await expectToast(page, 'OS duplicada com sucesso')
    const others = () => shop.world.db.from('service_orders').select('*').eq('organization_id', shop.world.orgA).neq('id', os.id).eq('client_id', c.clients.c1.id).is('deleted_at', null)
    await expect.poll(async () => (await others()).data?.length ?? 0, { timeout: 20_000 }).toBe(1)
    const copy = (await others().single()).data!
    expect(copy.payment_status).toBe('pending')
    expect(await shop.installments(copy.id)).toHaveLength(0)
    expect(await shop.commissions(copy.id)).toHaveLength(0)
    expect(await shop.balance(account.id)).toBe(2000) // the account balance does not change by duplicating
    expect((await shop.order(os.id)).payment_status).toBe('paid')
  })
})

test.describe('OS-D: delete and cancel', () => {
  test('OS-D-15 deleting an open order: it disappears from the list and from the database (soft delete), even after reloading', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'open', items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const confirm = await openConfirm(orders, os.number, 'trash-2', 'Excluir OS')
    await confirm.confirm('Excluir OS')
    await expectToast(page, 'OS removida')
    await expect(orders.numberLabel(os.number)).toHaveCount(0)
    const { data } = await shop.world.db.from('service_orders').select('deleted_at').eq('id', os.id).single()
    expect(data!.deleted_at).not.toBeNull()
    await orders.open()
    await expect(orders.numberLabel(os.number)).toHaveCount(0)
  })

  test('OS-D-16 deleting an order with payment: the account balance is never left wrong', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const account = await shop.newAccount(1000)
    const os = await shop.createOrder({ status: 'completed', items: [{ p: c.products.S1 }] })
    await payInFull(shop, os.id, account.id, 1000)
    expect(await shop.balance(account.id)).toBe(2000)
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const confirm = await openConfirm(orders, os.number, 'trash-2', 'Excluir OS')
    await confirm.confirm('Excluir OS')
    await expect(page.getByText(/OS removida|Erro/).first()).toBeVisible({ timeout: 20_000 })
    const { data } = await shop.world.db.from('service_orders').select('deleted_at').eq('id', os.id).single()
    const deleted = data!.deleted_at !== null
    // characterization: the server reverts the receipt on delete (cascade). Invariant: balance = initial (if deleted) or initial + total (if refused).
    console.log(`OBS OS-D-16 deleted=${deleted} balance=${await shop.balance(account.id)}`)
    expect(await shop.balance(account.id)).toBe(deleted ? 1000 : 2000)
    await shop.expectCashConsistent(account.id, 1000)
  })

  test('OS-D-17 cancelling an unpaid order: status Cancelled and out of revenue', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'completed', items: [{ p: c.products.S1 }], employees: [c.employees.ana] })
    const revenue = async () => Number((await shop.api.get('/api/reports/overview', { dateFrom: today(), dateTo: today() })).body.data.overview.grossRevenue)
    const before = await revenue()
    expect(before).toBeGreaterThanOrEqual(1000)
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const confirm = await openConfirm(orders, os.number, 'ban', 'Cancelar OS')
    await confirm.confirm('Cancelar OS')
    await expectToast(page, 'OS cancelada')
    await expect(orders.card(os.number).getByText('Cancelada', { exact: true })).toBeVisible()
    expect((await shop.order(os.id)).status).toBe('cancelled')
    expect(await shop.commissions(os.id)).toHaveLength(0)
    expect(await revenue()).toBe(before - 1000)
  })

  test('OS-D-18 cancelling asks for confirmation: giving up changes nothing', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'open', items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const confirm = await openConfirm(orders, os.number, 'ban', 'Cancelar OS')
    await confirm.dismiss()
    await expect(confirm.dialog).toBeHidden()
    expect((await shop.order(os.id)).status).toBe('open')
    await expect(orders.card(os.number).getByText('Aberta', { exact: true })).toBeVisible()
  })

  test('OS-D-19 a cancelled order is terminal: no edit, receive, advance or cancel action', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const os = await shop.createOrder({ status: 'cancelled', items: [{ p: c.products.S1 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    await orders.expectCard(os.number)
    for (const icon of ['pencil', 'credit-card', 'hand-coins', 'ban']) await expect(cardIcon(orders, os.number, icon), icon).toHaveCount(0)
    expect(await advanceCount(orders, os.number)).toBe(0)
    const detail = await orders.openDetail(os.number)
    await detailLoaded(detail)
    for (const name of ['Editar', 'Receber', 'Receber sinal', 'Receber avulso']) await expect(detail.button(name), name).toHaveCount(0)
  })
})
