// Money helpers (OS-F, OS-G, OS-H): payment modal, installments card, down-payment/extra-payment modals,
// API setup shortcuts and database reads. The tested ACTION is always done through the UI; the API only prepares state.
import { expect, type Locator, type Page } from '@playwright/test'
import { money, type Shop } from './order-fixtures'
import { OrdersPage, OrderDetail, parseBRL } from './pages'

export type MethodLabel = 'Pix' | 'Dinheiro' | 'Cartão de crédito' | 'Cartão de débito' | 'Boleto' | 'Transferência' | 'Cheque'
/** Label shown on screen → value stored in the database. */
export const METHOD_VALUE: Record<MethodLabel, string> = {
  Pix: 'pix', Dinheiro: 'cash', 'Cartão de crédito': 'credit_card', 'Cartão de débito': 'debit_card', Boleto: 'bank_slip', Transferência: 'transfer', Cheque: 'check'
}

/** Clicks until the dialog is visible, but never re-clicks while it is already open (the dev server can be slow to render modals). */
export async function openUntilVisible(click: () => Promise<unknown>, dialog: Locator) {
  await expect(async () => {
    if (!(await dialog.isVisible())) await click()
    await expect(dialog).toBeVisible({ timeout: 15_000 })
  }).toPass({ timeout: 180_000, intervals: [1000, 3000] })
}

/** Opens a select ("Show popup" button) and picks the option by exact text. */
export async function choose(page: Page, trigger: Locator, label: string) {
  await trigger.click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

/** Opens the list already filtered by number and enters the order detail. */
export async function openOrder(page: Page, number: string): Promise<{ orders: OrdersPage, detail: OrderDetail }> {
  const orders = new OrdersPage(page)
  await orders.open(`?search=${encodeURIComponent(number)}`)
  await orders.expectCard(number)
  const detail = new OrderDetail(page)
  await openUntilVisible(() => orders.numberLabel(number).click(), detail.dialog)
  await detail.ready()
  return { orders, detail }
}

/** PAYMENT status badge in the detail header ("Pendente" | "Parcial" | "Pago"). */
export function paymentBadge(detail: OrderDetail) { return detail.dialog.getByText(/^(Pendente|Parcial|Pago)$/).first() }
export async function expectPaymentBadge(detail: OrderDetail, label: 'Pendente' | 'Parcial' | 'Pago') {
  await expect(paymentBadge(detail)).toHaveText(label, { timeout: 20_000 })
}

// ───────────────────────── "Processar pagamento" modal ─────────────────────────
export class PayModal {
  readonly dialog: Locator
  constructor(readonly page: Page) { this.dialog = page.getByRole('dialog', { name: 'Processar pagamento' }) }

  async openFrom(detail: OrderDetail) {
    await openUntilVisible(() => detail.button('Receber').click(), this.dialog)
    await expect(this.dialog.getByText('Carregando contas e maquininhas...')).toHaveCount(0, { timeout: 30_000 })
  }

  popups() { return this.dialog.getByRole('button', { name: 'Show popup' }) }
  /** Default values for the lines: [0] account, [1] payment method. */
  async setDefaultAccount(name: string) { await choose(this.page, this.popups().nth(0), name) }
  async setDefaultMethod(label: MethodLabel) { await choose(this.page, this.popups().nth(1), label) }
  async setInstallmentCount(n: number) {
    await choose(this.page, this.popups().filter({ hasText: /parcelas?$/ }).first(), n === 1 ? '1 parcela' : `${n} parcelas`)
  }
  async toggleDownPayment(amount: number) {
    await this.dialog.getByRole('switch', { name: 'Receber entrada' }).click()
    await this.dialog.getByLabel('Valor da entrada').fill(brl(amount))
  }
  releaseFull() { return this.dialog.getByRole('switch', { name: 'Liberar 100% da comissão' }) }

  /** Plan line: 'entrada' (down payment) or the installment number (1, 2, 3...). */
  row(n: number | 'entrada') {
    const text = n === 'entrada' ? /Entrada/ : new RegExp(`${n}ª parcela`)
    return this.dialog.locator('div.border-b').filter({ hasText: text })
  }
  private rowPopups(n: number | 'entrada') { return this.row(n).getByRole('button', { name: 'Show popup' }) }
  async setRowAmount(n: number | 'entrada', value: number) { await this.row(n).getByRole('textbox').first().fill(brl(value)) }
  async rowAmount(n: number | 'entrada') { return parseBRL(await this.row(n).getByRole('textbox').first().inputValue()) }
  async setRowStatus(n: number, label: 'Pago' | 'Pendente') { await choose(this.page, this.rowPopups(n).nth(0), label) }
  async setRowMethod(n: number | 'entrada', label: MethodLabel) { await choose(this.page, this.rowPopups(n).nth(n === 'entrada' ? 0 : 1), label) }
  async setRowAccount(n: number | 'entrada', name: string) { await choose(this.page, this.rowPopups(n).nth(n === 'entrada' ? 1 : 2), name) }

  /** "Total das linhas" and "Saldo a receber" shown on screen. */
  async rowsTotal() { return parseBRL(await this.dialog.getByText('Total das linhas:').locator('strong').textContent({ timeout: 10_000 })) }
  /** Waits (retrying) until the total of the lines shows the expected value. */
  async expectRowsTotal(value: number) { await expect.poll(() => this.rowsTotal(), { timeout: 15_000 }).toBe(value) }
  async balanceDue() { return parseBRL(await this.dialog.getByText('Saldo a receber:').locator('strong').textContent({ timeout: 10_000 })) }

  confirm() { return this.dialog.getByRole('button', { name: /^(Registrar pagamento|Confirmar)$/ }) }
  async submit() { await this.confirm().click() }
}

/** In full: sets the account and confirms (default method = Pix). */
export async function payInFull(page: Page, detail: OrderDetail, accountName: string, method?: MethodLabel) {
  const pay = new PayModal(page)
  await pay.openFrom(detail)
  await pay.setDefaultAccount(accountName)
  if (method) await pay.setDefaultMethod(method)
  await pay.setRowAccount(1, accountName)
  await pay.submit()
  return pay
}

export const brl = (n: number) => n.toFixed(2).replace('.', ',')

// ───────────────────────── installments card (detail) ─────────────────────────
export class InstallmentsCard {
  constructor(readonly page: Page, readonly detail: OrderDetail) {}
  /** Installment card by exact label: "Parcela 2", "Entrada", "Avulso". */
  card(label: string) { return this.detail.dialog.locator('div.rounded-lg.border').filter({ has: this.page.getByText(label, { exact: true }) }) }
  status(label: string) { return this.card(label).getByText(/^(Pago|Parcial|Pendente|Atrasado)$/).first() }
  async expectStatus(label: string, status: 'Pago' | 'Parcial' | 'Pendente' | 'Atrasado') { await expect(this.status(label)).toHaveText(status, { timeout: 20_000 }) }
  title() { return this.detail.dialog.getByRole('heading', { name: /^InstallmentsCard \(\d+\)$/ }) }

  confirmDialog() { return this.page.getByRole('dialog', { name: 'Confirmar pagamento' }) }
  /** Pays (all or part of) an installment via the UI: "Pagar"/"Receber restante" button → "Confirmar pagamento" modal. */
  async pay(label: string, opts: { amount?: number, account: string, method?: MethodLabel }) {
    const dlg = this.confirmDialog()
    await openUntilVisible(() => this.card(label).getByRole('button', { name: /^(Pagar|Receber restante)$/ }).click(), dlg)
    await expect(dlg.getByText('Carregando')).toHaveCount(0, { timeout: 20_000 })
    if (opts.amount !== undefined) await dlg.getByLabel('Valor recebido agora').fill(brl(opts.amount))
    await choose(this.page, dlg.getByRole('button', { name: 'Show popup' }).nth(0), opts.account)
    if (opts.method) await choose(this.page, dlg.getByRole('button', { name: 'Show popup' }).nth(1), opts.method)
    await dlg.getByRole('button', { name: 'Confirmar', exact: true }).click()
  }

  async openDelete(label: string) {
    const dlg = this.page.getByRole('dialog', { name: 'Excluir parcela' })
    await openUntilVisible(() => this.card(label).locator('button:has([class~="i-lucide:trash-2"])').click(), dlg)
    return dlg
  }
  async openEdit(label: string) {
    const dlg = this.page.getByRole('dialog', { name: 'Editar parcela' })
    await openUntilVisible(() => this.card(label).locator('button:has([class~="i-lucide:pencil"])').click(), dlg)
    return dlg
  }
  async openUndo(label: string) {
    const dlg = this.page.getByRole('dialog', { name: 'Cancelar recebimento' })
    const card = this.card(label)
    await card.getByRole('button', { name: /Ver recebimentos/ }).click()
    await openUntilVisible(() => card.locator('button:has([class~="i-lucide:undo-2"])').first().click(), dlg)
    return dlg
  }
}

// ───────────────────────── down-payment and extra-payment modals ─────────────────────────
export async function openHeaderModal(page: Page, detail: OrderDetail, button: 'Receber sinal' | 'Receber avulso', title: string) {
  const dlg = page.getByRole('dialog', { name: title })
  await openUntilVisible(() => detail.button(button).click(), dlg)
  await expect(dlg.getByText('Carregando')).toHaveCount(0, { timeout: 20_000 })
  return dlg
}
export async function fillCashModal(page: Page, dlg: Locator, o: { amountLabel: string, amount?: number, account?: string, method?: MethodLabel }) {
  if (o.amount !== undefined) await dlg.getByLabel(o.amountLabel).fill(brl(o.amount))
  if (o.account) await choose(page, dlg.getByRole('button', { name: 'Show popup' }).nth(0), o.account)
  if (o.method) await choose(page, dlg.getByRole('button', { name: 'Show popup' }).nth(1), o.method)
}

// ───────────────────────── API setup ─────────────────────────
export interface PlanLine { amount: number, status?: 'paid' | 'pending', due_date?: string, bank_account_id?: string, payment_method?: string, kind?: string }

/** Receives the order via API (setup): each paid line moves the account just like the UI does. */
export async function apiProcessPayment(shop: Shop, orderId: string, accountId: string, lines: PlanLine[], extra: Record<string, unknown> = {}) {
  const res = await shop.api.post(`/api/service-orders/${orderId}/process-payment`, { paymentMethod: 'pix', bankAccountId: accountId, installments: lines, ...extra })
  expect(res.status, `process-payment: ${JSON.stringify(res.body)}`).toBe(200)
}
export async function apiDownPayment(shop: Shop, orderId: string, accountId: string, amount: number) {
  const res = await shop.api.post(`/api/service-orders/${orderId}/down-payment`, { amount, paymentMethod: 'pix', bankAccountId: accountId, paymentDate: new Date().toISOString().slice(0, 10) })
  expect(res.status, `down-payment: ${JSON.stringify(res.body)}`).toBe(200)
}

/** Completed order + a new account (balance 1,000 by default), ready to be paid. */
export async function paidSetup(shop: Shop, opts: { total?: number, status?: string, balance?: number } = {}) {
  const total = opts.total ?? 300
  const acc = await shop.newAccount(opts.balance ?? 1000)
  const c = shop.catalog
  // Manual item priced at the total (no commission, no category): isolates the money from the commission rules.
  const os = await shop.createOrder({ status: opts.status ?? 'completed', items: [{ p: 'manual', price: total, cost: 0 }] })
  expect(os.total).toBe(total)
  return { acc, os, c }
}

// ───────────────────────── database reads ─────────────────────────
export async function transactions(shop: Shop, orderId: string) {
  const { data } = await shop.world.db.from('financial_transactions').select('id, type, status, amount, bank_account_id, payment_method, deleted_at').eq('service_order_id', orderId)
  return (data ?? []).filter(t => !t.deleted_at).map(t => ({ ...t, amount: money(Number(t.amount)) }))
}
export const sum = (xs: number[]) => money(xs.reduce((a, b) => a + b, 0))
export async function installmentsOf(shop: Shop, orderId: string) {
  return (await shop.installments(orderId)).map(i => ({ ...i, amount: money(Number(i.amount)) }))
}

/** Minimal order in shop B (no bank accounts, no catalog). The API refuses orders without a client (500), so one is created first. */
export async function orderInOtherShop(api: { post: (u: string, d?: unknown) => Promise<{ status: number, body: any }> }, status = 'completed', total = 100) {
  const client = await api.post('/api/clients', { name: `Cliente B ${Date.now()}`, person_type: 'pf', phone: '11999990000' })
  expect(client.status, JSON.stringify(client.body)).toBe(200)
  const res = await api.post('/api/service-orders', {
    orderData: {
      client_id: String(client.body.item?.id ?? client.body.data?.id), status, entry_date: new Date().toISOString().slice(0, 10),
      total_amount: total, total_cost_amount: 0, discount: 0, payment_status: 'pending', responsible_employees: [],
      items: [{ name: 'Serviço B', description: 'Serviço B', quantity: 1, unit_price: total, total_price: total, total_amount: total, cost_price: 0, cost_amount: 0, source: 'manual' }]
    }
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return { id: String(res.body.order.id), number: String(res.body.order.number) }
}
