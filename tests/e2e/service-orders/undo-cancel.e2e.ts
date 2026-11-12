// OS-H — Undoing payment, cancelling the order and reversing (docs/testing/e2e-service-orders.md §4).
// The starting state (paid order, plan, commission) is prepared via API; undoing and cancelling are done through the UI.
import { expect, money, skipUnlessAuth, test, today } from './support/order-fixtures'
import type { OrderDetail } from './support/pages'
import { apiProcessPayment, expectPaymentBadge, openUntilVisible, installmentsOf, openOrder, paidSetup, payInFull, transactions } from './support/helpers-money'
import type { Page } from '@playwright/test'

skipUnlessAuth(test)
test.describe.configure({ timeout: 180_000 })

/** Header "Cancelar pagamento" button → confirmation. */
async function cancelPaymentUI(page: Page, detail: OrderDetail) {
  const dlg = page.getByRole('dialog', { name: 'Cancelar pagamento' })
  await openUntilVisible(() => detail.button('Cancelar pagamento').click(), dlg)
  await dlg.getByRole('button', { name: 'Cancelar pagamento', exact: true }).click()
}
/** Header "Cancelar OS" icon (icon-only) → confirmation. */
async function cancelOrderUI(page: Page, detail: OrderDetail) {
  const dlg = page.getByRole('dialog', { name: 'Cancelar OS' })
  await openUntilVisible(() => detail.dialog.locator('button:has([class~="i-lucide:ban"])').first().click(), dlg)
  await dlg.getByRole('button', { name: 'Cancelar OS', exact: true }).click()
}

/** R$ 1,000 order (S1) with Ana as responsible (R$ 100 commission), paid via API. */
async function paidWithCommission(shop: Parameters<typeof paidSetup>[0]) {
  const acc = await shop.newAccount(1000)
  const c = shop.catalog
  const os = await shop.createOrder({ status: 'completed', items: [{ p: c.products.S1 }], employees: [c.employees.ana] })
  await apiProcessPayment(shop, os.id, acc.id, [{ amount: 1000, status: 'paid' }])
  return { acc, os, c }
}

test.describe('OS-H: undoing and cancelling', () => {
  test('OS-H-01 cancelling payment: balance comes back, statement reversed, order goes back to Pendente and "Receber" reappears', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidWithCommission(shop)
    expect(await shop.balance(acc.id)).toBe(acc.balance + 1000)
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    await cancelPaymentUI(page, detail)
    await orders.toastText('Pagamento cancelado')
    await expectPaymentBadge(detail, 'Pendente')
    await expect(detail.button('Receber')).toBeVisible()

    expect(await shop.balance(acc.id)).toBe(acc.balance)
    expect(await shop.statements(acc.id)).toHaveLength(0)
    expect(await installmentsOf(shop, os.id)).toHaveLength(0)
    expect(await transactions(shop, os.id)).toHaveLength(0)
    expect((await shop.order(os.id)).payment_status).toBe('pending')
    // the commission released by the receipt must not stay "paid" after the reversal
    expect((await shop.commissions(os.id)).filter(r => r.status === 'paid')).toHaveLength(0)
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  test('OS-H-02 receive → undo → receive cycle (twice): the final balance adds the total only once', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 300 })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    for (let volta = 0; volta < 2; volta++) {
      await payInFull(page, detail, acc.name)
      await orders.toastText('Pagamento registrado com sucesso')
      await expectPaymentBadge(detail, 'Pago')
      expect(await shop.balance(acc.id)).toBe(acc.balance + 300)
      await cancelPaymentUI(page, detail)
      await orders.toastText('Pagamento cancelado')
      await expectPaymentBadge(detail, 'Pendente')
      expect(await shop.balance(acc.id)).toBe(acc.balance)
    }
    await payInFull(page, detail, acc.name)
    await expectPaymentBadge(detail, 'Pago')
    expect(await shop.balance(acc.id)).toBe(acc.balance + 300)
    expect(await shop.statements(acc.id)).toHaveLength(1) // sem resíduo de estorno
    expect(await transactions(shop, os.id)).toHaveLength(1)
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  test('OS-H-03 undoing with 3 paid installments in the same account: the balance returns to the initial value (KF-19 regression)', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 300 })
    await apiProcessPayment(shop, os.id, acc.id, [{ amount: 100, status: 'paid' }, { amount: 100, status: 'paid' }, { amount: 100, status: 'paid' }])
    expect(await shop.balance(acc.id)).toBe(acc.balance + 300)
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    await cancelPaymentUI(page, detail)
    await orders.toastText('Pagamento cancelado')
    expect(await shop.balance(acc.id)).toBe(acc.balance)
    expect(await shop.statements(acc.id)).toHaveLength(0)
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  test('OS-H-04 undoing with installments in two accounts: each account gives back its own amount', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 300 })
    const accB = await shop.newAccount(4000)
    await apiProcessPayment(shop, os.id, acc.id, [
      { amount: 100, status: 'paid', bank_account_id: acc.id },
      { amount: 120, status: 'paid', bank_account_id: accB.id },
      { amount: 80, status: 'paid', bank_account_id: acc.id }
    ])
    expect(await shop.balance(acc.id)).toBe(acc.balance + 180)
    expect(await shop.balance(accB.id)).toBe(accB.balance + 120)
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    await cancelPaymentUI(page, detail)
    await orders.toastText('Pagamento cancelado')
    expect(await shop.balance(acc.id)).toBe(acc.balance)
    expect(await shop.balance(accB.id)).toBe(accB.balance)
    await shop.expectCashConsistent(acc.id, acc.balance)
    await shop.expectCashConsistent(accB.id, accB.balance)
  })

  test('OS-H-05 cancelling an order with payment: refused until the receipt is undone; then it cancels', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 200 })
    await apiProcessPayment(shop, os.id, acc.id, [{ amount: 200, status: 'paid' }])
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)

    await cancelOrderUI(page, detail)
    await orders.toastText('Erro ao cancelar OS')
    expect((await shop.order(os.id)).status).toBe('completed')
    expect(await shop.balance(acc.id)).toBe(acc.balance + 200)

    // closes the confirmation that stayed open and undoes the payment
    await page.keyboard.press('Escape')
    await cancelPaymentUI(page, detail)
    await orders.toastText('Pagamento cancelado')
    await cancelOrderUI(page, detail)
    await orders.toastText('OS cancelada')
    expect((await shop.order(os.id)).status).toBe('cancelled')
    expect(await shop.balance(acc.id)).toBe(acc.balance)
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  test('OS-H-06 KF-40: cancelling the order must NOT delete a commission already paid to the employee', async ({ page, loginAs, shop }) => {
    test.fail(true, 'KF-40: cancelling the order deletes the paid commission')
    const { acc, os } = await paidWithCommission(shop)
    const [rec] = await shop.commissions(os.id)
    expect(rec, 'the commission should have been released by the receipt').toBeTruthy()
    const pay = await shop.api.post('/api/financial/pay-commissions-bulk', { registroIds: [rec!.id], contaBancariaId: acc.id, dataPagamento: today() })
    expect(pay.status, JSON.stringify(pay.body)).toBe(200)
    expect((await shop.commissions(os.id))[0]!.status).toBe('paid')

    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    await cancelPaymentUI(page, detail)
    await orders.toastText('Pagamento cancelado')
    await cancelOrderUI(page, detail)
    await orders.toastText('OS cancelada')
    const paid = (await shop.commissions(os.id)).filter(r => r.status === 'paid')
    expect(paid).toHaveLength(1)
  })

  test('OS-H-07 cancelled order stays out of revenue (overview report)', async ({ page, loginAs, shop }) => {
    const { os } = await paidSetup(shop, { total: 777 })
    await loginAs('admin')
    const revenue = async () => (await (await page.request.get('/api/reports/overview', { params: { dateFrom: today(), dateTo: today() } })).json()).data.overview.grossRevenue as number
    const before = await revenue()
    const { orders, detail } = await openOrder(page, os.number)
    await cancelOrderUI(page, detail)
    await orders.toastText('OS cancelada')
    const after = await revenue()
    expect(money(before - after)).toBe(777) // the order counted before and stopped counting
    expect((await shop.order(os.id)).status).toBe('cancelled')
  })

  test('OS-H-08 reversing an order whose commission was already paid: the paid commission remains (invariant I3)', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidWithCommission(shop)
    const [rec] = await shop.commissions(os.id)
    expect(rec, 'the commission should have been released by the receipt').toBeTruthy()
    const pay = await shop.api.post('/api/financial/pay-commissions-bulk', { registroIds: [rec!.id], contaBancariaId: acc.id, dataPagamento: today() })
    expect(pay.status, JSON.stringify(pay.body)).toBe(200)

    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    await cancelPaymentUI(page, detail)
    // characterization: the system may refuse the reversal or perform it; either way the paid commission must not disappear
    await expect(page.getByText(/Pagamento cancelado|Erro ao cancelar pagamento/).first()).toBeVisible({ timeout: 20_000 })
    void orders
    const rows = await shop.commissions(os.id)
    expect(rows.filter(r => r.status === 'paid')).toHaveLength(1)
    await shop.expectCashConsistent(acc.id, acc.balance)
  })
})
