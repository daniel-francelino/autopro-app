// Fixtures da suíte de OS: catálogo fixo por worker + "shop" (atalhos de preparação e leitura de banco por teste).
// Preparação (criar OS, conta bancária) é por API; a AÇÃO testada é sempre feita pela tela.
import { request as pwRequest } from '@playwright/test'
import { Api, expect, loginViaApi, skipUnlessAuth, test as base, type Page, type World } from '../../support/auth-fixtures'
import { buildCatalog, idOf, type Catalog, type ClientRef, type EmployeeRef, type ProductRef, type VehicleRef } from './catalog'

export { expect, skipUnlessAuth }
export type { Catalog, Page, World }

const PORT = Number(process.env.E2E_PORT ?? 3100)
const HOST = process.env.E2E_SERVER === 'prod' ? '127.0.0.1' : 'localhost'
const appBaseUrl = () => `http://${HOST}:${PORT}`

export const money = (n: number) => Number(Number(n).toFixed(2))
export const today = () => new Date().toISOString().slice(0, 10)

// ── montagem de OS por API ──
export interface ItemSpec { p: ProductRef | 'manual', qty?: number, price?: number, cost?: number }
export interface OrderSpec {
  client?: ClientRef | null
  vehicle?: VehicleRef | null
  status?: string
  items?: ItemSpec[]
  employees?: EmployeeRef[]
  discount?: number
  entryDate?: string
}

export function buildOrderData(c: Catalog, spec: OrderSpec) {
  const items = (spec.items ?? []).map(({ p, qty = 1, price, cost }) => {
    const base = p === 'manual' ? { id: null, name: c.manual.name, categoryId: null, categoryName: null, sale: c.manual.sale, cost: c.manual.cost } : p
    const unit = price ?? base.sale
    const unitCost = cost ?? base.cost
    return {
      name: base.name, description: base.name, quantity: qty,
      unit_price: unit, total_price: money(unit * qty), total_amount: money(unit * qty),
      cost_price: money(unitCost * qty), cost_amount: money(unitCost * qty),
      product_id: base.id, category_id: base.categoryId, category_name: base.categoryName,
      source: p === 'manual' ? 'manual' : 'catalog'
    }
  })
  const subtotal = money(items.reduce((s, i) => s + i.total_price, 0))
  const discount = spec.discount ?? 0
  return {
    client_id: spec.client === undefined ? c.clients.c1.id : (spec.client?.id ?? null),
    vehicle_id: spec.vehicle === undefined ? c.vehicles.v1.id : (spec.vehicle?.id ?? null),
    status: spec.status ?? 'completed',
    entry_date: spec.entryDate ?? today(),
    items,
    responsible_employees: (spec.employees ?? []).map(e => ({ employee_id: e.id })),
    discount,
    total_amount: money(Math.max(subtotal - discount, 0)),
    total_cost_amount: money(items.reduce((s, i) => s + i.cost_price, 0)),
    payment_status: 'pending'
  }
}

export interface Shop {
  api: Api
  world: World
  catalog: Catalog
  /** Conta bancária nova com saldo conhecido. */
  newAccount: (balance?: number, name?: string) => Promise<{ id: string, name: string, balance: number }>
  /** OS criada por API (o servidor calcula o snapshot de comissão, como ao salvar pela tela). */
  createOrder: (spec?: OrderSpec) => Promise<{ id: string, number: string, total: number }>
  // leituras de banco
  balance: (accountId: string) => Promise<number>
  statements: (accountId: string) => Promise<{ amount: number, transaction_type: string, description: string | null }[]>
  order: (orderId: string) => Promise<Record<string, any>>
  /** OS da oficina A pelo número exibido na tela (ex.: OS4001). */
  orderByNumber: (number: string) => Promise<Record<string, any>>
  installments: (orderId: string) => Promise<Record<string, any>[]>
  commissions: (orderId: string) => Promise<Record<string, any>[]>
  /** Σ extrato (com sinal) == variação do saldo (invariante de caixa I1). */
  expectCashConsistent: (accountId: string, startingBalance: number) => Promise<void>
}

export const test = base.extend<{ shop: Shop }, { catalog: Catalog }>({
  catalog: [async ({ world }, use) => {
    const ctx = await pwRequest.newContext({ baseURL: appBaseUrl() })
    try {
      await loginViaApi(ctx, world.users.admin)
      await use(await buildCatalog(new Api(ctx)))
    } finally {
      await ctx.dispose()
    }
  }, { scope: 'worker', timeout: 180_000 }],

  shop: async ({ apiAs, world, catalog }, use) => {
    const api = await apiAs('admin')
    let seq = 0
    const db = world.db
    const shop: Shop = {
      api, world, catalog,
      async newAccount(balance = 1000, name = `Conta ${Date.now()}-${++seq}`) {
        const res = await api.post('/api/bank-accounts', { account_name: name, account_type: 'checking', initial_balance: balance, current_balance: balance })
        expect(res.status, JSON.stringify(res.body)).toBe(200)
        return { id: idOf(res.body), name, balance }
      },
      async createOrder(spec = {}) {
        const orderData = buildOrderData(catalog, spec)
        const res = await api.post('/api/service-orders', { orderData })
        expect(res.status, JSON.stringify(res.body)).toBe(200)
        const id = String(res.body.order?.id)
        const row = await shop.order(id)
        return { id, number: String(row.number), total: Number(row.total_amount) }
      },
      async balance(accountId) {
        const { data } = await db.from('bank_accounts').select('current_balance').eq('id', accountId).single()
        return Number(data?.current_balance)
      },
      async statements(accountId) {
        const { data } = await db.from('bank_account_statements').select('amount, transaction_type, description').eq('bank_account_id', accountId).order('created_at')
        return (data ?? []).map(r => ({ ...r, amount: Number(r.amount) }))
      },
      async order(orderId) {
        const { data, error } = await db.from('service_orders').select('*').eq('id', orderId).single()
        expect(error, `OS ${orderId}`).toBeNull()
        return data!
      },
      async orderByNumber(number) {
        const { data, error } = await db.from('service_orders').select('*').eq('organization_id', world.orgA).eq('number', number).is('deleted_at', null).single()
        expect(error, `OS ${number}`).toBeNull()
        return data!
      },
      async installments(orderId) {
        const { data } = await db.from('service_order_installments').select('*').eq('service_order_id', orderId).is('deleted_at', null).order('installment_number')
        return data ?? []
      },
      async commissions(orderId) {
        const { data } = await db.from('employee_financial_records').select('*').eq('service_order_id', orderId).eq('record_type', 'commission').is('deleted_at', null)
        return data ?? []
      },
      async expectCashConsistent(accountId, startingBalance) {
        const signed = (await shop.statements(accountId)).reduce((s, x) => s + (x.transaction_type === 'income' ? 1 : -1) * x.amount, 0)
        expect(money((await shop.balance(accountId)) - startingBalance), 'saldo da conta ≠ soma do extrato').toBe(money(signed))
      }
    }
    await use(shop)
  }
})
