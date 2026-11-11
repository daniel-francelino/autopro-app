// OS-I — Commission released and paid (from the customer's receipt to the report).
// The receipt is done through the screen (Receber → payment plan); the checks look at the screen and at
// employee_financial_records. Values: truth table §3.5 of docs/testing/e2e-service-orders.md.
// OS-REF1 with a R$ 140 discount = 1,260 → Ana 126, Bruno 198, Carla 40.
import { expect, skipUnlessAuth, test } from './support/fixtures'
import { monthStart } from './support/catalog'
import { amountOf, commissionRecords, payFirstInstallment, receivePayment } from './support/helpers-commission'
import { OrdersPage } from './support/pages'

skipUnlessAuth(test)
test.describe.configure({ timeout: 180_000 })

const REF1 = (c: any) => [{ p: c.products.S1 }, { p: c.products.P1, qty: 2 }]

test.describe('OS-I: release of the commission when the customer pays', () => {
  test('OS-I-01 a full receipt releases every commission: Ana 126, Bruno 198, Carla 40', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const { ana, bruno, carla } = c.employees
    const order = await shop.createOrder({ items: REF1(c), employees: [ana, bruno, carla], discount: 140 })
    expect(order.total).toBe(1260)
    expect(await commissionRecords(shop, order.id)).toHaveLength(0) // nothing released before the customer pays

    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const detail = await receivePayment(orders, order.number)

    const records = await commissionRecords(shop, order.id)
    expect(records).toHaveLength(3)
    expect([amountOf(records, ana), amountOf(records, bruno), amountOf(records, carla)]).toEqual([126, 198, 40])
    for (const r of records) expect(r.status, 'released commission waits to be paid to the employee').not.toBe('paid')

    // the same values show on screen, in the commissions card of the detail
    await expect(detail.dialog.getByRole('heading', { name: 'Comissões (3)' })).toBeVisible({ timeout: 20_000 })
    for (const v of ['126,00', '198,00', '40,00']) await expect(detail.dialog.getByText(`R$ ${v}`).first()).toBeVisible()
  })

  test('OS-I-02 proportional release: receiving 50% releases half; the rest comes with the last installment', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const { ana, bruno, carla } = c.employees
    const order = await shop.createOrder({ items: REF1(c), employees: [ana, bruno, carla], discount: 140 })

    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const detail = await receivePayment(orders, order.number, { installments: 2 }) // 630 paid now, 630 pending

    let records = await commissionRecords(shop, order.id)
    expect([amountOf(records, ana), amountOf(records, bruno), amountOf(records, carla)]).toEqual([63, 99, 20])
    expect((await shop.order(order.id)).payment_status).toBe('partial')

    await payFirstInstallment(orders, detail)
    records = await commissionRecords(shop, order.id)
    expect([amountOf(records, ana), amountOf(records, bruno), amountOf(records, carla)]).toEqual([126, 198, 40])
    expect((await shop.order(order.id)).payment_status).toBe('paid')
  })

  // KF-24: the part already received of a partial installment is not counted in the release.
  test.fail('OS-I-03 KF-24 paying part of an installment must release the matching part of the commission', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const { ana, bruno, carla } = c.employees
    const order = await shop.createOrder({ items: REF1(c), employees: [ana, bruno, carla], discount: 140 })

    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const detail = await receivePayment(orders, order.number, { installments: 2 }) // 630 paid, 630 pending
    await payFirstInstallment(orders, detail, { amount: 300 }) // 930 of 1,260 received = 73.81%

    const records = await commissionRecords(shop, order.id)
    // correct: right × received ÷ total → Ana 126 × 930/1260 = 93.00, Bruno 148.50, Carla 29.52 (≈ 40 × 0.7381)
    expect(amountOf(records, ana)).toBe(93)
    expect(amountOf(records, bruno)).toBe(148.5)
    expect(amountOf(records, carla)).toBe(29.52)
  })

  test('OS-I-04 "Liberar 100% da comissão agora" releases everything at once and the order is marked as fully released', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const { ana, bruno, carla } = c.employees
    const order = await shop.createOrder({ items: REF1(c), employees: [ana, bruno, carla], discount: 140 })

    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const detail = await receivePayment(orders, order.number, { installments: 2, releaseFull: true }) // only 50% is paid

    const records = await commissionRecords(shop, order.id)
    expect([amountOf(records, ana), amountOf(records, bruno), amountOf(records, carla)]).toEqual([126, 198, 40]) // 100%, not 50%
    expect((await shop.order(order.id)).commission_release_mode).toBe('full')
    await expect(detail.dialog.getByText('Liberada integralmente')).toBeVisible({ timeout: 20_000 })
  })

  test('OS-I-05 six responsibles on the same order: each one gets their own value and Diego (no plan) gets no record', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const { ana, bruno, carla, diego, elisa, fabio } = c.employees
    const order = await shop.createOrder({ items: REF1(c), employees: [ana, bruno, carla, diego, elisa, fabio] })

    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    await receivePayment(orders, order.number)

    const records = await commissionRecords(shop, order.id)
    expect([ana, bruno, carla, elisa, fabio].map(e => amountOf(records, e))).toEqual([140, 230, 40, 168, 140])
    expect(amountOf(records, diego)).toBeNull()
  })

  test('OS-I-10 the same order in two different months uses the rule version of each month (Elisa 8% vs 12%)', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const { elisa } = c.employees
    const now = await shop.createOrder({ items: REF1(c), employees: [elisa] })
    const old = await shop.createOrder({ items: REF1(c), employees: [elisa], entryDate: `${monthStart(-2).slice(0, 8)}15` })

    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    await receivePayment(orders, now.number)
    await receivePayment(orders, old.number)

    expect(amountOf(await commissionRecords(shop, now.id), elisa)).toBe(168) // 12% × 1,400
    expect(amountOf(await commissionRecords(shop, old.id), elisa)).toBe(112) // 8% × 1,400
  })
})

test.describe('OS-I: paying the commission to the employee', () => {
  test('OS-I-07 paying a released commission marks it paid, creates the expense and cannot be paid twice', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const { ana } = c.employees
    const order = await shop.createOrder({ items: REF1(c), employees: [ana] })

    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const detail = await receivePayment(orders, order.number)
    const [record] = await commissionRecords(shop, order.id)
    expect(record!.amount).toBe(140)

    // pay it from the "Comissões" card
    const row = detail.dialog.locator('div').filter({ hasText: ana.name }).filter({ has: page.getByRole('button', { name: 'Pagar' }) }).last()
    await expect(row).toBeVisible({ timeout: 20_000 })
    await row.getByRole('button', { name: 'Pagar' }).click()
    await page.getByRole('button', { name: 'Pagar comissão' }).click()
    await orders.toastText('Comissão paga com sucesso')

    const paid = (await commissionRecords(shop, order.id))[0]!
    expect(paid.status).toBe('paid')
    const { data: expenses } = await shop.world.db.from('financial_transactions').select('id, amount, type, status, bank_account_id').eq('employee_financial_record_id', record!.id).is('deleted_at', null)
    expect(expenses).toHaveLength(1)
    expect([expenses![0]!.type, Number(expenses![0]!.amount), expenses![0]!.status]).toEqual(['expense', 140, 'paid'])
    await expect(row.getByRole('button', { name: 'Pagar' })).toHaveCount(0) // no button left to pay again

    // paying it again through the API must not create a second expense
    await shop.api.post('/api/financial/pay-commissions-bulk', { registroIds: [record!.id] })
    const { data: again } = await shop.world.db.from('financial_transactions').select('id').eq('employee_financial_record_id', record!.id).is('deleted_at', null)
    expect(again).toHaveLength(1)
  })
})

test.describe('OS-I: paid commission is never lost', () => {
  test('OS-I-08 undoing the customer payment keeps a commission that was already paid to the employee', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const { ana } = c.employees
    const order = await shop.createOrder({ items: REF1(c), employees: [ana] })

    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const detail = await receivePayment(orders, order.number)
    const [record] = await commissionRecords(shop, order.id)

    const row = detail.dialog.locator('div').filter({ hasText: ana.name }).filter({ has: page.getByRole('button', { name: 'Pagar' }) }).last()
    await row.getByRole('button', { name: 'Pagar' }).click()
    await page.getByRole('button', { name: 'Pagar comissão' }).click()
    await orders.toastText('Comissão paga com sucesso')
    expect((await commissionRecords(shop, order.id))[0]!.status).toBe('paid')

    // now the customer payment is undone through the screen
    await detail.button('Cancelar pagamento').click()
    await page.getByRole('dialog', { name: 'Cancelar pagamento' }).getByRole('button', { name: 'Cancelar pagamento' }).click()
    await expect.poll(async () => (await shop.order(order.id)).payment_status, { timeout: 30_000 }).toBe('pending')

    // the commission already paid must still be there (invariant I3 of financial-core-test-analysis.md)
    const after = await commissionRecords(shop, order.id)
    expect(after.map(r => [r.id, r.status, r.amount])).toContainEqual([record!.id, 'paid', 140])
  })

  test('OS-I-12 recalculating one employee keeps the commission already paid to another and the pending one with a rule', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const { ana, bruno } = c.employees
    const order = await shop.createOrder({ items: REF1(c), employees: [ana, bruno] })

    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const detail = await receivePayment(orders, order.number)
    expect(amountOf(await commissionRecords(shop, order.id), bruno)).toBe(230)

    // pay Ana's commission
    const anaRow = detail.dialog.locator('div').filter({ hasText: ana.name }).filter({ has: page.getByRole('button', { name: 'Pagar' }) }).last()
    await anaRow.getByRole('button', { name: 'Pagar' }).click()
    await page.getByRole('button', { name: 'Pagar comissão' }).click()
    await orders.toastText('Comissão paga com sucesso')

    // recalculate Bruno from the "Responsáveis" card (a reason is required)
    const brunoCard = detail.dialog.locator('div').filter({ hasText: bruno.name }).filter({ has: page.getByRole('button', { name: 'Recalcular', exact: true }) }).last()
    await brunoCard.getByRole('button', { name: 'Recalcular', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Recalcular comissão' })
    await dialog.getByRole('textbox').fill('E2E check: nothing should change')
    await dialog.getByRole('button', { name: 'Recalcular', exact: true }).click()
    await orders.toastText('Comissão recalculada com sucesso')

    const records = await commissionRecords(shop, order.id)
    expect(records.filter(r => r.employee_id === ana.id).map(r => [r.status, r.amount])).toEqual([['paid', 140]]) // paid one untouched
    expect(amountOf(records, bruno)).toBe(230) // still has a rule: kept, not erased (regression of KF-36)
  })
})
