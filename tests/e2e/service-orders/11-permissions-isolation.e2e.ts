// OS-K — Permissões e isolamento entre oficinas, pela tela e pela API (docs/testing/e2e-service-orders.md §4).
// O papel do `staff` ("operador") nasce SEM permissões; cada teste concede só o que precisa (`staffPerms`) e o helper desfaz no fim.
import { skipUnlessAuth } from './support/fixtures'
import { expect, freshClient, test } from './support/helpers-list'
import { OrdersPage } from './support/pages'

skipUnlessAuth(test)
test.describe.configure({ timeout: 180_000 })

/** Aceita só recusa explícita do servidor. */
const REFUSED = [401, 403, 404]

async function paidScenario(shop: any, status = 'completed') {
  const c = shop.catalog
  const account = await shop.newAccount(1000)
  const order = await shop.createOrder({ client: await freshClient(shop), vehicle: null, status, items: [{ p: c.products.S1 }] })
  return { account, order }
}

test.describe('OS-K: permissions through the UI', () => {
  test('OS-K-01 without orders.create: no "Nova OS" or "Duplicar"; with the permission they appear', async ({ page, loginAs, shop, staffPerms }) => {
    const c = shop.catalog
    const client = await freshClient(shop)
    const os = await shop.createOrder({ client, vehicle: null, status: 'open', items: [{ p: c.products.S2 }] })
    await staffPerms(['orders.read'])
    await loginAs('staff')
    const orders = new OrdersPage(page)
    await orders.open(`?clientId=${client.id}`)
    await orders.expectCard(os.number)
    await expect(page.getByRole('button', { name: 'Nova OS' })).toHaveCount(0)
    await expect(orders.cardAction(os.number, 'duplicate')).toHaveCount(0)

    await staffPerms(['orders.read', 'orders.create'])
    await page.reload()
    await orders.expectCard(os.number)
    await expect(page.getByRole('button', { name: 'Nova OS' })).toBeVisible({ timeout: 30_000 })
    await expect(orders.cardAction(os.number, 'duplicate')).toBeVisible()
  })

  test('OS-K-02 without orders.update: no Editar, Receber, down payment or status advance (card and detail)', async ({ page, loginAs, shop, staffPerms }) => {
    const c = shop.catalog
    const client = await freshClient(shop)
    const done = await shop.createOrder({ client, vehicle: null, status: 'completed', items: [{ p: c.products.S2 }] })
    const open = await shop.createOrder({ client, vehicle: null, status: 'open', items: [{ p: c.products.S2 }] })
    await staffPerms(['orders.read', 'orders.create', 'orders.cancel', 'orders.delete'])
    await loginAs('staff')
    const orders = new OrdersPage(page)
    await orders.open(`?clientId=${client.id}`)
    await orders.expectCard(done.number)
    for (const n of [done.number, open.number]) {
      await expect(orders.cardAction(n, 'edit')).toHaveCount(0)
      await expect(orders.cardAction(n, 'receive')).toHaveCount(0)
    }
    await expect(orders.card(open.number).locator('button:has([class~="i-lucide:wrench"])')).toHaveCount(0) // "Iniciar"
    const detail = await orders.openDetail(done.number)
    for (const name of ['Receber', 'Receber avulso', 'Editar']) await expect(detail.button(name)).toHaveCount(0)
    await expect(detail.dialog.getByRole('button', { name: 'Receber sinal' })).toHaveCount(0)
  })

  test('OS-K-03 without orders.cancel / orders.delete: no Cancelar OS or Excluir OS; with them they appear', async ({ page, loginAs, shop, staffPerms }) => {
    const c = shop.catalog
    const client = await freshClient(shop)
    const os = await shop.createOrder({ client, vehicle: null, status: 'open', items: [{ p: c.products.S2 }] })
    await staffPerms(['orders.read', 'orders.update', 'orders.create'])
    await loginAs('staff')
    const orders = new OrdersPage(page)
    await orders.open(`?clientId=${client.id}`)
    await orders.expectCard(os.number)
    await expect(orders.cardAction(os.number, 'edit')).toBeVisible() // controle: com update o editar existe
    await expect(orders.cardAction(os.number, 'cancel')).toHaveCount(0)
    await expect(orders.cardAction(os.number, 'delete')).toHaveCount(0)

    await staffPerms(['orders.read', 'orders.update', 'orders.create', 'orders.cancel', 'orders.delete'])
    await page.reload()
    await orders.expectCard(os.number)
    await expect(orders.cardAction(os.number, 'cancel')).toBeVisible({ timeout: 30_000 })
    await expect(orders.cardAction(os.number, 'delete')).toBeVisible()
  })

  test('OS-K-04 without orders.read: the screen says there is no permission and lists no order (characterization: no redirect to /app/forbidden)', async ({ page, loginAs, shop, staffPerms }) => {
    const os = await shop.createOrder({ client: await freshClient(shop), vehicle: null, items: [{ p: shop.catalog.products.S2 }] })
    await staffPerms([])
    await loginAs('staff')
    const orders = new OrdersPage(page)
    await orders.open()
    await expect(page.getByText('Você não tem permissão para visualizar ordens de serviço.')).toBeVisible({ timeout: 30_000 })
    expect(page.url()).toContain('/app/service-orders') // caracterização: o catálogo previa /app/forbidden
    await expect(orders.numberLabel(os.number)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Nova OS' })).toHaveCount(0)
  })

  test('OS-K-04b KF-09 the list API refuses users without orders.read', async ({ apiAs, shop, staffPerms }) => {
    test.fail(true, 'GET /api/service-orders não exige orders.read: devolve a lista a qualquer usuário logado da oficina')
    await shop.createOrder({ client: await freshClient(shop), vehicle: null, items: [{ p: shop.catalog.products.S2 }] })
    await staffPerms([])
    const staff = await apiAs('staff')
    expect(REFUSED).toContain((await staff.get('/api/service-orders')).status)
  })

  test('OS-K-05 receiving actions depend on orders.update (not a financial permission); deleting an installment depends on financial.delete', async ({ page, loginAs, shop, staffPerms }) => {
    const { account, order } = await paidScenario(shop)
    const pay = await shop.api.post(`/api/service-orders/${order.id}/process-payment`, {
      paymentMethod: 'pix', bankAccountId: account.id, installments: [{ amount: order.total, status: 'paid' }]
    })
    expect(pay.status, JSON.stringify(pay.body)).toBe(200)
    const extra = await shop.createOrder({ client: await freshClient(shop), vehicle: null, status: 'completed', items: [{ p: shop.catalog.products.S2 }] })

    await staffPerms(['orders.read', 'orders.update']) // sem nenhuma permissão financeira
    await loginAs('staff')
    const orders = new OrdersPage(page)
    await orders.open()
    await orders.expectCard(extra.number)
    const detail = await orders.openDetail(extra.number)
    // caracterização: quem só tem orders.update já vê "Receber" (o catálogo previa exigir permissão financeira — ver teste abaixo)
    await expect(detail.button('Receber')).toBeVisible()
    await detail.close()

    const paid = await orders.openDetail(order.number)
    await expect(paid.dialog.getByTitle('Excluir parcela')).toHaveCount(0) // exige financial.delete

    await staffPerms(['orders.read', 'orders.update', 'financial.delete'])
    await page.reload()
    const paid2 = await orders.openDetail(order.number)
    await expect(paid2.dialog.getByTitle('Excluir parcela').first()).toBeVisible({ timeout: 30_000 })
  })

  test('OS-K-05b receiving payment should require a financial permission/orders.pay, not only orders.update', async ({ page, loginAs, shop, staffPerms }) => {
    test.fail(true, 'o botão Receber aparece com orders.update; a ação "orders.pay" existe nas permissões, mas nenhuma tela ou rota a usa')
    const os = await shop.createOrder({ client: await freshClient(shop), vehicle: null, status: 'completed', items: [{ p: shop.catalog.products.S2 }] })
    await staffPerms(['orders.read', 'orders.update'])
    await loginAs('staff')
    const orders = new OrdersPage(page)
    await orders.open()
    const detail = await orders.openDetail(os.number)
    await expect(detail.button('Receber')).toHaveCount(0)
  })

  test('OS-K-07 role change is reflected without logging out: granting orders.update makes Editar appear after reload', async ({ page, loginAs, shop, staffPerms }) => {
    const client = await freshClient(shop)
    const os = await shop.createOrder({ client, vehicle: null, status: 'open', items: [{ p: shop.catalog.products.S2 }] })
    await staffPerms(['orders.read'])
    await loginAs('staff')
    const orders = new OrdersPage(page)
    await orders.open(`?clientId=${client.id}`)
    await orders.expectCard(os.number)
    await expect(orders.cardAction(os.number, 'edit')).toHaveCount(0)

    await staffPerms(['orders.read', 'orders.update']) // o admin concede a permissão ao papel
    await page.reload()
    await orders.expectCard(os.number)
    await expect(orders.cardAction(os.number, 'edit')).toBeVisible({ timeout: 30_000 })

    await staffPerms(['orders.read']) // e a retira
    await page.reload()
    await orders.expectCard(os.number)
    await expect(orders.cardAction(os.number, 'edit')).toHaveCount(0, { timeout: 30_000 })
  })
})

test.describe('OS-K: permissions through the API (KF-09)', () => {
  test('OS-K-06 KF-09 receiving payment without permission must be refused (403) and the balance must not change', async ({ apiAs, shop, staffPerms }) => {
    test.fail(true, 'KF-09: process-payment não exige permissão; o usuário sem papel recebe (200) e o saldo muda')
    const { account, order } = await paidScenario(shop)
    await staffPerms([])
    const staff = await apiAs('staff')
    const res = await staff.post(`/api/service-orders/${order.id}/process-payment`, { paymentMethod: 'pix', bankAccountId: account.id, installments: [{ amount: order.total, status: 'paid' }] })
    expect(REFUSED).toContain(res.status)
    expect(await shop.balance(account.id)).toBe(1000)
  })

  test('OS-K-06b KF-09 cancelling the order without orders.cancel must be refused and the order stays open', async ({ apiAs, shop, staffPerms }) => {
    test.fail(true, 'KF-09: cancel.post não exige permissão')
    const { order } = await paidScenario(shop, 'open')
    await staffPerms([])
    const staff = await apiAs('staff')
    expect(REFUSED).toContain((await staff.post(`/api/service-orders/${order.id}/cancel`, {})).status)
    expect((await shop.order(order.id)).status).toBe('open')
  })

  test('OS-K-06c KF-09 deleting the order without orders.delete must be refused and the order stays active', async ({ apiAs, shop, staffPerms }) => {
    test.fail(true, 'KF-09: [id].delete não exige permissão')
    const { order } = await paidScenario(shop, 'open')
    await staffPerms([])
    const staff = await apiAs('staff')
    expect(REFUSED).toContain((await staff.del(`/api/service-orders/${order.id}`)).status)
    expect((await shop.order(order.id)).deleted_at).toBeNull()
  })

  test('OS-K-06d KF-09 creating an order without orders.create must be refused and nothing is saved', async ({ apiAs, shop, staffPerms }) => {
    test.fail(true, 'KF-09: index.post não exige permissão')
    const client = await freshClient(shop)
    await staffPerms([])
    const staff = await apiAs('staff')
    const res = await staff.post('/api/service-orders', { orderData: { client_id: client.id, status: 'open', total_amount: 10, entry_date: new Date().toISOString().slice(0, 10), items: [] } })
    expect(REFUSED).toContain(res.status)
    const { count } = await shop.world.db.from('service_orders').select('id', { count: 'exact', head: true }).eq('client_id', client.id)
    expect(count).toBe(0)
  })
})

test.describe('OS-K: isolation between workshops', () => {
  test('OS-K-08 workshop B cannot see, read, change, receive or cancel the order of workshop A', async ({ page, loginAs, apiAs, shop }) => {
    const { account, order } = await paidScenario(shop, 'open')
    const before = await shop.order(order.id)
    const other = await apiAs('otherOrg')

    // API: leitura
    expect(REFUSED).toContain((await other.get(`/api/service-orders/${order.id}`)).status)
    expect(REFUSED).toContain((await other.get(`/api/service-orders/${order.id}/edit-data`)).status)
    expect(REFUSED).toContain((await other.get(`/api/service-orders/${order.id}/nfse`)).status)
    const list = await other.get('/api/service-orders')
    expect(JSON.stringify(list.body)).not.toContain(order.number)
    // API: escrita (a OS não pode mudar)
    expect(REFUSED).toContain((await other.post('/api/service-orders', { orderId: order.id, orderData: { status: 'cancelled' } })).status)
    expect(REFUSED).toContain((await other.post(`/api/service-orders/${order.id}/cancel`, {})).status)
    expect(REFUSED).toContain((await other.del(`/api/service-orders/${order.id}`)).status)
    const pay = await other.post(`/api/service-orders/${order.id}/process-payment`, { paymentMethod: 'pix', bankAccountId: account.id, installments: [{ amount: order.total, status: 'paid' }] })
    expect(pay.status).toBeGreaterThanOrEqual(400)

    const after = await shop.order(order.id)
    expect({ status: after.status, pay: after.payment_status, total: after.total_amount, deleted: after.deleted_at }).toEqual({ status: before.status, pay: before.payment_status, total: before.total_amount, deleted: null })
    expect(await shop.balance(account.id)).toBe(1000)
    expect((await shop.statements(account.id)).length).toBe(0)

    // tela: a lista da oficina B não traz a OS da A
    await loginAs('otherOrg')
    const orders = new OrdersPage(page)
    await orders.open()
    await expect(page.getByText('Nenhuma ordem de serviço encontrada')).toBeVisible({ timeout: 30_000 })
    await expect(orders.numberLabel(order.number)).toHaveCount(0)
    await orders.open(`?search=${order.number}`)
    await expect(orders.numberLabel(order.number)).toHaveCount(0)
  })

  test('OS-K-09 form pickers show only the own workshop data (client, vehicle, product, employee)', async ({ page, loginAs, apiAs, shop }) => {
    const a = shop.catalog
    const other = await apiAs('otherOrg')
    const tag = Date.now().toString(36)
    const clientB = await other.post('/api/clients', { name: `ClienteB ${tag}`, person_type: 'pf', phone: '11911110000' })
    expect(clientB.status, JSON.stringify(clientB.body)).toBe(200)
    const clientBId = clientB.body.item.id
    const vehB = await other.post('/api/vehicles', { client_id: clientBId, license_plate: `BBB${tag.slice(0, 4).toUpperCase().padEnd(4, '1')}`.slice(0, 7), brand: 'Fiat', model: `ModeloB${tag}`, year: 2020 })
    expect(vehB.status, JSON.stringify(vehB.body)).toBe(200)
    const prodB = await other.post('/api/products', { name: `ProdutoB ${tag}`, code: 900000 + Math.floor(Math.random() * 90000), type: 'unit', unit_sale_price: 10, unit_cost_price: 5, track_inventory: false })
    expect(prodB.status, JSON.stringify(prodB.body)).toBe(200)
    const empB = await other.post('/api/employees', { name: `FuncB ${tag}`, person_type: 'pf', tax_id: '52998224725', phone: '11922220000' })
    expect(empB.status, JSON.stringify(empB.body)).toBe(200)

    await loginAs('otherOrg')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()

    // cliente
    await form.dialog.getByText('Cliente', { exact: true }).locator('xpath=following::button[1]').click()
    await expect(page.getByRole('button', { name: `ClienteB ${tag}` })).toBeVisible({ timeout: 30_000 }) // controle: a lista carregou
    await expect(page.getByRole('button', { name: a.clients.c1.name })).toHaveCount(0)
    await page.getByRole('textbox', { name: /Buscar cliente/ }).fill(a.clients.c1.name)
    await page.waitForTimeout(1500)
    await expect(page.getByRole('button', { name: a.clients.c1.name })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // veículo
    await form.dialog.getByText('Veículo', { exact: true }).locator('xpath=following::button[1]').click()
    await expect(page.getByRole('button', { name: new RegExp(`ModeloB${tag}`) })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: new RegExp(a.vehicles.v1.plate) })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // produto
    await form.dialog.getByRole('button', { name: 'Buscar por nome ou código do produto...' }).click()
    await expect(page.getByRole('button', { name: new RegExp(`^ProdutoB ${tag} Código`) })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: new RegExp(a.products.S1.name) })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // funcionário
    await form.dialog.getByRole('button', { name: 'Adicionar', exact: true }).first().click()
    await form.dialog.getByRole('button', { name: 'Selecione o funcionário' }).last().click()
    await expect(page.getByRole('button', { name: `FuncB ${tag}` })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: a.employees.ana.name })).toHaveCount(0)
  })

  test('OS-K-10 a terminated employee is blocked on the next call and access is deactivated', async ({ page, loginAs, apiAs, shop, staffPerms }) => {
    await staffPerms(['orders.read'])
    const staff = await apiAs('staff')
    expect((await staff.get('/api/service-orders')).status).toBe(200) // controle: antes do desligamento tem acesso

    const db = shop.world.db
    const staffId = shop.world.users.staff.id
    const emp = await shop.api.post('/api/employees', { name: `Desligado ${Date.now().toString(36)}`, person_type: 'pf', tax_id: '52998224725', phone: '11933330000' })
    expect(emp.status, JSON.stringify(emp.body)).toBe(200)
    const employeeId = emp.body.item?.id ?? emp.body.data?.id
    try {
      await db.from('employees').update({ termination_date: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10) }).eq('id', employeeId)
      await db.from('user_profiles').update({ employee_id: employeeId }).eq('user_id', staffId)

      const res = await staff.get('/api/service-orders')
      expect(res.status).toBe(403)
      expect(JSON.stringify(res.body)).toContain('Funcionário sem acesso ativo')
      const { data: profile } = await db.from('user_profiles').select('is_active').eq('user_id', staffId).single()
      expect(profile?.is_active, 'o guard desativa o perfil').toBe(false)

      // tela: com o acesso revogado a lista não é exibida
      await loginAs('staff')
      await page.goto('/app/service-orders')
      await expect(page.getByRole('heading', { name: 'Ordens de Serviço' })).toBeHidden({ timeout: 30_000 }).catch(() => {})
      const cards = await page.locator('p').filter({ hasText: /^\s*#OS\d+\s*$/ }).count()
      expect(cards, 'não deve listar OS para funcionário desligado').toBe(0)
    } finally {
      await db.from('user_profiles').update({ employee_id: null, is_active: true }).eq('user_id', staffId)
    }
  })

  test('OS-K-11 expired session with the modal open: nothing is saved and the user is warned (characterization)', async ({ page, context, loginAs, shop }) => {
    const c = shop.catalog
    const client = await freshClient(shop)
    await loginAs('admin')
    const orders = new OrdersPage(page)
    await orders.open()
    const form = await orders.newOrder()
    await form.setClient(client)
    await form.addProduct(c.products.S2)
    await context.clearCookies() // sessão perdida (token e refresh)
    await form.submit()

    // caracterização: ou mostra o erro e mantém o modal com os dados, ou leva ao login
    await expect.poll(async () => {
      if (page.url().includes('/login')) return 'login'
      if (await page.getByText('Erro ao criar OS').first().isVisible().catch(() => false)) return 'toast'
      return 'aguardando'
    }, { timeout: 30_000 }).not.toBe('aguardando')
    const { count } = await shop.world.db.from('service_orders').select('id', { count: 'exact', head: true }).eq('client_id', client.id)
    expect(count, 'a OS não pode ter sido gravada sem sessão').toBe(0)
    if (!page.url().includes('/login')) await expect(form.dialog).toBeVisible() // não perdeu o que foi digitado
  })
})
