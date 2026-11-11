// Helpers for the commission specs (OS-C and OS-I groups), built on the page objects in pages.ts.
import { expect, type Locator } from '@playwright/test'
import type { Catalog, EmployeeRef, ProductRef } from './catalog'
import type { Shop } from './order-fixtures'
import { OrderForm, OrdersPage, PaymentDialog, clickUntil, parseBRL } from './pages'

export type ItemInput = ProductRef | { manual: true, qty?: number } | { p: ProductRef, qty: number }
export type CommissionNote = 'Por regra/categoria' | 'Sem itens elegíveis' | 'Sem comissão'

/** Normalizes the ways of passing an item (plain product, product + quantity, or manual item). */
function normalize(item: ItemInput): { product: ProductRef | null, qty: number } {
  if ('manual' in item) return { product: null, qty: item.qty ?? 1 }
  if ('p' in item) return { product: item.p, qty: item.qty }
  return { product: item, qty: 1 }
}

export async function addItems(form: OrderForm, c: Catalog, items: ItemInput[]) {
  for (const raw of items) {
    const { product, qty } = normalize(raw)
    if (product) await form.addProduct(product, qty)
    else await form.addManualItem(c.manual.name, qty, c.manual.sale, c.manual.cost)
  }
}

/** Opens "Nova OS" and fills items + responsible employees (+ discount). Does not save. */
export async function fillNewOrder(orders: OrdersPage, c: Catalog, opts: { items: ItemInput[], employees: EmployeeRef[], discount?: number }) {
  const form = await orders.newOrder()
  // The form accepts "Sem cliente" but the server answers 500 (service_orders.client_id is NOT NULL): always pick a customer.
  await form.setClient(c.clients.c1)
  await addItems(form, c, opts.items)
  for (const e of opts.employees) await form.addResponsible(e)
  if (opts.discount) await form.setDiscount(opts.discount)
  return form
}

/** The responsible employee's card in the form: the smallest block holding the name and "Comissão: R$". */
export function responsibleRow(form: OrderForm, employee: EmployeeRef): Locator {
  return form.dialog.locator('div').filter({ hasText: employee.name }).filter({ hasText: /Comissão: R\$/ }).last()
}

/** Commission preview of one responsible: the shown amount and the note (rule / no eligible items / no commission). */
export async function previewOf(form: OrderForm, employee: EmployeeRef): Promise<{ amount: number, note: string | null }> {
  const row = responsibleRow(form, employee)
  await row.waitFor({ timeout: 15_000 })
  const label = await row.getByText(/Comissão: R\$/).first().textContent({ timeout: 10_000 })
  const note = await row.getByText(/Por regra\/categoria|Sem itens elegíveis|Sem comissão/).first().textContent({ timeout: 5_000 }).catch(() => null)
  return { amount: parseBRL(label?.replace('Comissão:', '')), note: note?.trim() ?? null }
}

/** Waits for the preview to settle (the employee's rules arrive through a request) and returns it. */
export async function previewAmount(form: OrderForm, employee: EmployeeRef, expected: number): Promise<{ amount: number, note: string | null }> {
  await expect.poll(async () => (await previewOf(form, employee)).amount, { timeout: 20_000, message: `preview of ${employee.name}` }).toBe(expected)
  return previewOf(form, employee)
}

/**
 * Saves and returns the stored order (looked up by the number shown in the field).
 * Parallel tests see the same "next number"; the loser of the race gets "Número já existe" with another suggestion
 * in the field. In that case it resubmits (the OS-B-03 behaviour) until the modal closes.
 */
export async function saveOrder(form: OrderForm, orders: OrdersPage, shop: Shop) {
  let number = ''
  for (let attempt = 0; attempt < 8; attempt++) {
    number = (await form.number().inputValue()).replace(/^#/, '')
    await form.submit()
    // Nothing for 15 s means the click was lost (before hydration) or the server is slow: click again. The app blocks a
    // second submit while one is in flight (OS-B-23) and the order number is unique, so this cannot create two orders.
    await expect.poll(async () => {
      if (!(await form.dialog.isVisible())) return 'saved'
      const current = (await form.number().inputValue().catch(() => number)).replace(/^#/, '')
      return current !== number ? 'duplicate' : 'waiting'
    }, { timeout: 15_000, message: `saving order ${number}` }).not.toBe('waiting').catch(() => undefined)
    if (!(await form.dialog.isVisible())) break
  }
  await expect(form.dialog).toBeHidden({ timeout: 10_000 })
  const row = await shop.orderByNumber(number)
  return { number, row }
}

/** Total commission of an employee in the order snapshot (sum over the items). */
export function snapshotCommission(row: Record<string, any>, employee: EmployeeRef): number {
  const total = (row.items ?? []).reduce((sum: number, item: any) =>
    sum + (item.commissions ?? []).filter((x: any) => x.employee_id === employee.id).reduce((s: number, x: any) => s + Number(x.amount ?? 0), 0), 0)
  return Number(total.toFixed(2))
}

// ── payment helpers (OS-I): the receipt is always made through the screen ──────────────────────────────────


/**
 * Opens the order detail, clicks "Receber" and confirms the payment plan.
 * `installments` > 1 splits the balance (the first installment is paid now, the others stay pending).
 * `releaseFull` turns on "Liberar 100% da comissão" (a one-way choice for the order).
 */
export async function receivePayment(orders: OrdersPage, number: string, opts: { installments?: number, releaseFull?: boolean } = {}) {
  await orders.search().fill(number)
  await orders.expectCard(number)
  const detail = await orders.openDetail(number)
  const pay = new PaymentDialog(orders.page)
  await clickUntil(() => detail.button('Receber').click(), () => expect(pay.dialog).toBeVisible({ timeout: 4000 }))
  await pay.ready()
  await expect(pay.dialog.getByText('Carregando contas e maquininhas...')).toHaveCount(0, { timeout: 30_000 })
  if (opts.installments && opts.installments > 1) {
    await pay.dialog.getByText('Número de parcelas').locator('xpath=following::button[1]').click()
    await orders.page.getByRole('option', { name: `${opts.installments} parcelas`, exact: true }).click()
  }
  if (opts.releaseFull) await pay.releaseFullSwitch().click()
  await pay.confirm().click()
  await orders.toastText('Pagamento registrado com sucesso')
  await expect(pay.dialog).toBeHidden({ timeout: 15_000 })
  return detail
}

/** Commission records of the order as { employee_id, amount, status }, ordered by amount for stable comparison. */
export async function commissionRecords(shop: Shop, orderId: string) {
  const rows = await shop.commissions(orderId)
  return rows.map(r => ({ employee_id: String(r.employee_id), amount: Number(r.amount), status: String(r.status), id: String(r.id) }))
}

export function amountOf(records: { employee_id: string, amount: number }[], employee: EmployeeRef): number | null {
  const mine = records.filter(r => r.employee_id === employee.id)
  return mine.length ? Number(mine.reduce((s, r) => s + r.amount, 0).toFixed(2)) : null
}

/** Pays (or finishes paying) the first pending installment from the detail's "Parcelas" card. `amount` pays only part of it. */
export async function payFirstInstallment(orders: OrdersPage, detail: { dialog: Locator }, opts: { amount?: number } = {}) {
  const page = orders.page
  const confirm = page.getByRole('dialog', { name: 'Confirmar pagamento' })
  // The installments card comes before the commissions card, so the first "Pagar" belongs to an installment.
  await clickUntil(
    () => detail.dialog.getByRole('button', { name: /^(Pagar|Receber restante)$/ }).first().click(),
    () => expect(confirm).toBeVisible({ timeout: 4000 })
  )
  if (opts.amount !== undefined) {
    const field = confirm.getByText('Valor recebido agora').locator('xpath=following::input[1]')
    await field.fill(opts.amount.toFixed(2).replace('.', ','))
  }
  await confirm.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await orders.toastText('Pagamento registrado com sucesso')
  await expect(confirm).toBeHidden({ timeout: 15_000 })
}
