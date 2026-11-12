// OS-A — Lista, busca e filtros (docs/testing/e2e-service-orders.md §4).
// A lista da oficina é compartilhada pelos testes do worker; por isso cada teste cria clientes novos e filtra por eles.
import { skipUnlessAuth } from './support/order-fixtures'
import { settle } from '../support/settle'
import {
  ALL_STATUS_LABELS, advanceButton, cardNumbers, expect, expectCards, freshClient, freshVehicle, ListFilters, STATUS_BY_LABEL, test
} from './support/helpers-list'
import { clickUntil, OrdersPage } from './support/pages'

// search/filter results arrive after a 500 ms debounce plus a server round trip; give them room on a loaded machine
const slowExpect = expect.configure({ timeout: 20_000 })

skipUnlessAuth(test)
test.describe.configure({ timeout: 180_000 })

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

test.describe('OS-A: list, search and filters', () => {
  test('OS-A-01 the order created via UI appears at the top of the list with number, client, vehicle, total and badges', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()
    await form.setClient(c.clients.c1)
    await form.setVehicle(c.vehicles.v1)
    await form.addProduct(c.products.S1)
    const number = (await form.number().inputValue()).replace(/^#/, '')
    await form.submit()
    await orders.toastText('OS criada com sucesso')
    await orders.expectCard(number)

    const card = orders.card(number)
    await expect(card).toContainText(c.clients.c1.name)
    await expect(card).toContainText(c.vehicles.v1.plate)
    await expect(card).toContainText('R$ 1.000,00')
    await expect(card).toContainText('Orçamento')
    await expect(card).toContainText('Pendente')
    // caracterização: a OS mais recente vem primeiro
    expect((await cardNumbers(page))[0]).toBe(number)
    const row = await shop.orderByNumber(number)
    expect(row.client_id).toBe(c.clients.c1.id)
  })

  test('OS-A-02 each status shows the right advance button (Abrir OS, Iniciar, Concluir) and the others show none', async ({ page, loginAs, shop }) => {
    const client = await freshClient(shop)
    const c = shop.catalog
    const byStatus: Record<string, string> = {}
    for (const status of Object.values(STATUS_BY_LABEL)) {
      byStatus[status] = (await shop.createOrder({ client, vehicle: null, status, items: [{ p: c.products.S2 }] })).number
    }
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open(`?clientId=${client.id}`)
    await expectCards(page, Object.values(byStatus))

    await expect(advanceButton(orders, byStatus.estimate!, 'Abrir OS')).toBeVisible()
    await expect(advanceButton(orders, byStatus.open!, 'Iniciar')).toBeVisible()
    await expect(advanceButton(orders, byStatus.in_progress!, 'Concluir')).toBeVisible()
    for (const status of ['waiting_for_part', 'completed', 'invoiced', 'delivered', 'cancelled']) {
      for (const kind of ['Abrir OS', 'Iniciar', 'Concluir'] as const) {
        await expect(advanceButton(orders, byStatus[status]!, kind), `${status} não deveria ter "${kind}"`).toHaveCount(0)
      }
    }
  })

  test('OS-A-03 status filter: each option shows only orders of that status; the counter and URL follow', async ({ page, loginAs, shop }) => {
    const client = await freshClient(shop)
    const c = shop.catalog
    const byLabel: Record<string, string> = {}
    for (const [label, status] of Object.entries(STATUS_BY_LABEL)) {
      byLabel[label] = (await shop.createOrder({ client, vehicle: null, status, items: [{ p: c.products.S2 }] })).number
    }
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open(`?clientId=${client.id}`)
    await expectCards(page, Object.values(byLabel))

    const filters = new ListFilters(page)
    for (const label of ALL_STATUS_LABELS) {
      await filters.chooseStatus(label)
      await expectCards(page, [byLabel[label]!])
      await expect(filters.trigger()).toHaveText(/Filtros \(2\)/) // cliente (da URL) + status
      await slowExpect.poll(() => new URL(page.url()).searchParams.get('status')).toBe(STATUS_BY_LABEL[label])
    }
    await filters.chooseStatus('Todos os status')
    await expectCards(page, Object.values(byLabel))
  })

  test('OS-A-04 client, vehicle and responsible filters; combining two intersects', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const cx = await freshClient(shop, 'Cliente X')
    const cy = await freshClient(shop, 'Cliente Y')
    const vx = await freshVehicle(shop, cx)
    const vy = await freshVehicle(shop, cy)
    const o1 = await shop.createOrder({ client: cx, vehicle: vx, status: 'open', items: [{ p: c.products.S2 }], employees: [c.employees.ana] })
    const o2 = await shop.createOrder({ client: cx, vehicle: vx, status: 'open', items: [{ p: c.products.S2 }], employees: [c.employees.bruno] })
    const o3 = await shop.createOrder({ client: cy, vehicle: vy, status: 'open', items: [{ p: c.products.S2 }], employees: [c.employees.ana] })

    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const filters = new ListFilters(page)

    await filters.chooseSearchable('Cliente', cx.name, cx.name)
    await expectCards(page, [o1.number, o2.number])
    await filters.chooseSearchable('Responsável', c.employees.bruno.name, c.employees.bruno.name) // interseção
    await expectCards(page, [o2.number])
    await filters.clear()
    await filters.chooseSearchable('Veículo', vy.plate, new RegExp(vy.plate))
    await expectCards(page, [o3.number])
    await filters.clear()
    await filters.chooseSearchable('Cliente', cx.name, cx.name)
    await filters.chooseSearchable('Responsável', c.employees.ana.name, c.employees.ana.name)
    await expectCards(page, [o1.number])
  })

  test('OS-A-05 period filter (via URL): inclusive limits, and a single bound does not filter', async ({ page, loginAs, shop }) => {
    const client = await freshClient(shop)
    const c = shop.catalog
    const mk = (entryDate: string) => shop.createOrder({ client, vehicle: null, entryDate, items: [{ p: c.products.S2 }] })
    const [d1, d2, d3] = [day(-5), day(-3), day(-1)]
    const [o1, o2, o3] = [await mk(d1), await mk(d2), await mk(d3)]
    await loginAs('admin')
    const orders = new OrdersPage(page)

    await orders.open(`?clientId=${client.id}&dateFrom=${d2}&dateTo=${d2}`)
    await expectCards(page, [o2.number]) // um dia só: inclusivo nos dois lados
    await orders.open(`?clientId=${client.id}&dateFrom=${d1}&dateTo=${d2}`)
    await expectCards(page, [o1.number, o2.number])
    await orders.open(`?clientId=${client.id}&dateFrom=${d2}&dateTo=${d3}`)
    await expectCards(page, [o2.number, o3.number])
    // caracterização: com só um extremo preenchido a tela NÃO filtra por data (a API exige os dois)
    await orders.open(`?clientId=${client.id}&dateFrom=${d3}`)
    await expectCards(page, [o1.number, o2.number, o3.number])
    // período sem OS
    await orders.open(`?clientId=${client.id}&dateFrom=${day(-30)}&dateTo=${day(-20)}`)
    await expectCards(page, [])
  })

  test('OS-A-06 "Limpar" resets filters, counter and URL', async ({ page, loginAs, shop }) => {
    const client = await freshClient(shop)
    const c = shop.catalog
    const open = await shop.createOrder({ client, vehicle: null, status: 'open', items: [{ p: c.products.S2 }] })
    const done = await shop.createOrder({ client, vehicle: null, status: 'completed', items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open(`?clientId=${client.id}&status=open`)
    await expectCards(page, [open.number])
    const filters = new ListFilters(page)
    await expect(filters.trigger()).toHaveText(/Filtros \(2\)/)
    await filters.clear()
    // sem o filtro de cliente a lista inclui OS de outros testes: basta conter as duas
    await slowExpect.poll(async () => { const n = await cardNumbers(page); return n.includes(open.number) && n.includes(done.number) }).toBe(true)
    await expect(filters.trigger()).toHaveText(/^Filtros$/)
    await slowExpect.poll(() => new URL(page.url()).search).toBe('')
  })

  test('OS-A-07 the URL is the state: opening with filters in the URL applies them to the controls and reload keeps them', async ({ page, loginAs, shop }) => {
    const client = await freshClient(shop)
    const c = shop.catalog
    const open = await shop.createOrder({ client, vehicle: null, status: 'open', items: [{ p: c.products.S2 }] })
    await shop.createOrder({ client, vehicle: null, status: 'completed', items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open(`?status=open&clientId=${client.id}`)
    await expectCards(page, [open.number])
    const filters = new ListFilters(page)
    await expect(filters.trigger()).toHaveText(/Filtros \(2\)/)
    await filters.open()
    await expect(page.getByRole('button', { name: 'Show popup' }).filter({ hasText: 'Aberta' })).toBeVisible() // the status picker shows the active option
    await expect(page.getByRole('button', { name: 'Show popup' }).filter({ hasText: client.name })).toBeVisible()

    await page.reload()
    await expectCards(page, [open.number])
    await expect(new ListFilters(page).trigger()).toHaveText(/Filtros \(2\)/)
  })

  test('OS-A-08 search by number: only the searched order, after the typing delay, and the URL carries the term', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const a = await shop.createOrder({ client: await freshClient(shop), vehicle: null, items: [{ p: c.products.S2 }] })
    const b = await shop.createOrder({ client: await freshClient(shop), vehicle: null, items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    await orders.expectCard(a.number)
    await orders.search().fill(a.number)
    await slowExpect.poll(async () => (await cardNumbers(page)).includes(a.number)).toBe(true)
    await slowExpect.poll(async () => (await cardNumbers(page)).includes(b.number)).toBe(false)
    for (const n of await cardNumbers(page)) expect(n.toLowerCase()).toContain(a.number.toLowerCase())
    await slowExpect.poll(() => new URL(page.url()).searchParams.get('search')).toBe(a.number)
    await orders.search().fill('')
    await slowExpect.poll(async () => (await cardNumbers(page)).includes(b.number)).toBe(true)
  })

  test('OS-A-09 client name search ignores accents and case (José d\'Ávila); by plate and phone finds nothing (characterization)', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    const order = await shop.createOrder({ client: c.clients.c3, vehicle: null, items: [{ p: c.products.S2 }] })
    const withPlate = await shop.createOrder({ client: c.clients.c1, vehicle: c.vehicles.v1, items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    await orders.expectCard(order.number)

    const buscar = async (termo: string) => { await orders.search().fill(termo) }
    await buscar(c.clients.c3.name) // nome completo, com acento e apóstrofo
    await slowExpect.poll(async () => (await cardNumbers(page)).includes(order.number)).toBe(true)
    await buscar(c.clients.c3.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')) // sem acento e minúsculo
    await slowExpect.poll(async () => (await cardNumbers(page)).includes(order.number)).toBe(true)
    await buscar('d\'avila')
    await slowExpect.poll(async () => (await cardNumbers(page)).includes(order.number)).toBe(true)
    // caracterização: a busca da lista cobre só número e nome do cliente
    await buscar(c.vehicles.v1.plate)
    await slowExpect.poll(async () => (await cardNumbers(page)).includes(withPlate.number)).toBe(false)
    await buscar('11988880003') // telefone do cliente 3
    await slowExpect.poll(async () => (await cardNumbers(page)).includes(order.number)).toBe(false)
  })

  test('OS-A-10 special characters in the search cause no error and do not return everything', async ({ page, loginAs, shop }) => {
    const c = shop.catalog
    await shop.createOrder({ client: c.clients.c3, vehicle: null, items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const statuses: number[] = []
    for (const termo of ['%', '_', ',', ')', '(', '"', '*', '\\', '\'; drop table service_orders; --', '.*']) {
      const [response] = await Promise.all([
        page.waitForResponse(r => r.url().includes('/api/service-orders') && r.request().method() === 'GET' && r.url().includes('searchTerm='), { timeout: 45_000 }),
        orders.search().fill(termo)
      ])
      statuses.push(response.status())
      await settle(page) // let the list render the result
      // nenhuma OS tem esses caracteres no número; só o apóstrofo do cliente 3 pode casar
      const shown = await cardNumbers(page)
      const total = await shop.world.db.from('service_orders').select('id', { count: 'exact', head: true }).eq('organization_id', shop.world.orgA).is('deleted_at', null)
      expect(shown.length, `"${termo}" trouxe tudo`).toBeLessThan(total.count ?? 0)
    }
    expect(statuses.every(s => s === 200), `status HTTP: ${statuses.join(',')}`).toBe(true)
    await expect(page.getByText(/erro/i).first()).toHaveCount(0)
  })

  test('OS-A-11 empty state: no result shows the message and "Limpar" stays available', async ({ page, loginAs, shop }) => {
    const client = await freshClient(shop)
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open(`?clientId=${client.id}&status=open`)
    await expect(page.getByText('Nenhuma ordem de serviço encontrada')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Crie uma OS ou ajuste os filtros para continuar.')).toBeVisible()
    const filters = new ListFilters(page)
    await filters.open()
    await expect(page.getByRole('button', { name: 'Limpar' })).toBeVisible()
  })

  test('OS-A-14 delete removes it from the list (soft delete in the DB) and cancel keeps it visible with the "Cancelada" badge', async ({ page, loginAs, shop }) => {
    const client = await freshClient(shop)
    const c = shop.catalog
    const toDelete = await shop.createOrder({ client, vehicle: null, status: 'open', items: [{ p: c.products.S2 }] })
    const toCancel = await shop.createOrder({ client, vehicle: null, status: 'open', items: [{ p: c.products.S2 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open(`?clientId=${client.id}`)
    await expectCards(page, [toDelete.number, toCancel.number])

    const confirmDelete = page.getByRole('button', { name: 'Excluir OS', exact: true })
    await clickUntil(() => orders.cardAction(toDelete.number, 'delete').click(), () => expect(confirmDelete).toBeVisible({ timeout: 4000 }))
    await confirmDelete.click()
    await expectCards(page, [toCancel.number])
    const deleted = await shop.order(toDelete.id)
    expect(deleted.deleted_at, 'soft delete: a linha continua com deleted_at').not.toBeNull()

    const confirmCancel = page.getByRole('button', { name: 'Cancelar OS', exact: true })
    await clickUntil(() => orders.cardAction(toCancel.number, 'cancel').click(), () => expect(confirmCancel).toBeVisible({ timeout: 4000 }))
    await confirmCancel.click()
    await orders.toastText('OS cancelada')
    await expectCards(page, [toCancel.number])
    await expect(orders.card(toCancel.number)).toContainText('Cancelada')
    expect((await shop.order(toCancel.id)).status).toBe('cancelled')
  })

  test.skip('OS-A-15 export CSV: the list has no export button (the /api/service-orders/export-csv route exists, but no screen uses it)', () => {})

  test('OS-A-16 @mobile list on mobile: readable cards and no horizontal scroll', async ({ page, loginAs, shop }) => {
    const client = await freshClient(shop)
    const c = shop.catalog
    const os = await shop.createOrder({ client, vehicle: null, items: [{ p: c.products.S1 }] })
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open(`?clientId=${client.id}`)
    await orders.expectCard(os.number)
    await expect(orders.card(os.number)).toContainText('R$ 1.000,00')
    await expect(orders.card(os.number)).toContainText(client.name)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'rolagem horizontal').toBeLessThanOrEqual(1)
  })
})
