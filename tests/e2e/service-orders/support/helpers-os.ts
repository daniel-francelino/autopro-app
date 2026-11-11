// Helpers for the creation/status/detail specs (OS-B, OS-D, OS-E). Reuses pages.ts/fixtures.ts without changing them.
import { expect, type Locator, type Page } from '@playwright/test'
import { clickUntil, type OrderForm, type OrdersPage } from './pages'
import type { ProductRef } from './catalog'
import type { Shop } from './fixtures'

/** The card's status-advance buttons are icon-only (the tooltip only shows on hover). */
const ADVANCE_ICON = { 'Abrir OS': 'circle-dot', 'Iniciar': 'wrench', 'Concluir': 'circle-check' } as const
export type AdvanceLabel = keyof typeof ADVANCE_ICON

/** Card button by lucide icon name (e.g. 'hand-coins', 'credit-card'). */
export function cardIcon(orders: OrdersPage, number: string, icon: string): Locator {
  return orders.card(number).locator(`button:has([class~="i-lucide:${icon}"])`)
}
export function advanceButton(orders: OrdersPage, number: string, label: AdvanceLabel): Locator {
  return cardIcon(orders, number, ADVANCE_ICON[label])
}
/** How many advance buttons (any of the three) the card shows. */
export async function advanceCount(orders: OrdersPage, number: string): Promise<number> {
  return Object.values(ADVANCE_ICON).reduce(async (acc, icon) => (await acc) + await cardIcon(orders, number, icon).count(), Promise.resolve(0))
}

/** Windows opened by the app (the PDF when an order is completed) are irrelevant to the test: close them so they do not pile up. */
export function ignorePopups(page: Page) {
  page.context().on('page', (p) => { if (p !== page) void p.close().catch(() => {}) })
}

/** Confirmation modal (AppConfirmModal): the title is the dialog name; the confirm button carries the given label. */
export function confirmDialog(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: title })
  return {
    dialog,
    async confirm(label = title) { await dialog.getByRole('button', { name: label, exact: true }).click() },
    async dismiss() { await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click() }
  }
}

export async function openConfirm(orders: OrdersPage, number: string, icon: 'ban' | 'trash-2', title: 'Cancelar OS' | 'Excluir OS') {
  const confirm = confirmDialog(orders.page, title)
  await clickUntil(() => cardIcon(orders, number, icon).click(), () => expect(confirm.dialog).toBeVisible({ timeout: 4000 }))
  return confirm
}

/** How many active orders of workshop A match a column filter. */
export async function countOrders(shop: Shop, column: string, value: string | number): Promise<number> {
  const { count, error } = await shop.world.db.from('service_orders').select('id', { count: 'exact', head: true })
    .eq('organization_id', shop.world.orgA).eq(column, value).is('deleted_at', null)
  expect(error).toBeNull()
  return count ?? 0
}
export async function countAllOrders(shop: Shop): Promise<number> {
  const { count, error } = await shop.world.db.from('service_orders').select('id', { count: 'exact', head: true })
    .eq('organization_id', shop.world.orgA).is('deleted_at', null)
  expect(error).toBeNull()
  return count ?? 0
}

/** Receives the whole order in cash via API (setup: what the test exercises comes afterwards). */
export async function payInFull(shop: Shop, orderId: string, accountId: string, total: number) {
  const res = await shop.api.post(`/api/service-orders/${orderId}/process-payment`, {
    paymentMethod: 'pix', bankAccountId: accountId, installments: [{ amount: total, status: 'paid' }]
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

export const dateBR = (iso: string) => iso.split('-').reverse().join('/')
export const num = (s: string) => Number(s.replace(/\D/g, ''))

/** The detail loads its cards in parts (skeleton "loading" alerts): only read values after they are gone. */
export async function detailLoaded(detail: { dialog: Locator }) {
  await expect(detail.dialog.getByRole('alert', { name: 'loading' })).toHaveCount(0, { timeout: 45_000 })
}

/** Value from the detail's "Resumo Financeiro" by label (the paragraph right after the label). */
export async function detailMoney(detail: { dialog: Locator }, label: string): Promise<number> {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const p = detail.dialog.locator('p', { hasText: new RegExp('^\\s*' + escaped + '\\s*$') }).first()
  await p.waitFor({ timeout: 10_000 })
  const t = await p.locator('xpath=following::p[1]').textContent({ timeout: 10_000 })
  return Number(String(t ?? '').replace(/[^\d,-]/g, '').replace(',', '.'))
}

/** Toast text on screen. The default 20 s of OrdersPage.toastText is short when several runs share the dev server. */
export async function expectToast(page: Page, text: string | RegExp, timeout = 60_000) {
  await expect(page.getByText(text).first()).toBeVisible({ timeout })
}

/**
 * Adds a group product (kit) to the order form. A group expands into one row per group item,
 * so the row count grows by `rows`, not by one (OrderForm.addProduct only expects +1).
 */
export async function addGroupProduct(form: OrderForm, product: ProductRef, rows: number) {
  const before = await form.itemCount()
  await form.dialog.getByRole('button', { name: 'Buscar por nome ou código do produto...' }).click()
  await form.page.getByRole('textbox', { name: 'Buscar por nome ou código do produto...' }).fill(product.name)
  await form.page.getByRole('button', { name: new RegExp(`^${product.name} Código`) }).click()
  await expect.poll(() => form.itemCount()).toBe(before + rows)
}
