// Helpers das suítes OS-A (lista), OS-J (relatórios), OS-K (permissões) e OS-L (volume).
// Não editam pages.ts/fixtures.ts: só importam deles.
import { expect, type Locator, type Page } from '@playwright/test'
import { idOf, type ClientRef, type VehicleRef } from './catalog'
import { test as base, type Shop, type World } from './order-fixtures'
import type { OrdersPage } from './pages'
import { clickUntil } from './pages'

export const NL = String.fromCharCode(10)
let seq = 0
const uniq = () => `${Date.now().toString(36)}${(++seq).toString(36)}`

/** Cliente novo só deste teste (a lista da oficina é compartilhada pelos testes do worker, então filtrar por ele isola o resultado). */
export async function freshClient(shop: Shop, label = 'Cliente'): Promise<ClientRef> {
  const name = `${label} ${uniq()}`
  const res = await shop.api.post('/api/clients', { name, person_type: 'pf', phone: '11977770000' })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return { id: idOf(res.body), name, taxId: '' }
}

export async function freshVehicle(shop: Shop, client: ClientRef, brand = 'Ford', model = 'Ka'): Promise<VehicleRef> {
  const plate = `Q${uniq().toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(6, 'X').slice(0, 6)}`
  const res = await shop.api.post('/api/vehicles', { client_id: client.id, license_plate: plate, brand, model, year: 2020 })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return { id: idOf(res.body), plate, label: `${brand} ${model}` }
}

/** Números (sem #) de todos os cards hoje carregados na lista. */
export async function cardNumbers(page: Page): Promise<string[]> {
  const texts = await page.locator('p').filter({ hasText: /^\s*#OS\d+\s*$/ }).allTextContents()
  return texts.map(t => t.replace(/^\s*#/, '').trim())
}

/** Espera a lista convergir para exatamente estes números (ordem livre). */
export async function expectCards(page: Page, expected: string[]) {
  await expect.poll(async () => (await cardNumbers(page)).sort(), { timeout: 20_000, intervals: [300, 600, 1000] }).toEqual([...expected].sort())
}

export type AdvanceKind = 'Abrir OS' | 'Iniciar' | 'Concluir'
const ADVANCE_ICON: Record<AdvanceKind, string> = { 'Abrir OS': 'circle-dot', 'Iniciar': 'wrench', 'Concluir': 'circle-check' }
/** Botão de avançar status do card (só ícone). */
export function advanceButton(orders: OrdersPage, number: string, kind: AdvanceKind): Locator {
  return orders.card(number).locator(`button:has([class~="i-lucide:${ADVANCE_ICON[kind]}"])`)
}

const STATUS_LABEL = ['Orçamento', 'Aberta', 'Em andamento', 'Aguard. peça', 'Concluída', 'Faturada', 'Entregue', 'Cancelada'] as const
export type StatusLabel = typeof STATUS_LABEL[number]
export const STATUS_BY_LABEL: Record<StatusLabel, string> = {
  'Orçamento': 'estimate', 'Aberta': 'open', 'Em andamento': 'in_progress', 'Aguard. peça': 'waiting_for_part',
  'Concluída': 'completed', 'Faturada': 'invoiced', 'Entregue': 'delivered', 'Cancelada': 'cancelled'
}
export const ALL_STATUS_LABELS = [...STATUS_LABEL]

/** Painel de filtros da lista (popover). */
export class ListFilters {
  constructor(readonly page: Page) {}
  trigger() { return this.page.getByRole('button', { name: /^Filtros/ }) }
  panelTitle() { return this.page.getByText('Data de entrada', { exact: true }) }

  async open() {
    if (await this.panelTitle().isVisible().catch(() => false)) return
    await clickUntil(() => this.trigger().click(), () => expect(this.panelTitle()).toBeVisible({ timeout: 3000 }))
  }

  /** Clica no seletor ligado ao rótulo (Status, Cliente, Veículo, Responsável). */
  private selectOf(label: string) { return this.page.getByText(label, { exact: true }).locator('xpath=following::button[1]') }

  async chooseStatus(label: StatusLabel | 'Todos os status') {
    await this.open()
    await this.selectOf('Status').click()
    await this.page.getByRole('option', { name: label, exact: true }).click()
  }

  async chooseSearchable(field: 'Cliente' | 'Veículo' | 'Responsável', search: string, optionName: string | RegExp) {
    await this.open()
    await this.selectOf(field).click()
    await this.page.getByRole('textbox').last().fill(search)
    await this.page.getByRole('option', { name: optionName }).first().click()
  }

  async clear() {
    await this.open()
    await this.page.getByRole('button', { name: 'Limpar' }).click()
  }
}

// ── permissões do papel do `staff` (papel "operador", que nasce SEM permissões) ──
export async function staffRoleId(world: World): Promise<string> {
  const { data, error } = await world.db.from('user_profiles').select('role_id').eq('user_id', world.users.staff.id).single()
  expect(error).toBeNull()
  return data!.role_id as string
}
export async function clearStaffPermissions(world: World) {
  await world.db.from('role_actions').delete().eq('role_id', await staffRoleId(world))
}
/** Substitui as permissões do papel do staff por exatamente estas. Chame ANTES do login (o app lê as permissões no início da sessão). */
export async function setStaffPermissions(world: World, codes: string[]) {
  const roleId = await staffRoleId(world)
  await clearStaffPermissions(world)
  if (codes.length === 0) return
  const { data: actions, error } = await world.db.from('actions').select('id, code').in('code', codes)
  expect(error).toBeNull()
  const missing = codes.filter(c => !(actions ?? []).some(a => a.code === c))
  expect(missing, 'códigos de permissão inexistentes na stack').toEqual([])
  const { error: insErr } = await world.db.from('role_actions').insert((actions ?? []).map(a => ({ role_id: roleId, action_id: a.id, is_granted: true })))
  expect(insErr, JSON.stringify(insErr)).toBeNull()
}

export const test = base.extend<{ staffPerms: (codes: string[]) => Promise<void> }>({
  // Cada teste que mexe nas permissões do staff as DESFAZ no fim (o papel volta a ficar sem nenhuma).
  staffPerms: async ({ world }, use) => {
    await use(codes => setStaffPermissions(world, codes))
    await clearStaffPermissions(world)
  }
})
export { expect }
