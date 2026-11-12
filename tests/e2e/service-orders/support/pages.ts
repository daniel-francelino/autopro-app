// Page objects da OS. Seletores por papel/rótulo (como o usuário enxerga a tela).
// Exceção: os botões de ação do card são só ícone (sem nome acessível) e são achados pelo ícone.
// Recomendação ao app: dar aria-label a esses botões (editar, duplicar, cancelar...), aí este arquivo perde o seletor de ícone.
import { expect, type Locator, type Page } from '@playwright/test'
import type { ClientRef, EmployeeRef, ProductRef, VehicleRef } from './catalog'

const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** "R$ 1.400,00" → 1400 */
export function parseBRL(text: string | null | undefined): number {
  const t = String(text ?? '').replace(/[^\d,-]/g, '').replace(',', '.')
  return Number(t)
}

/** Repete a ação até o resultado aparecer: no servidor de dev o primeiro clique pode cair antes da hidratação. */
export async function clickUntil(action: () => Promise<unknown>, done: () => Promise<unknown>, timeout = 90_000) {
  await expect(async () => {
    await action()
    await done()
  }).toPass({ timeout, intervals: [500, 1000, 2000] })
}

export type CardAction = 'receive' | 'nfse' | 'edit' | 'view' | 'quote' | 'duplicate' | 'cancel' | 'delete'
const ICON: Record<CardAction, string> = {
  receive: 'credit-card', nfse: 'file-badge', edit: 'pencil', view: 'eye', quote: 'file-down', duplicate: 'copy', cancel: 'ban', delete: 'trash-2'
}

export class OrdersPage {
  constructor(readonly page: Page) {}

  async open(query = '') {
    await this.page.goto(`/app/service-orders${query}`)
    await expect(this.page.getByRole('heading', { name: 'Ordens de Serviço' })).toBeVisible({ timeout: 90_000 })
  }

  numberLabel(number: string) { return this.page.locator('p', { hasText: `#${number}` }).first() }
  /** Raiz do card da OS. */
  card(number: string) { return this.numberLabel(number).locator('xpath=ancestor::div[contains(@class,"cursor-pointer")][1]') }
  async expectCard(number: string) { await expect(this.numberLabel(number)).toBeVisible({ timeout: 60_000 }) }
  cardAction(number: string, action: CardAction) { return this.card(number).locator(`button:has([class~="i-lucide:${ICON[action]}"])`) }
  advanceButton(number: string, label: 'Abrir OS' | 'Iniciar' | 'Concluir') { return this.card(number).getByRole('button', { name: label }) }
  search() { return this.page.getByRole('textbox', { name: 'Buscar por número ou cliente...' }) }

  async newOrder(): Promise<OrderForm> {
    const dialog = this.page.getByRole('dialog')
    await clickUntil(() => this.page.getByRole('button', { name: 'Nova OS' }).click(), () => expect(dialog).toBeVisible({ timeout: 4000 }))
    const form = new OrderForm(this.page, dialog)
    await form.ready()
    return form
  }

  async editOrder(number: string): Promise<OrderForm> {
    const dialog = this.page.getByRole('dialog')
    await clickUntil(() => this.cardAction(number, 'edit').click(), () => expect(dialog).toBeVisible({ timeout: 4000 }))
    const form = new OrderForm(this.page, dialog)
    await form.ready()
    return form
  }

  async openDetail(number: string): Promise<OrderDetail> {
    const detail = new OrderDetail(this.page)
    await clickUntil(() => this.numberLabel(number).click(), () => expect(detail.dialog).toBeVisible({ timeout: 4000 }))
    await detail.ready()
    return detail
  }

  async toastText(text: string | RegExp) { await expect(this.page.getByText(text).first()).toBeVisible({ timeout: 20_000 }) }
}

export class OrderForm {
  constructor(readonly page: Page, readonly dialog: Locator) {}

  async ready() { await expect(this.dialog.getByRole('alert', { name: 'loading' })).toHaveCount(0, { timeout: 60_000 }) }

  number() { return this.dialog.getByRole('textbox', { name: 'Número da OS' }) }
  discount() { return this.dialog.getByRole('textbox', { name: 'Desconto', exact: true }) }
  submitButton() { return this.dialog.getByRole('button', { name: /Criar OS|Salvar alterações/ }) }

  async setStatus(label: 'Orçamento' | 'Aberta' | 'Em andamento' | 'Aguard. peça' | 'Concluída' | 'Entregue' | 'Cancelada') {
    await this.dialog.getByRole('button', { name: 'Show popup' }).first().click()
    await this.page.getByRole('option', { name: label, exact: true }).click()
  }

  async setClient(client: ClientRef) {
    await this.dialog.getByText('Cliente', { exact: true }).locator('xpath=following::button[1]').click()
    await this.page.getByRole('textbox', { name: /Buscar cliente/ }).fill(client.name)
    await this.page.getByRole('button', { name: client.name }).click()
  }

  async setVehicle(vehicle: VehicleRef) {
    await this.dialog.getByText('Veículo', { exact: true }).locator('xpath=following::button[1]').click()
    await this.page.getByRole('textbox', { name: /Buscar por placa/ }).fill(vehicle.plate)
    await this.page.getByRole('button', { name: new RegExp(re(vehicle.plate)) }).first().click()
  }

  async addProduct(product: ProductRef, qty = 1) {
    const before = await this.itemRows().count()
    await this.dialog.getByRole('button', { name: 'Buscar por nome ou código do produto...' }).click()
    await this.page.getByRole('textbox', { name: 'Buscar por nome ou código do produto...' }).fill(product.name)
    await this.page.getByRole('button', { name: new RegExp(`^${re(product.name)} Código`) }).click()
    await expect(this.itemRows()).toHaveCount(before + 1)
    if (qty !== 1) await this.setQuantity(before, qty)
  }

  async addManualItem(description: string, qty: number, sale: number, cost: number) {
    const before = await this.itemRows().count()
    await this.dialog.getByRole('button', { name: 'Adicionar manual' }).click()
    await expect(this.itemRows()).toHaveCount(before + 1)
    await this.row(before).getByPlaceholder('Descrição do item').fill(description)
    await this.setQuantity(before, qty)
    await this.setMoney(before, 'sale', sale)
    await this.setMoney(before, 'cost', cost)
  }

  /** Linhas da tabela de itens (cada linha tem o campo "Descrição do item"). */
  private itemRows() { return this.dialog.getByRole('row').filter({ has: this.page.getByPlaceholder('Descrição do item') }) }
  row(index: number) { return this.itemRows().nth(index) }
  itemCount() { return this.itemRows().count() }

  async setQuantity(index: number, qty: number) { await this.row(index).getByRole('spinbutton').fill(String(qty)) }
  async setMoney(index: number, field: 'sale' | 'cost', value: number) {
    const box = this.row(index).getByRole('textbox').nth(field === 'sale' ? 1 : 2)
    await box.fill(value.toFixed(2).replace('.', ','))
  }

  async removeItem(index: number) { await this.row(index).locator('button:has([class~="i-lucide:trash-2"])').click() }

  async addResponsible(employee: EmployeeRef) {
    await this.dialog.getByRole('button', { name: 'Adicionar', exact: true }).first().click()
    await this.dialog.getByRole('button', { name: 'Selecione o funcionário' }).last().click()
    await this.page.getByRole('textbox', { name: 'Buscar funcionário...' }).fill(employee.name)
    await this.page.getByRole('button', { name: employee.name }).click()
  }

  async setDiscount(value: number) { await this.discount().fill(value.toFixed(2).replace('.', ',')) }

  /** Valor do resumo financeiro pelo rótulo ("Subtotal", "Custo", "Comissão"...). */
  async summary(label: string): Promise<number> {
    const p = this.dialog.locator('p', { hasText: new RegExp('^\\s*' + re(label) + '\\s*$') }).first()
    await p.waitFor({ timeout: 10_000 })
    return parseBRL(await p.locator('xpath=following::p[1]').textContent({ timeout: 10_000 }))
  }

  async margin(): Promise<number> { return parseBRL(await this.dialog.getByRole('textbox', { name: 'Margem estimada' }).inputValue()) }

  async submit() { await this.submitButton().click() }
}

export class OrderDetail {
  readonly dialog: Locator
  constructor(readonly page: Page) { this.dialog = page.getByRole('dialog', { name: /Detalhes da Ordem de Serviço/ }).or(page.getByRole('dialog').filter({ hasText: 'Detalhes da Ordem de Serviço' })).first() }
  async ready() { await expect(this.dialog.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 }) }
  button(name: string | RegExp) { return this.dialog.getByRole('button', { name, exact: typeof name === 'string' }) }
  async close() { await this.dialog.getByRole('button', { name: 'Fechar' }).click() }
}

export class PaymentDialog {
  readonly dialog: Locator
  constructor(readonly page: Page) { this.dialog = page.getByRole('dialog', { name: 'Processar pagamento' }) }
  async ready() { await expect(this.dialog).toBeVisible({ timeout: 30_000 }) }
  confirm() { return this.dialog.getByRole('button', { name: /Registrar pagamento|Confirmar/ }) }
  releaseFullSwitch() { return this.dialog.getByRole('switch', { name: 'Liberar 100% da comissão' }) }
}
