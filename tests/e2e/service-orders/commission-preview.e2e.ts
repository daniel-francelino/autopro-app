// OS-C — Responsible employees and commission when creating an OS (modal preview × stored × detail).
// The preview is computed in the browser; the server recomputes on save. Both must agree (OS-C-20).
// Values: truth table §3.5 of docs/testing/e2e-service-orders.md. OS-REF1 = S1 ×1 (1,000) + P1 ×2 (400) = 1,400.
import { expect, skipUnlessAuth, test } from './support/order-fixtures'
import { monthStart } from './support/catalog'
import { fillNewOrder, previewAmount, previewOf, saveOrder, snapshotCommission, type ItemInput } from './support/helpers-commission'
import { OrdersPage } from './support/pages'

skipUnlessAuth(test)
test.describe.configure({ timeout: 180_000 })

const REF1 = (c: any): ItemInput[] => [c.products.S1, { p: c.products.P1, qty: 2 }]
const NOTE_RULE = 'Por regra/categoria'

test.describe('OS-C: commission preview per employee (OS-REF1, no discount)', () => {
  const cases = [
    { id: 'OS-C-01', who: 'ana', title: 'Ana earns a flat 10% of revenue on every item', amount: 140, items: [100, 40] },
    { id: 'OS-C-02', who: 'bruno', title: 'Bruno earns 30% of profit on services and 5% of revenue on parts', amount: 230, items: [210, 20] },
    { id: 'OS-C-03', who: 'carla', title: 'Carla earns R$ 20 per unit on parts only (the service earns nothing)', amount: 40, items: [0, 40] },
    { id: 'OS-C-07', who: 'fabio', title: 'Fábio has two plans: the parts-specific fixed rule wins on parts, 10% on the rest', amount: 140, items: [100, 40] }
  ] as const

  for (const k of cases) {
    test(`${k.id} ${k.title}`, async ({ page, loginAs, shop }) => {
      const c = shop.catalog
      const who = c.employees[k.who]
      await loginAs('admin')
      const orders = new OrdersPage(page)
      await orders.open()
      const form = await fillNewOrder(orders, c, { items: REF1(c), employees: [who] })

      // preview in the modal
      const preview = await previewAmount(form, who, k.amount)
      expect(preview.note).toBe(NOTE_RULE)
      expect(await form.summary('Comissão')).toBe(k.amount)
      expect(await form.margin()).toBe(1400 - 540 - k.amount)

      // stored
      const { row } = await saveOrder(form, orders, shop)
      expect(Number(row.commission_amount)).toBe(k.amount)
      expect(row.items.map((i: any) => Number(i.commission_total))).toEqual(k.items)
      expect(snapshotCommission(row, who)).toBe(k.amount)
    })
  }

  test('OS-C-04 Diego (no plan): R$ 0,00 and the note "Sem comissão"', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await fillNewOrder(orders, c, { items: REF1(c), employees: [c.employees.diego] })
    await expect(form.dialog.getByText('Comissão: R$ 0,00')).toBeVisible({ timeout: 15_000 })
    expect((await previewOf(form, c.employees.diego)).note).toBe('Sem comissão')
    expect(await form.summary('Comissão')).toBe(0)
    const { row } = await saveOrder(form, orders, shop)
    expect(Number(row.commission_amount)).toBe(0)
    expect(snapshotCommission(row, c.employees.diego)).toBe(0)
  })

  test('OS-C-05 responsible with no eligible item: R$ 0,00 and "Sem itens elegíveis" (not "Sem comissão")', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    // Carla only has a rule for Parts; the order only has a service.
    const form = await fillNewOrder(orders, c, { items: [c.products.S1], employees: [c.employees.carla] })
    await expect(form.dialog.getByText('Sem itens elegíveis')).toBeVisible({ timeout: 15_000 })
    const p = await previewOf(form, c.employees.carla)
    expect(p.amount).toBe(0)
    expect(p.note).toBe('Sem itens elegíveis')
  })
})

test.describe('OS-C: calculation edge cases', () => {
  test('OS-C-11 per-item rounding: S4 ×3 = 99.99 → Ana 9.999 becomes 10.00', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await fillNewOrder(orders, c, { items: [{ p: c.products.S4, qty: 3 }], employees: [c.employees.ana] })
    expect(await form.summary('Subtotal')).toBe(99.99)
    await previewAmount(form, c.employees.ana, 10)
    const { row } = await saveOrder(form, orders, shop)
    expect(Number(row.total_amount)).toBe(99.99)
    expect(snapshotCommission(row, c.employees.ana)).toBe(10)
  })

  test('OS-C-12 negative profit: S5 (sale 100, cost 150) → Bruno (30% of profit) earns 0.00, never negative', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await fillNewOrder(orders, c, { items: [c.products.S5], employees: [c.employees.bruno] })
    await expect(form.dialog.getByText('Comissão: R$ 0,00')).toBeVisible({ timeout: 15_000 })
    expect((await previewOf(form, c.employees.bruno)).amount).toBe(0)
    const { row } = await saveOrder(form, orders, shop)
    expect(Number(row.commission_amount)).toBe(0)
    expect(snapshotCommission(row, c.employees.bruno)).toBeGreaterThanOrEqual(0)
  })

  test('OS-C-13 fixed amount × quantity: P3 ×10 → Carla earns R$ 20 × 10 = 200.00', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await fillNewOrder(orders, c, { items: [{ p: c.products.P3, qty: 10 }], employees: [c.employees.carla] })
    expect(await form.summary('Subtotal')).toBe(100)
    await previewAmount(form, c.employees.carla, 200)
    const { row } = await saveOrder(form, orders, shop)
    expect(snapshotCommission(row, c.employees.carla)).toBe(200)
  })

  test('OS-C-14 manual item without category: Ana 10 (default rule), Bruno 5 (default), Carla 0 (no default rule)', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await fillNewOrder(orders, c, { items: [{ manual: true }], employees: [c.employees.ana, c.employees.bruno, c.employees.carla] })
    await previewAmount(form, c.employees.ana, 10)
    await previewAmount(form, c.employees.bruno, 5)
    await previewAmount(form, c.employees.carla, 0)
    expect((await previewOf(form, c.employees.carla)).note).toBe('Sem itens elegíveis')
    const { row } = await saveOrder(form, orders, shop)
    expect(snapshotCommission(row, c.employees.ana)).toBe(10)
    expect(snapshotCommission(row, c.employees.bruno)).toBe(5)
    expect(snapshotCommission(row, c.employees.carla)).toBe(0)
  })

  test('OS-C-10 tax reduces commission based on profit: OS-REF1 + 5% tax → Bruno earns 215.00', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const taxName = `ISS 5% ${Date.now().toString(36)}`
    const tax = await shop.api.post('/api/taxes', { name: taxName, type: 'municipal', rate: 5 })
    expect(tax.status, JSON.stringify(tax.body)).toBe(200)
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await fillNewOrder(orders, c, { items: REF1(c), employees: [c.employees.bruno] })
    await form.dialog.getByRole('switch').first().click() // "Impostos"
    await form.dialog.getByRole('button', { name: new RegExp(taxName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
    expect(await form.summary('Impostos')).toBe(70) // 5% of 1,400
    // S1: 30% × (1,000 − 300 − 50 of tax) = 195, P1: 5% × 400 = 20
    await previewAmount(form, c.employees.bruno, 215)
    expect(await form.margin()).toBe(575) // 1,400 − 540 − 70 − 215
    const { row } = await saveOrder(form, orders, shop)
    expect(Number(row.total_taxes_amount)).toBe(70)
    expect(snapshotCommission(row, c.employees.bruno)).toBe(215)
  })
})

test.describe('OS-C: several responsibles, discount and consistency', () => {
  test('OS-C-08 several responsibles: each with their own value, sum in the summary and a coherent margin', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const team = [c.employees.ana, c.employees.bruno, c.employees.carla, c.employees.diego]
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await fillNewOrder(orders, c, { items: REF1(c), employees: team })
    await previewAmount(form, c.employees.ana, 140)
    await previewAmount(form, c.employees.bruno, 230)
    await previewAmount(form, c.employees.carla, 40)
    await previewAmount(form, c.employees.diego, 0)
    expect(await form.summary('Comissão')).toBe(410) // 140 + 230 + 40 + 0
    expect(await form.margin()).toBe(450) // 1,400 − 540 − 410
    const { row } = await saveOrder(form, orders, shop)
    expect(Number(row.commission_amount)).toBe(410)
    expect(row.responsible_employees).toHaveLength(4)
  })

  test('OS-C-09 prorated discount: Ana 126, Bruno 198, Carla 40, Elisa 151.20, Fábio 130 (order of 1,260)', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const team = [c.employees.ana, c.employees.bruno, c.employees.carla, c.employees.elisa, c.employees.fabio]
    const expected = [126, 198, 40, 151.2, 130]
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await fillNewOrder(orders, c, { items: REF1(c), employees: team, discount: 140 })
    expect(await form.summary('Subtotal')).toBe(1400)
    for (const [i, e] of team.entries()) await previewAmount(form, e, expected[i]!)
    const total = Number((126 + 198 + 40 + 151.2 + 130).toFixed(2))
    expect(await form.summary('Comissão')).toBe(total)
    const { row } = await saveOrder(form, orders, shop)
    expect(Number(row.total_amount)).toBe(1260)
    for (const [i, e] of team.entries()) expect(snapshotCommission(row, e)).toBe(expected[i])
    expect(Number(row.commission_amount)).toBe(total)
  })

  test('OS-C-20 preview == stored == detail (Ana, Bruno, Carla)', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const team = [c.employees.ana, c.employees.bruno, c.employees.carla]
    const expected = [140, 230, 40]
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await fillNewOrder(orders, c, { items: REF1(c), employees: team })
    for (const [i, e] of team.entries()) await previewAmount(form, e, expected[i]!)
    const { number, row } = await saveOrder(form, orders, shop)
    for (const [i, e] of team.entries()) expect(snapshotCommission(row, e)).toBe(expected[i])

    // detail: same values per employee, and the total in the financial summary (the rules load after the detail,
    // so the summary starts at R$ 0,00 for a moment: that is why it is polled)
    await orders.expectCard(number)
    const detail = await orders.openDetail(number)
    for (const value of expected) {
      await expect(detail.dialog.getByText(`Comissão: R$ ${String(value).replace('.', ',')}`).first()).toBeVisible({ timeout: 20_000 })
    }
    await expect.poll(async () => {
      const p = detail.dialog.locator('p', { hasText: /^\s*Comissão\s*$/ }).first()
      return Number((await p.locator('xpath=following::p[1]').textContent())?.replace(/[^\d,]/g, '').replace(',', '.'))
    }, { timeout: 20_000, message: 'commission in the detail financial summary' }).toBe(410)
  })
})

test.describe('OS-C: responsible list and rule versions', () => {
  test('OS-C-06 Elisa: the rule version follows the order month (8% two months ago, 12% this month)', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    // this month: 12% × 1,400 = 168
    const current = await fillNewOrder(orders, c, { items: REF1(c), employees: [c.employees.elisa] })
    await previewAmount(current, c.employees.elisa, 168)
    await current.dialog.getByRole('button', { name: 'Cancelar' }).click()
    await expect(current.dialog).toBeHidden()

    // two months ago: the stored order was created through the API with that entry date; opening it for editing
    // must show the older version (8% × 1,400 = 112)
    const old = await shop.createOrder({ items: REF1(c), employees: [c.employees.elisa], entryDate: `${monthStart(-2).slice(0, 8)}15` })
    expect(Number((await shop.order(old.id)).commission_amount)).toBe(112)
    await orders.search().fill(old.number)
    await orders.expectCard(old.number)
    const edit = await orders.editOrder(old.number)
    await previewAmount(edit, c.employees.elisa, 112)
  })

  test('OS-C-15 changing an item quantity recomputes every responsible preview right away', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await fillNewOrder(orders, c, { items: REF1(c), employees: [c.employees.ana, c.employees.carla] })
    await previewAmount(form, c.employees.ana, 140)
    await previewAmount(form, c.employees.carla, 40)
    await form.setQuantity(1, 5) // P1: 2 → 5
    expect(await form.summary('Subtotal')).toBe(2000)
    await previewAmount(form, c.employees.ana, 200) // 10% × (1,000 + 1,000)
    await previewAmount(form, c.employees.carla, 100) // R$ 20 × 5
    expect(await form.summary('Comissão')).toBe(300)
  })

  test('OS-C-16 removing a responsible drops its row and recomputes the total commission and the margin', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await fillNewOrder(orders, c, { items: REF1(c), employees: [c.employees.ana, c.employees.bruno] })
    await previewAmount(form, c.employees.bruno, 230)
    expect(await form.summary('Comissão')).toBe(370)
    const brunoRow = form.dialog.locator('div').filter({ hasText: c.employees.bruno.name }).filter({ hasText: /Comissão: R\$/ }).last()
    await brunoRow.locator('button:has([class~="i-lucide:trash-2"])').click()
    await expect(form.dialog.getByText(c.employees.bruno.name)).toHaveCount(0)
    await previewAmount(form, c.employees.ana, 140)
    expect(await form.summary('Comissão')).toBe(140)
    expect(await form.margin()).toBe(720)
    const { row } = await saveOrder(form, orders, shop)
    expect(row.responsible_employees).toEqual([{ employee_id: c.employees.ana.id }])
    expect(Number(row.commission_amount)).toBe(140)
  })

  test('OS-C-17 the same employee cannot be chosen twice: warning toast and no duplicate', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()
    await form.addResponsible(c.employees.ana)
    await form.addResponsible(c.employees.ana) // second row, same person
    await orders.toastText('Responsável já selecionado')
    await expect(form.dialog.getByText(c.employees.ana.name)).toHaveCount(1)
  })

  test('OS-C-18 adding every employee, then clicking "Adicionar" again, warns that all were already added', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const list = await shop.api.get('/api/employees', { page_size: '100' })
    const all: { id: string, name: string }[] = (list.body.items ?? list.body.data?.items ?? list.body.data ?? []).filter((e: any) => !e.termination_date && !e.deleted_at)
    expect(all.length).toBeGreaterThanOrEqual(Object.keys(c.employees).length)
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()
    for (const e of all) await form.addResponsible({ id: e.id, name: e.name })
    await form.dialog.getByRole('button', { name: 'Adicionar', exact: true }).first().click()
    await orders.toastText('Todos os responsáveis já foram adicionados')
  })

  test('OS-C-19 terminated employee (termination date in the past) — characterization of the responsible picker', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const name = `Gabi Terminated ${Date.now().toString(36)}`
    const created = await shop.api.post('/api/employees', { name, person_type: 'pf', tax_id: '39053344705', phone: '11999990099', termination_date: '2020-01-31' })
    test.skip(created.status !== 200, `could not create the terminated employee (plan limit?): ${JSON.stringify(created.body).slice(0, 120)}`)
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await fillNewOrder(orders, c, { items: [c.products.S1], employees: [] })
    await form.dialog.getByRole('button', { name: 'Adicionar', exact: true }).first().click()
    await form.dialog.getByRole('button', { name: 'Selecione o funcionário' }).last().click()
    await page.getByRole('textbox', { name: 'Buscar funcionário...' }).fill(name)
    // caracterization: a terminated employee is NOT offered as responsible. If this fails, the product offers people who left.
    await expect(page.getByRole('button', { name })).toHaveCount(0)
  })

  test('OS-C-21 plan changed after the order: the stored snapshot keeps the old value until the order is saved again (characterization)', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const run = Date.now().toString(36)
    // own employee and plan, so the shared catalog is not touched
    const emp = await shop.api.post('/api/employees', { name: `Hugo Plan ${run}`, person_type: 'pf', tax_id: '52998224725', phone: '11999990088' })
    test.skip(emp.status !== 200, `could not create the employee (plan limit?): ${JSON.stringify(emp.body).slice(0, 120)}`)
    const employee = { id: String(emp.body.item?.id ?? emp.body.data?.id ?? emp.body.id), name: `Hugo Plan ${run}` }
    const plan = await shop.api.post('/api/commissions', { name: `Hugo 10% ${run}`, rules: [{ commissionType: 'percentage', commissionAmount: 10, commissionBase: 'revenue', isDefault: true }] })
    expect(plan.status, JSON.stringify(plan.body)).toBe(200)
    const planId = String(plan.body.item?.id ?? plan.body.data?.id ?? plan.body.id)
    expect((await shop.api.post(`/api/commissions/${planId}/assignments`, { employeeId: employee.id })).status).toBe(200)

    const order = await shop.createOrder({ items: REF1(c), employees: [employee] })
    expect(Number((await shop.order(order.id)).commission_amount)).toBe(140) // 10% × 1,400

    // the plan changes to 20% from this month on
    const v = await shop.api.post(`/api/commissions/${planId}/versions`, { effectiveFrom: monthStart(0), rules: [{ commissionType: 'percentage', commissionAmount: 20, commissionBase: 'revenue', isDefault: true }] })
    expect(v.status, JSON.stringify(v.body)).toBe(200)

    // caracterization: nothing rewrote the order; the stored snapshot is still the old value
    expect(Number((await shop.order(order.id)).commission_amount)).toBe(140)

    // opening it for editing shows the NEW rule (280) in the preview; saving then writes it
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    await orders.search().fill(order.number)
    await orders.expectCard(order.number)
    const edit = await orders.editOrder(order.number)
    await previewAmount(edit, employee, 280)
    await edit.submit()
    await expect.poll(async () => Number((await shop.order(order.id)).commission_amount), { timeout: 20_000 }).toBe(280)
  })
})
