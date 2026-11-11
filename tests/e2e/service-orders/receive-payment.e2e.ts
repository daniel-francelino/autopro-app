// OS-F — Receiving payment through the "Processar pagamento" modal (docs/testing/e2e-service-orders.md §4).
// Every test creates its own bank account (known balance) and its own order. The cash invariant closes every test that moves money.
import { buildOrderData, expect, skipUnlessAuth, test, today } from './support/order-fixtures'
import {
  METHOD_VALUE, PayModal, apiDownPayment, apiProcessPayment, expectPaymentBadge, installmentsOf, openOrder, orderInOtherShop, paidSetup, payInFull,
  sum, transactions, type MethodLabel
} from './support/helpers-money'

skipUnlessAuth(test)
test.describe.configure({ timeout: 180_000 })

test.describe('OS-F: receiving payment', () => {
  test('OS-F-01 pays in full via PIX: settles the order, adds to the balance, creates 1 statement line and 1 income', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 300 })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)

    await payInFull(page, detail, acc.name)
    await orders.toastText('Pagamento registrado com sucesso')
    await expectPaymentBadge(detail, 'Pago')

    expect((await shop.order(os.id)).payment_status).toBe('paid')
    expect(await shop.balance(acc.id)).toBe(acc.balance + 300)
    expect(await shop.statements(acc.id)).toHaveLength(1)
    const txs = await transactions(shop, os.id)
    expect(txs).toHaveLength(1)
    expect(txs[0]).toMatchObject({ type: 'income', status: 'paid', amount: 300, bank_account_id: acc.id })
    const inst = await installmentsOf(shop, os.id)
    expect(inst).toHaveLength(1)
    expect(inst[0]).toMatchObject({ status: 'paid', amount: 300, payment_method: 'pix', payment_date: today() })
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  const METHODS: MethodLabel[] = ['Dinheiro', 'Pix', 'Transferência', 'Boleto', 'Cheque', 'Cartão de débito', 'Cartão de crédito']
  for (const method of METHODS) {
    test(`OS-F-02 payment method "${method}" saves the right method and raises the balance once`, async ({ page, loginAs, shop }) => {
      const { acc, os } = await paidSetup(shop, { total: 120 })
      await loginAs('admin')
      const { orders, detail } = await openOrder(page, os.number)
      const pay = new PayModal(page)
      await pay.openFrom(detail)
      await pay.setDefaultAccount(acc.name)
      await pay.setDefaultMethod(method)
      await pay.setRowMethod(1, method)
      await pay.setRowAccount(1, acc.name)
      await pay.submit()
      await orders.toastText('Pagamento registrado com sucesso')

      const inst = await installmentsOf(shop, os.id)
      expect(inst).toHaveLength(1)
      expect(inst[0]!.payment_method).toBe(METHOD_VALUE[method])
      expect(await shop.balance(acc.id)).toBe(acc.balance + 120)
      await shop.expectCashConsistent(acc.id, acc.balance)
    })
  }

  test('OS-F-03 3 installments (1st paid): order becomes Partial, 3 installments and only the paid one hits the balance', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 300 })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const pay = new PayModal(page)
    await pay.openFrom(detail)
    await pay.setDefaultAccount(acc.name)
    await pay.setInstallmentCount(3)
    for (const n of [1, 2, 3]) await pay.setRowAccount(n, acc.name)
    await pay.expectRowsTotal(300)
    await pay.setRowStatus(1, 'Pago')
    await pay.setRowStatus(2, 'Pendente')
    await pay.setRowStatus(3, 'Pendente')
    await pay.submit()
    await orders.toastText('Pagamento registrado com sucesso')
    await expectPaymentBadge(detail, 'Parcial')

    const inst = await installmentsOf(shop, os.id)
    expect(inst.map(i => [i.installment_number, i.status, i.amount])).toEqual([[1, 'paid', 100], [2, 'pending', 100], [3, 'pending', 100]])
    expect((await shop.order(os.id)).payment_status).toBe('partial')
    expect(await shop.balance(acc.id)).toBe(acc.balance + 100)
    expect(await shop.statements(acc.id)).toHaveLength(1)
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  test('OS-F-04 installments with cents: R$ 100.00 in 3 installments sums exactly R$ 100.00 on screen and in the database', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 100 })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const pay = new PayModal(page)
    await pay.openFrom(detail)
    await pay.setDefaultAccount(acc.name)
    await pay.setInstallmentCount(3)
    for (const n of [1, 2, 3]) await pay.setRowAccount(n, acc.name)
    const onScreen = [await pay.rowAmount(1), await pay.rowAmount(2), await pay.rowAmount(3)]
    expect(sum(onScreen)).toBe(100)
    await pay.expectRowsTotal(100)
    await pay.setRowStatus(2, 'Pendente')
    await pay.setRowStatus(3, 'Pendente')
    await pay.submit()
    await orders.toastText('Pagamento registrado com sucesso')

    const inst = await installmentsOf(shop, os.id)
    expect(sum(inst.map(i => i.amount))).toBe(100)
    for (const i of inst) expect(i.amount).toBeGreaterThanOrEqual(33.33)
    for (const i of inst) expect(i.amount).toBeLessThanOrEqual(33.34)
    expect(inst.map(i => i.amount)).toEqual(onScreen)
  })

  test('OS-F-05 lines total differs from the order balance: warns and saves nothing', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 300 })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const pay = new PayModal(page)
    await pay.openFrom(detail)
    await pay.setDefaultAccount(acc.name)
    await pay.setRowAccount(1, acc.name)
    await pay.setRowAmount(1, 290)
    await pay.expectRowsTotal(290)
    expect(await pay.balanceDue()).toBe(300)
    await pay.submit()
    await orders.toastText('O total das linhas precisa bater com o saldo restante da OS')
    await expect(pay.dialog).toBeVisible() // did not close

    expect(await installmentsOf(shop, os.id)).toHaveLength(0)
    expect((await shop.order(os.id)).payment_status).toBe('pending')
    expect(await shop.balance(acc.id)).toBe(acc.balance)
    expect(await shop.statements(acc.id)).toHaveLength(0)
  })

  test('OS-F-06 no bank account (shop without accounts): asks to select the account and saves nothing', async ({ page, loginAs, apiAs }) => {
    const apiB = await apiAs('otherOrg')
    const os = await orderInOtherShop(apiB, 'completed', 100)
    await loginAs('otherOrg')
    const { orders, detail } = await openOrder(page, os.number)
    const pay = new PayModal(page)
    await pay.openFrom(detail)
    await pay.submit()
    await orders.toastText('Selecione a conta bancária em todas as linhas')
    await expect(pay.dialog).toBeVisible()
  })

  test.skip('OS-F-07 no payment method: unreachable from the UI (the plan always has at least one line: down payment or 1st installment)', () => {})

  test('OS-F-08 two methods on the same order: cash down payment in account A + PIX remainder in account B', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 300 })
    const accB = await shop.newAccount(2000)
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const pay = new PayModal(page)
    await pay.openFrom(detail)
    await pay.setDefaultAccount(acc.name)
    await pay.toggleDownPayment(150)
    await pay.setRowMethod('entrada', 'Dinheiro')
    await pay.setRowAccount('entrada', acc.name)
    await pay.setRowMethod(1, 'Pix')
    await pay.setRowAccount(1, accB.name)
    await pay.setRowStatus(1, 'Pago')
    await pay.expectRowsTotal(300)
    await pay.submit()
    await orders.toastText('Pagamento registrado com sucesso')
    await expectPaymentBadge(detail, 'Pago')

    const inst = await installmentsOf(shop, os.id)
    expect(inst).toHaveLength(2)
    const downPayment = inst.find(i => i.kind === 'down_payment')!
    const installment = inst.find(i => i.kind !== 'down_payment')!
    expect([downPayment.amount, downPayment.payment_method, downPayment.bank_account_id, downPayment.status]).toEqual([150, 'cash', acc.id, 'paid'])
    expect([installment.amount, installment.payment_method, installment.bank_account_id, installment.status]).toEqual([150, 'pix', accB.id, 'paid'])
    expect(await shop.balance(acc.id)).toBe(acc.balance + 150)
    expect(await shop.balance(accB.id)).toBe(accB.balance + 150)
    expect(await shop.statements(acc.id)).toHaveLength(1)
    expect(await shop.statements(accB.id)).toHaveLength(1)
    expect(await transactions(shop, os.id)).toHaveLength(2)
    await shop.expectCashConsistent(acc.id, acc.balance)
    await shop.expectCashConsistent(accB.id, accB.balance)
  })

  test('OS-F-09 down payment + remainder in installments: down payment paid, rest pending, order Partial', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 300 })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const pay = new PayModal(page)
    await pay.openFrom(detail)
    await pay.setDefaultAccount(acc.name)
    await pay.toggleDownPayment(100)
    await pay.setInstallmentCount(2)
    await pay.setRowAccount('entrada', acc.name)
    for (const n of [1, 2]) { await pay.setRowAccount(n, acc.name); await pay.setRowStatus(n, 'Pendente') }
    await pay.expectRowsTotal(300)
    await pay.submit()
    await orders.toastText('Pagamento registrado com sucesso')
    await expectPaymentBadge(detail, 'Parcial')

    const inst = await installmentsOf(shop, os.id)
    expect(inst.map(i => [i.kind, i.status, i.amount])).toEqual([['down_payment', 'paid', 100], ['installment', 'pending', 100], ['installment', 'pending', 100]])
    expect(await shop.balance(acc.id)).toBe(acc.balance + 100)
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  test('OS-F-10 advance payment greater than the final order value: shows the warning and blocks registering', async ({ page, loginAs, shop }) => {
    const acc = await shop.newAccount(1000)
    const os = await shop.createOrder({ status: 'in_progress', items: [{ p: 'manual', price: 400, cost: 0 }] })
    await apiDownPayment(shop, os.id, acc.id, 300)
    // Setup: lowers the order total to R$ 200 and puts payment back to "pending" (the edit accepts payment_status from the body, KF-37).
    const data = buildOrderData(shop.catalog, { status: 'completed', items: [{ p: 'manual', price: 200, cost: 0 }] })
    const edit = await shop.api.post('/api/service-orders', { orderId: os.id, orderData: { ...data, number: os.number, payment_status: 'pending' } })
    expect(edit.status, JSON.stringify(edit.body)).toBe(200)

    await loginAs('admin')
    const { detail } = await openOrder(page, os.number)
    const pay = new PayModal(page)
    await pay.openFrom(detail)
    await expect(pay.dialog.getByText(/O adiantamento recebido .* é maior que o valor final da OS/)).toBeVisible()
    await expect(pay.confirm()).toBeDisabled()
  })

  test('OS-F-12 past payment date: transaction and statement keep the chosen date', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 100 })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const pay = new PayModal(page)
    await pay.openFrom(detail)
    await pay.setDefaultAccount(acc.name)
    await pay.setRowAccount(1, acc.name)
    // date picker (calendar): picks the 1st day of the current month
    await pay.dialog.getByRole('button', { name: /^\d{2}\/\d{2}\/\d{4}$/ }).first().click()
    await page.locator('[role="gridcell"]:not([data-outside-view])').filter({ hasText: /^1$/ }).first().click()
    await pay.submit()
    await orders.toastText('Pagamento registrado com sucesso')
    const inst = await installmentsOf(shop, os.id)
    expect(inst[0]!.payment_date).toBe(`${today().slice(0, 8)}01`)
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  test('OS-F-13 already paid order: no Receber button and the direct call is refused (409) without touching the balance', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 200 })
    await apiProcessPayment(shop, os.id, acc.id, [{ amount: 200, status: 'paid' }])
    await loginAs('admin')
    const { detail } = await openOrder(page, os.number)
    await expectPaymentBadge(detail, 'Pago')
    await expect(detail.button('Receber')).toHaveCount(0)

    const again = await page.request.post(`/api/service-orders/${os.id}/process-payment`, { data: { paymentMethod: 'pix', bankAccountId: acc.id, installments: [{ amount: 200, status: 'paid' }] } })
    expect(again.status()).toBe(409)
    expect(await shop.balance(acc.id)).toBe(acc.balance + 200)
    expect(await shop.statements(acc.id)).toHaveLength(1)
  })

  test('OS-F-14 order still open: no Receber button (only down payment) and the direct call is refused (409)', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 200, status: 'open' })
    await loginAs('admin')
    const { detail } = await openOrder(page, os.number)
    await expect(detail.button('Receber')).toHaveCount(0)
    await expect(detail.button('Receber sinal')).toBeVisible()

    const res = await page.request.post(`/api/service-orders/${os.id}/process-payment`, { data: { paymentMethod: 'pix', bankAccountId: acc.id, installments: [{ amount: 200, status: 'paid' }] } })
    expect(res.status()).toBe(409)
    expect(await shop.balance(acc.id)).toBe(acc.balance)
    expect(await installmentsOf(shop, os.id)).toHaveLength(0)
  })

  test('OS-F-15 double click on "Registrar pagamento": receives only once', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 250 })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const pay = new PayModal(page)
    await pay.openFrom(detail)
    await pay.setDefaultAccount(acc.name)
    await pay.setRowAccount(1, acc.name)
    await pay.confirm().dblclick()
    await orders.toastText('Pagamento registrado com sucesso')

    expect(await installmentsOf(shop, os.id)).toHaveLength(1)
    expect(await shop.statements(acc.id)).toHaveLength(1)
    expect(await transactions(shop, os.id)).toHaveLength(1)
    expect(await shop.balance(acc.id)).toBe(acc.balance + 250)
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  test('OS-F-16 other shop account: the selector lists only own accounts and the forced id is refused', async ({ page, loginAs, shop, apiAs }) => {
    const { acc, os } = await paidSetup(shop, { total: 100 })
    const apiB = await apiAs('otherOrg')
    const foreignName = `Conta Alheia ${Date.now()}`
    const foreign = await apiB.post('/api/bank-accounts', { account_name: foreignName, account_type: 'checking', initial_balance: 500, current_balance: 500 })
    expect(foreign.status).toBe(200)
    const foreignId = String(foreign.body.item?.id ?? foreign.body.data?.id)

    await loginAs('admin')
    const { detail } = await openOrder(page, os.number)
    const pay = new PayModal(page)
    await pay.openFrom(detail)
    await pay.popups().nth(0).click()
    await expect(page.getByRole('option', { name: acc.name, exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: foreignName, exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')

    const forced = await page.request.post(`/api/service-orders/${os.id}/process-payment`, { data: { paymentMethod: 'pix', bankAccountId: foreignId, installments: [{ amount: 100, status: 'paid', bank_account_id: foreignId }] } })
    expect(forced.status(), await forced.text()).toBeGreaterThanOrEqual(400)
    expect(await installmentsOf(shop, os.id), 'a refused request must not leave an installment behind').toHaveLength(0)
    const { data } = await shop.world.db.from('bank_accounts').select('current_balance').eq('id', foreignId).single()
    expect(Number(data?.current_balance)).toBe(500)
  })

  test('OS-F-17 network error on confirm: shows the error, the modal stays and resubmitting does not duplicate', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 180 })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const pay = new PayModal(page)
    await pay.openFrom(detail)
    await pay.setDefaultAccount(acc.name)
    await pay.setRowAccount(1, acc.name)

    await page.route('**/process-payment', route => route.abort('failed'), { times: 1 })
    await pay.submit()
    await orders.toastText('Erro ao registrar pagamento')
    await expect(pay.dialog).toBeVisible()
    expect(await installmentsOf(shop, os.id)).toHaveLength(0)
    expect(await shop.balance(acc.id)).toBe(acc.balance)

    await pay.submit() // resubmit
    await orders.toastText('Pagamento registrado com sucesso')
    expect(await installmentsOf(shop, os.id)).toHaveLength(1)
    expect(await shop.balance(acc.id)).toBe(acc.balance + 180)
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  test('OS-F-18 @mobile paying on the phone: the modal fits and the register button stays reachable', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 150 })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const pay = new PayModal(page)
    await pay.openFrom(detail)
    await pay.setDefaultAccount(acc.name)
    await pay.setRowAccount(1, acc.name)
    await pay.confirm().scrollIntoViewIfNeeded()
    await expect(pay.confirm()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true) // no horizontal scroll
    await pay.submit()
    await orders.toastText('Pagamento registrado com sucesso')
    expect(await shop.balance(acc.id)).toBe(acc.balance + 150)
    await shop.expectCashConsistent(acc.id, acc.balance)
  })
})
