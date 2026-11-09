// Fluxos de dinheiro ponta a ponta: servidor real + Postgres real (Supabase local).
// O que os testes em memória não alcançam: RPC de numeração, índices únicos, gatilhos e o dado gravado de verdade.
// Cada fluxo cria a própria conta bancária, cliente e OS, então não depende da ordem dos outros.
// Precisa do Supabase local (ver support/env.ts); sem ele o spec é pulado.
import { expect, skipUnlessAuth, test, type Api, type World } from './support/fixtures'

skipUnlessAuth(test)

const today = () => new Date().toISOString().slice(0, 10)
const money = (n: number) => Number(n.toFixed(2))

/** Conta, cliente e OS concluída prontos para receber. */
async function setup(api: Api, opts: { total?: number, status?: string, balance?: number } = {}) {
  const total = opts.total ?? 300
  const balance = opts.balance ?? 1000
  const acc = await api.post('/api/bank-accounts', { account_name: `Conta ${Date.now()}`, account_type: 'checking', initial_balance: balance, current_balance: balance })
  expect(acc.status, JSON.stringify(acc.body)).toBe(200)
  const client = await api.post('/api/clients', { name: `Cliente ${Date.now()}`, phone: '11999990000', person_type: 'pf' })
  expect(client.status, JSON.stringify(client.body)).toBe(200)
  const os = await api.post('/api/service-orders', {
    orderData: { client_id: client.body.item.id, status: opts.status ?? 'completed', total_amount: total, entry_date: today(), items: [] }
  })
  expect(os.status, JSON.stringify(os.body)).toBe(200)
  return { accountId: (acc.body.item ?? acc.body.data).id as string, clientId: client.body.item.id as string, orderId: os.body.order.id as string, total, balance }
}

async function dbBalance(world: World, accountId: string) {
  const { data } = await world.db.from('bank_accounts').select('current_balance').eq('id', accountId).single()
  return Number(data?.current_balance)
}
async function dbStatements(world: World, accountId: string) {
  const { data } = await world.db.from('bank_account_statements').select('amount, transaction_type').eq('bank_account_id', accountId)
  return data ?? []
}
async function dbOrder(world: World, orderId: string) {
  const { data } = await world.db.from('service_orders').select('status, payment_status, number').eq('id', orderId).single()
  return data!
}
/** Invariante I1/I10 no banco de verdade: Σ extrato (com sinal) == variação do saldo. */
async function expectCashConsistent(world: World, accountId: string, startingBalance: number) {
  const signed = (await dbStatements(world, accountId)).reduce((s, x) => s + (x.transaction_type === 'income' ? 1 : -1) * Number(x.amount), 0)
  expect(money((await dbBalance(world, accountId)) - startingBalance)).toBe(money(signed))
}

test.describe('Fluxo: receber uma OS à vista', () => {
  test('quita a OS, soma no saldo, gera extrato e aparece nos relatórios', async ({ apiAs, world }) => {
    const api = await apiAs('admin')
    const before = await api.get('/api/reports/overview', { dateFrom: today(), dateTo: today() })
    const s = await setup(api)

    const pay = await api.post(`/api/service-orders/${s.orderId}/process-payment`, {
      paymentMethod: 'pix', bankAccountId: s.accountId, installments: [{ amount: s.total, status: 'paid' }]
    })
    expect(pay.status, JSON.stringify(pay.body)).toBe(200)

    expect(await dbBalance(world, s.accountId)).toBe(s.balance + s.total)
    expect(await dbStatements(world, s.accountId)).toHaveLength(1)
    expect((await dbOrder(world, s.orderId)).payment_status).toBe('paid')
    await expectCashConsistent(world, s.accountId, s.balance)

    // relatórios: competência (visão geral) e caixa (fluxo de caixa) enxergam os R$ 300
    const after = await api.get('/api/reports/overview', { dateFrom: today(), dateTo: today() })
    expect(after.status).toBe(200)
    expect(money(after.body.data.overview.grossRevenue - before.body.data.overview.grossRevenue)).toBe(s.total)
    const cash = await api.get('/api/reports/profit-cash-flow', { dateFrom: today(), dateTo: today(), status: 'paid' })
    expect(cash.body.data.profitReport.currentData.revenue).toBeGreaterThanOrEqual(s.total)
  })

  test('repetir o recebimento é recusado (409) e o saldo não muda', async ({ apiAs, world }) => {
    const api = await apiAs('admin')
    const s = await setup(api)
    const body = { paymentMethod: 'pix', bankAccountId: s.accountId, installments: [{ amount: s.total, status: 'paid' }] }
    expect((await api.post(`/api/service-orders/${s.orderId}/process-payment`, body)).status).toBe(200)
    expect((await api.post(`/api/service-orders/${s.orderId}/process-payment`, body)).status).toBe(409)
    expect(await dbBalance(world, s.accountId)).toBe(s.balance + s.total)
    expect(await dbStatements(world, s.accountId)).toHaveLength(1)
  })

  test('OS ainda aberta não recebe plano de pagamento', async ({ apiAs, world }) => {
    const api = await apiAs('admin')
    const s = await setup(api, { status: 'open' })
    const pay = await api.post(`/api/service-orders/${s.orderId}/process-payment`, {
      paymentMethod: 'pix', bankAccountId: s.accountId, installments: [{ amount: s.total, status: 'paid' }]
    })
    expect(pay.status).toBe(409)
    expect(await dbBalance(world, s.accountId)).toBe(s.balance)
  })
})

test.describe('Fluxo: receber uma OS parcelada e em partes', () => {
  test('1ª parcela paga → parcial; pagar a 2ª em duas partes; quitar a 3ª → paga', async ({ apiAs, world }) => {
    const api = await apiAs('admin')
    const s = await setup(api)

    const plan = await api.post(`/api/service-orders/${s.orderId}/process-payment`, {
      paymentMethod: 'pix', bankAccountId: s.accountId, installments: [{ amount: 100, status: 'paid' }, { amount: 100 }, { amount: 100 }]
    })
    expect(plan.status, JSON.stringify(plan.body)).toBe(200)
    expect((await dbOrder(world, s.orderId)).payment_status).toBe('partial')
    expect(await dbBalance(world, s.accountId)).toBe(s.balance + 100)

    const { data: rows } = await world.db.from('service_order_installments').select('id, installment_number, status').eq('service_order_id', s.orderId).order('installment_number')
    expect(rows!.map(r => r.status)).toEqual(['paid', 'pending', 'pending'])
    const [, second, third] = rows!

    const pay = (id: string, amount?: number) => api.post(`/api/service-orders/${s.orderId}/installments/${id}/pay`, amount === undefined ? { bankAccountId: s.accountId, paymentMethod: 'pix' } : { amount, bankAccountId: s.accountId, paymentMethod: 'pix' })
    expect((await pay(second!.id, 40)).status).toBe(200)
    expect((await pay(second!.id, 60)).status).toBe(200)
    expect((await pay(third!.id)).status).toBe(200)

    expect((await dbOrder(world, s.orderId)).payment_status).toBe('paid')
    expect(await dbBalance(world, s.accountId)).toBe(s.balance + 300)
    await expectCashConsistent(world, s.accountId, s.balance)
  })

  test('acima do saldo da parcela é recusado e nada é gravado', async ({ apiAs, world }) => {
    const api = await apiAs('admin')
    const s = await setup(api)
    await api.post(`/api/service-orders/${s.orderId}/process-payment`, {
      paymentMethod: 'pix', bankAccountId: s.accountId, installments: [{ amount: 150 }, { amount: 150 }]
    })
    const { data: rows } = await world.db.from('service_order_installments').select('id').eq('service_order_id', s.orderId).order('installment_number')
    const res = await api.post(`/api/service-orders/${s.orderId}/installments/${rows![0]!.id}/pay`, { amount: 9999, bankAccountId: s.accountId, paymentMethod: 'pix' })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await dbBalance(world, s.accountId)).toBe(s.balance)
    expect(await dbStatements(world, s.accountId)).toHaveLength(0)
  })

  test('a soma das parcelas diferente do total é recusada (400)', async ({ apiAs, world }) => {
    const api = await apiAs('admin')
    const s = await setup(api)
    const res = await api.post(`/api/service-orders/${s.orderId}/process-payment`, {
      paymentMethod: 'pix', bankAccountId: s.accountId, installments: [{ amount: 100, status: 'paid' }, { amount: 100 }]
    })
    expect(res.status).toBe(400)
    expect(await dbBalance(world, s.accountId)).toBe(s.balance)
  })
})

test.describe('Fluxo: desfazer o pagamento', () => {
  test('devolve o saldo, apaga o extrato e a OS volta para pendente', async ({ apiAs, world }) => {
    const api = await apiAs('admin')
    const s = await setup(api)
    await api.post(`/api/service-orders/${s.orderId}/process-payment`, {
      paymentMethod: 'pix', bankAccountId: s.accountId, installments: [{ amount: 100, status: 'paid' }, { amount: 100, status: 'paid' }, { amount: 100 }]
    })
    expect(await dbBalance(world, s.accountId)).toBe(s.balance + 200)

    const undo = await api.del(`/api/service-orders/${s.orderId}/payment`)
    expect(undo.status, JSON.stringify(undo.body)).toBe(200)
    expect(await dbBalance(world, s.accountId)).toBe(s.balance)
    expect(await dbStatements(world, s.accountId)).toHaveLength(0)
    expect((await dbOrder(world, s.orderId)).payment_status).toBe('pending')
  })

  test('ciclo receber → desfazer → receber de novo deixa o saldo certo', async ({ apiAs, world }) => {
    const api = await apiAs('admin')
    const s = await setup(api)
    const body = { paymentMethod: 'pix', bankAccountId: s.accountId, installments: [{ amount: s.total, status: 'paid' }] }
    await api.post(`/api/service-orders/${s.orderId}/process-payment`, body)
    await api.del(`/api/service-orders/${s.orderId}/payment`)
    expect((await api.post(`/api/service-orders/${s.orderId}/process-payment`, body)).status).toBe(200)
    expect(await dbBalance(world, s.accountId)).toBe(s.balance + s.total)
    await expectCashConsistent(world, s.accountId, s.balance)
  })
})

test.describe('Fluxo: cancelar a OS', () => {
  test('sem pagamento cancela; com pagamento é recusado até desfazer o recebimento', async ({ apiAs, world }) => {
    const api = await apiAs('admin')
    const paid = await setup(api)
    await api.post(`/api/service-orders/${paid.orderId}/process-payment`, {
      paymentMethod: 'pix', bankAccountId: paid.accountId, installments: [{ amount: paid.total, status: 'paid' }]
    })
    expect((await api.post(`/api/service-orders/${paid.orderId}/cancel`)).status).toBe(409)
    expect((await dbOrder(world, paid.orderId)).status).toBe('completed')

    await api.del(`/api/service-orders/${paid.orderId}/payment`)
    expect((await api.post(`/api/service-orders/${paid.orderId}/cancel`)).status).toBe(200)
    expect((await dbOrder(world, paid.orderId)).status).toBe('cancelled')

    const free = await setup(api)
    expect((await api.post(`/api/service-orders/${free.orderId}/cancel`)).status).toBe(200)
  })

  test('OS cancelada não entra no faturamento', async ({ apiAs }) => {
    const api = await apiAs('admin')
    const before = (await api.get('/api/reports/overview', { dateFrom: today(), dateTo: today() })).body.data.overview.grossRevenue
    const s = await setup(api, { total: 777 })
    expect((await api.post(`/api/service-orders/${s.orderId}/cancel`)).status).toBe(200)
    const after = (await api.get('/api/reports/overview', { dateFrom: today(), dateTo: today() })).body.data.overview.grossRevenue
    expect(money(after - before)).toBe(0)
  })
})

test.describe('Fluxo: despesa avulsa', () => {
  test('lançar → pagar baixa o saldo uma única vez', async ({ apiAs, world }) => {
    const api = await apiAs('admin')
    const s = await setup(api)
    const created = await api.post('/api/financial', {
      description: 'Aluguel do galpão', amount: 80, due_date: today(), type: 'expense', category: 'Aluguel', status: 'pending', bank_account_id: s.accountId
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const id = (created.body.item ?? created.body.items?.[0] ?? created.body.data).id as string

    expect((await api.post(`/api/financial/${id}/pay`)).status).toBe(200)
    expect(await dbBalance(world, s.accountId)).toBe(s.balance - 80)
    expect((await api.post(`/api/financial/${id}/pay`)).status).toBe(400)
    expect(await dbBalance(world, s.accountId)).toBe(s.balance - 80)
    await expectCashConsistent(world, s.accountId, s.balance)
  })

  test('pagamento em lote: paga os pendentes, ignora os já pagos e não duplica', async ({ apiAs, world }) => {
    const api = await apiAs('admin')
    const s = await setup(api)
    const ids: string[] = []
    for (const amount of [10, 20]) {
      const r = await api.post('/api/financial', { description: `Conta ${amount}`, amount, due_date: today(), type: 'expense', category: 'Aluguel', status: 'pending', bank_account_id: s.accountId })
      ids.push((r.body.item ?? r.body.items?.[0] ?? r.body.data).id)
    }
    const first = await api.post('/api/financial/pay-entries-bulk', { entryIds: ids })
    expect(first.body.data).toMatchObject({ paidCount: 2, failedCount: 0 })
    const again = await api.post('/api/financial/pay-entries-bulk', { entryIds: ids })
    expect(again.body.data).toMatchObject({ paidCount: 0, skippedCount: 2 })
    expect(await dbBalance(world, s.accountId)).toBe(s.balance - 30)
    await expectCashConsistent(world, s.accountId, s.balance)
  })
})

test.describe('Fluxo: isolamento entre oficinas', () => {
  test('usuário de outra oficina não vê, não recebe e não cancela a OS', async ({ apiAs, world }) => {
    const owner = await apiAs('admin')
    const intruder = await apiAs('otherOrg')
    const s = await setup(owner)

    expect((await intruder.get(`/api/service-orders/${s.orderId}`)).status).toBe(404)
    const pay = await intruder.post(`/api/service-orders/${s.orderId}/process-payment`, {
      paymentMethod: 'pix', bankAccountId: s.accountId, installments: [{ amount: s.total, status: 'paid' }]
    })
    expect(pay.status).toBe(404)
    expect((await intruder.post(`/api/service-orders/${s.orderId}/cancel`)).status).toBe(404)
    expect(await dbBalance(world, s.accountId)).toBe(s.balance)
    expect((await dbOrder(world, s.orderId)).status).toBe('completed')
  })

  test('os relatórios de uma oficina não somam os dados da outra', async ({ apiAs }) => {
    const a = await apiAs('admin')
    const b = await apiAs('otherOrg')
    const beforeB = (await b.get('/api/reports/overview', { dateFrom: today(), dateTo: today() })).body.data.overview.grossRevenue
    await setup(a, { total: 4242 })
    const afterB = (await b.get('/api/reports/overview', { dateFrom: today(), dateTo: today() })).body.data.overview.grossRevenue
    expect(afterB).toBe(beforeB)
  })

  test('conta bancária de outra oficina é recusada no recebimento', async ({ apiAs, world }) => {
    const a = await apiAs('admin')
    const b = await apiAs('otherOrg')
    const s = await setup(a)
    const foreign = await setup(b)
    const res = await a.post(`/api/service-orders/${s.orderId}/process-payment`, {
      paymentMethod: 'pix', bankAccountId: foreign.accountId, installments: [{ amount: s.total, status: 'paid' }]
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await dbBalance(world, foreign.accountId)).toBe(foreign.balance)
    expect(await dbStatements(world, foreign.accountId)).toHaveLength(0)
  })
})

test.describe('Fluxo: relatórios batem entre si (dado real)', () => {
  test('dashboard e visão geral mostram o mesmo faturamento do mês', async ({ apiAs }) => {
    const api = await apiAs('admin')
    await setup(api, { total: 123.45 })
    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
    const overview = await api.get('/api/reports/overview', { dateFrom: from, dateTo: to })
    const dash = await api.get('/api/reports/dashboard-stats')
    expect(overview.status).toBe(200)
    expect(dash.status).toBe(200)
    expect(dash.body.grossRevenue ?? dash.body.data?.grossRevenue).toBe(overview.body.data.overview.grossRevenue)
  })

  test('devedores: OS concluída sem pagamento soma no que se deve; depois de quitada, sai', async ({ apiAs }) => {
    const api = await apiAs('admin')
    const owed = async () => {
      const r = await api.get('/api/reports/debtors', { dateFrom: '2000-01-01', dateTo: '2100-01-01', orderStatusFilters: 'completed', pageSize: '100' })
      expect(r.status, JSON.stringify(r.body)).toBe(200)
      return money(r.body.data.debtorsReport.totals.total)
    }
    const base = await owed()
    const s = await setup(api, { total: 555 })
    expect(money((await owed()) - base)).toBe(555)
    await api.post(`/api/service-orders/${s.orderId}/process-payment`, {
      paymentMethod: 'pix', bankAccountId: s.accountId, installments: [{ amount: s.total, status: 'paid' }]
    })
    expect(await owed()).toBe(base)
  })
})
