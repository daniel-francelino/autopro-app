// OS-G — Down payment, extra payment and installments (docs/testing/e2e-service-orders.md §4).
// The installment plan is prepared via API; what the scenario tests (pay, edit, delete, undo) is done through the UI.
import { expect, skipUnlessAuth, test, today } from './support/order-fixtures'
import { settleAfter } from '../support/settle'
import {
  InstallmentsCard, apiDownPayment, apiProcessPayment, expectPaymentBadge, fillCashModal, installmentsOf, openHeaderModal, openOrder, orderInOtherShop, paidSetup, payInFull, sum, transactions
} from './support/helpers-money'

skipUnlessAuth(test)
test.describe.configure({ timeout: 180_000 })

/** R$ 300 order with a 3-installment plan (1st paid, 2nd and 3rd pending) and the account where the 1st landed. */
async function planOf3(shop: Parameters<typeof paidSetup>[0]) {
  const s = await paidSetup(shop, { total: 300 })
  await apiProcessPayment(shop, s.os.id, s.acc.id, [{ amount: 100, status: 'paid' }, { amount: 100, status: 'pending' }, { amount: 100, status: 'pending' }])
  return s
}

test.describe('OS-G: down payment and extra payment', () => {
  test('OS-G-01 receiving a down payment: creates the down-payment installment, adds to the balance and the order becomes Partial', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 1000, status: 'open' })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const dlg = await openHeaderModal(page, detail, 'Receber sinal', 'Receber sinal')
    await fillCashModal(page, dlg, { amountLabel: 'Valor do sinal', amount: 300, account: acc.name })
    await dlg.getByRole('button', { name: 'Registrar sinal' }).click()
    await orders.toastText('Sinal registrado com sucesso')

    const inst = await installmentsOf(shop, os.id)
    expect(inst).toHaveLength(1)
    expect(inst[0]).toMatchObject({ kind: 'down_payment', status: 'paid', amount: 300, bank_account_id: acc.id })
    expect(await shop.balance(acc.id)).toBe(acc.balance + 300)
    expect(await shop.statements(acc.id)).toHaveLength(1)
    expect((await shop.order(os.id)).payment_status).toBe('partial')
    await expectPaymentBadge(detail, 'Parcial')
    await expect(new InstallmentsCard(page, detail).card('Entrada')).toBeVisible()
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  test('OS-G-02 down payment without amount or account: warns and saves nothing', async ({ page, loginAs, shop, apiAs }) => {
    const { acc, os } = await paidSetup(shop, { total: 500, status: 'open' })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const dlg = await openHeaderModal(page, detail, 'Receber sinal', 'Receber sinal')
    await fillCashModal(page, dlg, { amountLabel: 'Valor do sinal', amount: 0, account: acc.name })
    await dlg.getByRole('button', { name: 'Registrar sinal' }).click()
    await orders.toastText('Informe um valor de sinal maior que zero')
    expect(await installmentsOf(shop, os.id)).toHaveLength(0)
    expect(await shop.balance(acc.id)).toBe(acc.balance)

    // shop without accounts: amount ok, but no account
    const apiB = await apiAs('otherOrg')
    const osB = await orderInOtherShop(apiB, 'open', 200)
    await page.context().clearCookies()
    await loginAs('otherOrg')
    const b = await openOrder(page, osB.number)
    const dlgB = await openHeaderModal(page, b.detail, 'Receber sinal', 'Receber sinal')
    await fillCashModal(page, dlgB, { amountLabel: 'Valor do sinal', amount: 50 })
    await dlgB.getByRole('button', { name: 'Registrar sinal' }).click()
    await b.orders.toastText('Selecione a conta bancária')
  })

  test('OS-G-03 down payment greater than the order total (characterization): the balance never diverges from the statement', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 200, status: 'open' })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const dlg = await openHeaderModal(page, detail, 'Receber sinal', 'Receber sinal')
    await fillCashModal(page, dlg, { amountLabel: 'Valor do sinal', amount: 500, account: acc.name })
    await dlg.getByRole('button', { name: 'Registrar sinal' }).click()
    await expect(orders.page.getByText(/Sinal registrado com sucesso|Erro ao registrar sinal/).first()).toBeVisible({ timeout: 20_000 })
    // characterization: it may accept or refuse, but the cash must close either way
    const inst = await installmentsOf(shop, os.id)
    const received = sum(inst.filter(i => i.status === 'paid').map(i => i.amount))
    expect(await shop.balance(acc.id)).toBe(acc.balance + received)
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  test('OS-G-04 down payment then the remainder: the plan accounts for the down payment and the order only settles at the end', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 1000, status: 'in_progress' })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const dlg = await openHeaderModal(page, detail, 'Receber sinal', 'Receber sinal')
    await fillCashModal(page, dlg, { amountLabel: 'Valor do sinal', amount: 300, account: acc.name })
    await dlg.getByRole('button', { name: 'Registrar sinal' }).click()
    await orders.toastText('Sinal registrado com sucesso')

    await detail.button('Concluir').click()
    await orders.toastText('Status atualizado')
    // with the down payment paid, the header must keep offering "Receber" for the remainder
    await expect(detail.button('Receber')).toBeVisible({ timeout: 20_000 })
    const pay = await payInFull(page, detail, acc.name)
    void pay
    await orders.toastText('Pagamento registrado com sucesso')
    await expectPaymentBadge(detail, 'Pago')

    const inst = await installmentsOf(shop, os.id)
    expect(sum(inst.filter(i => i.status === 'paid').map(i => i.amount))).toBe(1000)
    expect(await shop.balance(acc.id)).toBe(acc.balance + 1000)
    expect((await shop.order(os.id)).payment_status).toBe('paid')
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  test('OS-G-05 extra payment: creates the paid extra installment and adds to the balance', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 200 })
    await apiProcessPayment(shop, os.id, acc.id, [{ amount: 200, status: 'paid' }])
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const dlg = await openHeaderModal(page, detail, 'Receber avulso', 'Receber valor avulso')
    await fillCashModal(page, dlg, { amountLabel: 'Valor recebido', amount: 50, account: acc.name })
    await dlg.getByRole('button', { name: 'Registrar recebimento' }).click()
    await orders.toastText('Recebimento registrado com sucesso')

    const extra = (await installmentsOf(shop, os.id)).find(i => i.kind === 'extra')
    expect(extra).toMatchObject({ status: 'paid', amount: 50, bank_account_id: acc.id })
    expect(await shop.balance(acc.id)).toBe(acc.balance + 250)
    await expect(new InstallmentsCard(page, detail).card('Avulso')).toBeVisible()
    await shop.expectCashConsistent(acc.id, acc.balance)
  })

  test('OS-G-06 extra payment without amount or account: warns and saves nothing', async ({ page, loginAs, shop, apiAs }) => {
    const { acc, os } = await paidSetup(shop, { total: 200 })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const dlg = await openHeaderModal(page, detail, 'Receber avulso', 'Receber valor avulso')
    await fillCashModal(page, dlg, { amountLabel: 'Valor recebido', amount: 0, account: acc.name })
    await dlg.getByRole('button', { name: 'Registrar recebimento' }).click()
    await orders.toastText('Informe um valor maior que zero')
    expect(await installmentsOf(shop, os.id)).toHaveLength(0)
    expect(await shop.balance(acc.id)).toBe(acc.balance)

    const apiB = await apiAs('otherOrg')
    const osB = await orderInOtherShop(apiB, 'completed', 200)
    await page.context().clearCookies()
    await loginAs('otherOrg')
    const b = await openOrder(page, osB.number)
    const dlgB = await openHeaderModal(page, b.detail, 'Receber avulso', 'Receber valor avulso')
    await fillCashModal(page, dlgB, { amountLabel: 'Valor recebido', amount: 20 })
    await dlgB.getByRole('button', { name: 'Registrar recebimento' }).click()
    await b.orders.toastText('Selecione a conta bancária')
  })

  test('OS-G-07 KF-31: an extra payment of R$ 1 on a R$ 1,000 order without a plan must NOT leave the order settled', async ({ page, loginAs, shop }) => {
    test.fail(true, 'KF-31: payment_status é derivado das linhas de parcela, não dos valores; um avulso pequeno deixa a OS "paga"')
    const { acc, os } = await paidSetup(shop, { total: 1000 })
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const dlg = await openHeaderModal(page, detail, 'Receber avulso', 'Receber valor avulso')
    await fillCashModal(page, dlg, { amountLabel: 'Valor recebido', amount: 1, account: acc.name })
    await dlg.getByRole('button', { name: 'Registrar recebimento' }).click()
    await orders.toastText('Recebimento registrado com sucesso')
    expect((await shop.order(os.id)).payment_status).not.toBe('paid')
  })
})

test.describe('OS-G: installments', () => {
  test('OS-G-08 paying a whole installment: installment paid, balance rises and the order becomes Paid on the last one', async ({ page, loginAs, shop }) => {
    const { acc, os } = await planOf3(shop)
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const p = new InstallmentsCard(page, detail)
    await expect(p.title()).toHaveText('Parcelas (3)')

    await p.pay('Parcela 2', { account: acc.name })
    await orders.toastText('Pagamento registrado com sucesso')
    await p.expectStatus('Parcela 2', 'Pago')
    await expectPaymentBadge(detail, 'Parcial')
    expect(await shop.balance(acc.id)).toBe(acc.balance + 100) // initial already includes the 1st; +100 from the 2nd
    expect(await shop.statements(acc.id)).toHaveLength(2)

    await p.pay('Parcela 3', { account: acc.name })
    await p.expectStatus('Parcela 3', 'Pago')
    await expectPaymentBadge(detail, 'Pago')
    expect((await shop.order(os.id)).payment_status).toBe('paid')
    expect(await shop.balance(acc.id)).toBe(acc.balance + 200)
    expect(await transactions(shop, os.id)).toHaveLength(3)
    await shop.expectCashConsistent(acc.id, acc.balance - 100) // the 1st installment (R$ 100) was paid during setup
  })

  test('OS-G-09 paying in parts: R$ 40 then R$ 60 → Partial then Paid, button becomes "Receber restante"', async ({ page, loginAs, shop }) => {
    const { acc, os } = await planOf3(shop)
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const p = new InstallmentsCard(page, detail)

    await p.pay('Parcela 2', { amount: 40, account: acc.name })
    await orders.toastText('Pagamento registrado com sucesso')
    await p.expectStatus('Parcela 2', 'Parcial')
    await expect(p.card('Parcela 2').getByText(/falta R\$\s*60,00/)).toBeVisible()
    await expect(p.card('Parcela 2').getByRole('button', { name: 'Receber restante' })).toBeVisible()

    await p.pay('Parcela 2', { amount: 60, account: acc.name })
    await p.expectStatus('Parcela 2', 'Pago')
    const inst = await installmentsOf(shop, os.id)
    expect(inst.find(i => i.installment_number === 2)!.status).toBe('paid')
    expect(await shop.balance(acc.id)).toBe(acc.balance + 100)
    await shop.expectCashConsistent(acc.id, acc.balance - 100)
  })

  test('OS-G-10 paying above the installment balance: saves nothing', async ({ page, loginAs, shop }) => {
    const { acc, os } = await planOf3(shop)
    await loginAs('admin')
    const { detail } = await openOrder(page, os.number)
    const p = new InstallmentsCard(page, detail)
    const before = await shop.statements(acc.id)
    await p.card('Parcela 2').getByRole('button', { name: 'Pagar' }).click()
    const dlg = p.confirmDialog()
    await expect(dlg).toBeVisible()
    await dlg.getByLabel('Valor recebido agora').fill('9999,00')
    // characterization: the UI either disables the button or lets it submit and the server refuses; either way nothing may be saved
    await settleAfter(page, () => dlg.getByRole('button', { name: 'Confirmar', exact: true }).click({ timeout: 5000 }).catch(() => {}))
    expect(await shop.statements(acc.id)).toHaveLength(before.length)
    expect(await shop.balance(acc.id)).toBe(acc.balance)
    expect((await installmentsOf(shop, os.id)).find(i => i.installment_number === 2)!.status).toBe('pending')
  })

  test('OS-G-11 each installment paid into a different account: each balance gets only its own', async ({ page, loginAs, shop }) => {
    const { acc, os } = await planOf3(shop)
    const accB = await shop.newAccount(3000)
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const p = new InstallmentsCard(page, detail)
    await p.pay('Parcela 2', { account: acc.name })
    await orders.toastText('Pagamento registrado com sucesso')
    await p.expectStatus('Parcela 2', 'Pago')
    await p.pay('Parcela 3', { account: accB.name })
    await p.expectStatus('Parcela 3', 'Pago')

    expect(await shop.balance(acc.id)).toBe(acc.balance + 100)
    expect(await shop.balance(accB.id)).toBe(accB.balance + 100)
    expect(await shop.statements(accB.id)).toHaveLength(1)
    await shop.expectCashConsistent(acc.id, acc.balance - 100)
    await shop.expectCashConsistent(accB.id, accB.balance)
  })

  test('OS-G-12 editing a pending installment (amount): updates it (characterization: the plan is not rebalanced)', async ({ page, loginAs, shop }) => {
    const { os } = await planOf3(shop)
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const p = new InstallmentsCard(page, detail)
    const dlg = await p.openEdit('Parcela 2')
    await dlg.getByLabel('Valor esperado').fill('120,00')
    await dlg.getByRole('button', { name: 'Salvar', exact: true }).click()
    await orders.toastText('Parcela atualizada')

    const inst = await installmentsOf(shop, os.id)
    expect(inst.find(i => i.installment_number === 2)!.amount).toBe(120)
    // characterization: the plan sum becomes 320 ≠ order total (300); the system does not rebalance the other installments
    expect(sum(inst.map(i => i.amount))).toBe(320)
  })

  test('OS-G-13 a paid installment cannot be edited: no edit button and the direct call does not change the amount', async ({ page, loginAs, shop }) => {
    const { os } = await planOf3(shop)
    await loginAs('admin')
    const { detail } = await openOrder(page, os.number)
    const p = new InstallmentsCard(page, detail)
    await expect(p.card('Parcela 1').locator('button:has([class~="i-lucide:pencil"])')).toHaveCount(0)
    await expect(p.card('Parcela 2').locator('button:has([class~="i-lucide:pencil"])')).toHaveCount(1)

    const paid = (await installmentsOf(shop, os.id)).find(i => i.installment_number === 1)!
    await page.request.patch(`/api/service-orders/${os.id}/installments/${paid.id}`, { data: { amount: 1, installment_amount: 1 } })
    const after = (await installmentsOf(shop, os.id)).find(i => i.installment_number === 1)!
    expect(after.amount).toBe(100)
    expect(after.status).toBe('paid')
  })

  test('OS-G-14 deleting a paid installment: gives the balance back, reverses the statement and recalculates the order', async ({ page, loginAs, shop }) => {
    const { acc, os } = await planOf3(shop)
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const p = new InstallmentsCard(page, detail)
    const dlg = await p.openDelete('Parcela 1')
    await dlg.getByLabel('Motivo da exclusão').fill('Pagamento lançado por engano')
    await dlg.getByRole('button', { name: 'Excluir parcela', exact: true }).click()
    await orders.toastText('Parcela excluída')

    expect(await shop.balance(acc.id)).toBe(acc.balance - 100) // the balance goes back to the account's initial value
    const inst = await installmentsOf(shop, os.id)
    expect(inst).toHaveLength(2)
    expect(inst.every(i => i.status === 'pending')).toBe(true)
    expect((await shop.order(os.id)).payment_status).toBe('pending')
    await shop.expectCashConsistent(acc.id, acc.balance - 100)
  })

  test('OS-G-15 deleting an installment requires a reason: without one it does not confirm and nothing changes', async ({ page, loginAs, shop }) => {
    const { acc, os } = await planOf3(shop)
    await loginAs('admin')
    const { detail } = await openOrder(page, os.number)
    const p = new InstallmentsCard(page, detail)
    const dlg = await p.openDelete('Parcela 1')
    await settleAfter(page, () => dlg.getByRole('button', { name: 'Excluir parcela', exact: true }).click({ timeout: 5000 }).catch(() => {}))
    expect(await installmentsOf(shop, os.id)).toHaveLength(3)
    expect(await shop.balance(acc.id)).toBe(acc.balance)
  })

  test('OS-G-16 cancelling an installment receipt: the installment goes back to pending and the balance comes back', async ({ page, loginAs, shop }) => {
    const { acc, os } = await planOf3(shop)
    await loginAs('admin')
    const { orders, detail } = await openOrder(page, os.number)
    const p = new InstallmentsCard(page, detail)
    const dlg = await p.openUndo('Parcela 1')
    await dlg.getByRole('button', { name: 'Cancelar recebimento', exact: true }).click()
    await orders.toastText('Recebimento cancelado')
    await p.expectStatus('Parcela 1', 'Pendente')

    expect(await shop.balance(acc.id)).toBe(acc.balance - 100)
    expect((await installmentsOf(shop, os.id)).find(i => i.installment_number === 1)!.status).toBe('pending')
    expect((await shop.order(os.id)).payment_status).toBe('pending')
    await shop.expectCashConsistent(acc.id, acc.balance - 100)
  })

  test('OS-G-17 overdue installment: shows as Atrasado on screen', async ({ page, loginAs, shop }) => {
    const { acc, os } = await paidSetup(shop, { total: 200 })
    await apiProcessPayment(shop, os.id, acc.id, [{ amount: 100, status: 'paid' }, { amount: 100, status: 'pending', due_date: '2025-01-10' }])
    await loginAs('admin')
    const { detail } = await openOrder(page, os.number)
    const p = new InstallmentsCard(page, detail)
    await p.expectStatus('Parcela 2', 'Atrasado')
  })
})
