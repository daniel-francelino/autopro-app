// Relatórios — "os números batem?" Um único conjunto de dados alimenta os handlers REAIS de relatório
// e o teste confere as relações que o cliente espera (R-xx em docs/testing/financial-core-test-analysis.md).
// Regimes: COMPETÊNCIA (por data da OS) × CAIXA (por data do lançamento). Diferenças entre eles são
// esperadas; o que não pode haver é diferença DENTRO do mesmo regime.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../helpers/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fake-supabase'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const R = (name: string) => `server/api/reports/${name}.get.ts`
const range = { dateFrom: '2026-03-01', dateTo: '2026-03-31' }

type Row = Record<string, unknown>
const base = { organization_id: 'org-a', deleted_at: null }

function order(id: string, o: Row): Row {
  return { id, ...base, client_id: 'c1', payment_method: 'pix', total_cost_amount: 0, commission_amount: 0, is_installment: false, payment_status: 'pending', items: [], ...o }
}

function seed() {
  fake = createFakeSupabase({
    user_profiles: [{ id: 'p1', user_id: 'u1', organization_id: 'org-a', role_id: 'r', is_owner: false, is_active: true, employee_id: null }],
    subscriptions: [{ id: 's1', organization_id: 'org-a', plan_key: 'pro', status: 'active', deleted_at: null }],
    clients: [{ id: 'c1', ...base, name: 'Cliente 1', created_at: '2026-03-02T10:00:00Z' }, { id: 'c2', ...base, name: 'Cliente 2', created_at: '2026-01-02T10:00:00Z' }],
    employees: [{ id: 'e1', ...base, name: 'Ana' }, { id: 'e2', ...base, name: 'Bruno' }],
    vehicles: [],
    appointments: [],
    service_orders: [
      order('A', { number: '1', status: 'completed', entry_date: '2026-03-05', total_amount: 1000, total_cost_amount: 300, commission_amount: 100, payment_status: 'paid', is_installment: true }),
      order('B', { number: '2', status: 'completed', entry_date: '2026-03-12', total_amount: 600, total_cost_amount: 100, commission_amount: 60, payment_status: 'partial', is_installment: true, client_id: 'c2' }),
      order('C', { number: '3', status: 'completed', entry_date: '2026-03-20', total_amount: 500, payment_status: 'pending', expected_payment_date: '2026-03-25' }),
      order('D', { number: '4', status: 'cancelled', entry_date: '2026-03-15', total_amount: 800 }),
      order('E', { number: '5', status: 'estimate', entry_date: '2026-03-16', total_amount: 300 }),
      order('F', { number: '6', status: 'in_progress', entry_date: '2026-03-18', total_amount: 400 }),
      order('G', { number: '7', status: 'completed', entry_date: '2026-02-28', total_amount: 700, payment_status: 'paid' }),
      order('H', { number: '8', status: 'completed', entry_date: '2026-03-09', total_amount: 999, deleted_at: '2026-03-10T00:00:00Z' })
    ],
    service_order_installments: [
      { id: 'iA', ...base, service_order_id: 'A', kind: 'installment', installment_number: 1, amount: 1000, status: 'paid', due_date: '2026-03-06' },
      { id: 'iB1', ...base, service_order_id: 'B', kind: 'installment', installment_number: 1, amount: 200, status: 'paid', due_date: '2026-03-13' },
      { id: 'iB2', ...base, service_order_id: 'B', kind: 'installment', installment_number: 2, amount: 400, status: 'pending', due_date: '2026-03-27' },
      { id: 'iF', ...base, service_order_id: 'F', kind: 'down_payment', installment_number: 1, amount: 100, status: 'paid', due_date: '2026-03-10' }
    ],
    financial_transactions: [
      { id: 't1', ...base, type: 'income', status: 'paid', amount: 1000, due_date: '2026-03-06', service_order_id: 'A', service_order_installment_id: 'iA' },
      { id: 't2', ...base, type: 'income', status: 'paid', amount: 200, due_date: '2026-03-13', service_order_id: 'B', service_order_installment_id: 'iB1' },
      { id: 't3', ...base, type: 'income', status: 'paid', amount: 100, due_date: '2026-03-10', service_order_id: 'F', service_order_installment_id: 'iF' },
      { id: 't4', ...base, type: 'expense', status: 'paid', amount: 150, due_date: '2026-03-08', category_id: 'cat1' },
      { id: 't5', ...base, type: 'expense', status: 'pending', amount: 80, due_date: '2026-03-30', category_id: 'cat1' },
      { id: 't6', ...base, type: 'expense', status: 'paid', amount: 60, due_date: '2026-03-31', category_id: 'cat-sal' },
      { id: 't7', ...base, type: 'expense', status: 'cancelled', amount: 999, due_date: '2026-03-15', category_id: 'cat1' },
      { id: 't8', ...base, type: 'income', status: 'paid', amount: 5000, due_date: '2026-04-02', service_order_id: 'A' }
    ],
    financial_categories: [{ id: 'cat1', ...base, name: 'Aluguel', type: 'expense' }, { id: 'cat-sal', ...base, name: 'Salários', type: 'expense' }],
    employee_financial_records: [
      { id: 'r1', organization_id: 'org-a', employee_id: 'e1', service_order_id: 'A', record_type: 'commission', amount: 100, status: 'paid', reference_date: '2026-03-05' },
      { id: 'r2', organization_id: 'org-a', employee_id: 'e2', service_order_id: 'B', record_type: 'commission', amount: 30, status: 'pending', reference_date: '2026-03-12' },
      { id: 'r3', organization_id: 'org-a', employee_id: 'e1', service_order_id: 'H', record_type: 'commission', amount: 99, status: 'pending', reference_date: '2026-03-09' },
      { id: 'r4', organization_id: 'org-a', employee_id: 'e1', service_order_id: null, record_type: 'bonus', amount: 40, status: 'pending', reference_date: '2026-03-31' },
      { id: 'r5', organization_id: 'org-a', employee_id: 'e2', service_order_id: 'C', record_type: 'commission', amount: 25, status: 'cancelled', reference_date: '2026-03-20' }
    ]
  })
}

const get = async (name: string, query: Row = {}) => {
  const r = await callHandler(R(name), fakeEvent({ cookies, query: { ...range, ...query } }))
  expect(r.status).toBe(200)
  return (r.body as { data: any }).data
}

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-25T12:00:00') }) })
afterAll(() => { vi.useRealTimers() })
beforeEach(() => {
  seed()
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@a.com' } }, error: null })
})

describe('R1–R6: competência (por data da OS)', () => {
  const doneStatuses = ['completed', 'invoiced', 'delivered']

  it('R1: faturamento do overview = OS concluídas do mês (A+B+C), sem orçamento/cancelada/excluída/fora do mês', async () => {
    const { overview } = await get('overview')
    expect(overview.grossRevenue).toBe(2100)
    expect(overview.totalOrders).toBe(3)
  })
  it('R2: dashboard (mês corrente) bate com o overview no mesmo mês', async () => {
    const dash = (await callHandler(R('dashboard-stats'), fakeEvent({ cookies }))).body as { grossRevenue: number }
    const { overview } = await get('overview')
    expect(dash.grossRevenue).toBe(overview.grossRevenue)
  })
  it('R3: "Lucro pelas OS" filtrado em concluídas tem a mesma receita do overview', async () => {
    const { profitReport } = await get('profit-by-order', { orderStatus: doneStatuses })
    expect(profitReport.currentData.revenue).toBe(2100)
    expect(profitReport.currentData.partsCost).toBe(400)
    expect(profitReport.currentData.commissionCost).toBe(160)
    expect(profitReport.currentData.profit).toBe(2100 - 400 - 160)
    expect(profitReport.currentData.orderCount).toBe(3)
  })
  it('R4: ticket médio × receita × quantidade são coerentes', async () => {
    const { overview } = await get('overview')
    expect(overview.averageTicket * overview.totalOrders).toBeCloseTo(overview.grossRevenue, 6)
  })
  it('R5: OS excluída nunca entra em nenhum relatório de competência', async () => {
    const { overview } = await get('overview')
    const { profitReport } = await get('profit-by-order')
    expect(overview.grossRevenue).not.toBe(2100 + 999)
    expect(profitReport.topProfitableOrders.map((o: { number: string }) => o.number)).not.toContain('8')
  })
  it('R6: limites do período são inclusivos (01/03 e 31/03)', async () => {
    fake.tables.service_orders!.push(
      order('L1', { number: '90', status: 'completed', entry_date: '2026-03-01', total_amount: 10 }),
      order('L2', { number: '91', status: 'completed', entry_date: '2026-03-31', total_amount: 20 }),
      order('L3', { number: '92', status: 'completed', entry_date: '2026-04-01', total_amount: 40 })
    )
    const { overview } = await get('overview')
    expect(overview.grossRevenue).toBe(2130)
  })
})

describe('R7–R12: caixa (por data do lançamento)', () => {
  it('R7: entradas pagas do fluxo de caixa = soma dos recebimentos (A + B1 + sinal F), cancelada fora', async () => {
    const { profitReport } = await get('profit-cash-flow', { status: 'paid' })
    expect(profitReport.currentData.revenue).toBe(1300)
  })
  it('R8: despesas pagas = 150 + 60; pendente (80) e cancelada (999) ficam de fora no filtro "pago"', async () => {
    const { profitReport } = await get('profit-cash-flow', { status: 'paid' })
    expect(profitReport.currentData.costs).toBe(210)
    expect(profitReport.currentData.profit).toBe(1300 - 210)
  })
  it('R9: lançamento do mês seguinte (t8, 5000) não entra no mês', async () => {
    const { profitReport } = await get('profit-cash-flow', { status: 'paid' })
    expect(profitReport.currentData.revenue).not.toBe(6300)
  })
  it('R10: overview.totalCosts (despesas pagas) = custos pagos do fluxo de caixa', async () => {
    const { overview } = await get('overview')
    const { profitReport } = await get('profit-cash-flow', { status: 'paid' })
    expect(overview.totalCosts).toBe(profitReport.currentData.costs)
  })
  it('R11: soma do gráfico diário = total do período (nenhum dia perdido)', async () => {
    const { profitReport } = await get('profit-cash-flow', { status: 'paid' })
    const days = profitReport.evolutionData as Array<{ revenue: number, costs: number }>
    expect(days.reduce((s, d) => s + d.revenue, 0)).toBe(profitReport.currentData.revenue)
    expect(days.reduce((s, d) => s + d.costs, 0)).toBe(profitReport.currentData.costs)
    expect(days).toHaveLength(31)
  })
  it('R12: comparação com período anterior não quebra com período vazio (divisão por zero)', async () => {
    const { profitReport } = await get('profit-cash-flow', { status: 'paid', compareWithPreviousPeriod: 'true' })
    expect(JSON.stringify(profitReport.variations)).not.toMatch(/NaN|Infinity/)
    expect(profitReport.variations.revenue.fromZeroBase).toBe(true)
  })
})

describe('R13–R20: inadimplência (devedores)', () => {
  it('R13: devedor = parcela pendente de B (400) + OS à vista pendente de C (500)', async () => {
    const { debtorsReport } = await get('debtors', { orderStatusFilters: ['completed'] })
    expect(debtorsReport.totals.total).toBe(900)
    expect(debtorsReport.counts.clients).toBe(2)
  })
  it('R14: OS paga, cancelada, orçamento e excluída nunca aparecem como devedoras', async () => {
    const { debtorsReport } = await get('debtors', { dateFrom: '2026-01-01', dateTo: '2026-12-31' })
    const numbers = debtorsReport.items.flatMap((c: any) => c.pendingItems.map((p: any) => String(p.orderNumber)))
    for (const n of ['1', '4', '5', '7', '8']) expect(numbers).not.toContain(n)
  })
  it('R15: parcela parcialmente recebida deve só o restante', async () => {
    fake.tables.service_order_installments!.find(i => i.id === 'iB2')!.status = 'partial'
    fake.tables.financial_transactions!.push({ id: 'tp', ...base, type: 'income', status: 'paid', amount: 150, due_date: '2026-03-20', service_order_id: 'B', service_order_installment_id: 'iB2' })
    const { debtorsReport } = await get('debtors', { orderStatusFilters: ['completed'] })
    const b = debtorsReport.items.find((c: any) => c.clientId === 'c2')
    expect(b.totalOwed).toBe(250)
  })
  it('R16: totais "vencido + a vencer" = total', async () => {
    const { debtorsReport } = await get('debtors', { orderStatusFilters: ['completed'] })
    expect(debtorsReport.totals.overdue + debtorsReport.totals.current).toBe(debtorsReport.totals.total)
  })
  it('R17: visão por OS e visão por cliente somam o mesmo total', async () => {
    const byClient = (await get('debtors', { viewMode: 'clients', orderStatusFilters: ['completed'], pageSize: 100 })).debtorsReport
    const byOrder = (await get('debtors', { viewMode: 'orders', orderStatusFilters: ['completed'], pageSize: 100 })).debtorsReport
    const sumOrders = byOrder.orderItems.reduce((s: number, o: any) => s + o.totalOwed, 0)
    expect(sumOrders).toBe(byClient.totals.total)
  })
  it('R18: vencido usa o dia (hoje 25/03): parcela de 27/03 está "a vencer", OS de C (25/03) ainda não venceu', async () => {
    const { debtorsReport } = await get('debtors', { orderStatusFilters: ['completed'] })
    expect(debtorsReport.totals.overdue).toBe(0)
  })
  it('R19: plano Starter e sem assinatura não acessam o relatório (403)', async () => {
    fake.tables.subscriptions![0]!.plan_key = 'starter'
    const r = await callHandler(R('debtors'), fakeEvent({ cookies, query: range }))
    expect(r.status).toBe(403)
  })
  it('R20: relatório não vaza dados de outra organização', async () => {
    fake.tables.service_orders!.push(order('X', { number: '777', organization_id: 'org-b', status: 'completed', entry_date: '2026-03-05', total_amount: 123456 }))
    const { overview } = await get('overview')
    expect(overview.grossRevenue).toBe(2100)
  })
})

describe('R21–R28: comissões no relatório', () => {
  it('R21: totais pago/pendente somam o total e ignoram bônus', async () => {
    const { summary } = await get('commissions', { recordType: 'all' })
    expect(summary.paid).toBe(100)
    expect(summary.pending).toBe(30)
  })
  it('R22: total de comissões = pagas + pendentes + canceladas (nada some do total)', async () => {
    const { summary } = await get('commissions')
    expect(summary.total).toBe(summary.paid + summary.pending + 25)
  })
  it('R23: comissão por funcionário soma o mesmo que o resumo', async () => {
    const { charts, summary } = await get('commissions', { recordType: 'commission' })
    const chartTotal = charts.byEmployee.reduce((s: number, e: any) => s + e.total, 0)
    expect(chartTotal).toBe(summary.total)
  })
  it('R24: filtro por funcionário e por status', async () => {
    const { summary } = await get('commissions', { employeeId: 'e2', status: 'pending' })
    expect(summary.pending).toBe(30)
    expect(summary.paid).toBe(0)
  })
  it('R25: o total de comissões do relatório bate com o direito (commission_amount) das OS do período', async () => {
    const { summary } = await get('commissions', { recordType: 'commission' })
    const entitled = fake.tables.service_orders!.filter(o => ['A', 'B'].includes(String(o.id))).reduce((s, o) => s + Number(o.commission_amount), 0)
    // A: 100 pago, B: 30 liberado de 60 (50% recebido... parcela 200/600 ≈ 33%) → pendente + pago ≤ direito
    expect(summary.paid + summary.pending).toBeLessThanOrEqual(entitled)
  })
  // KF-32: comissão de OS excluída some do relatório, mas continua no cadastro do funcionário (r3, 99 pendente).
  it.fails('KF-32: comissão pendente ligada a OS excluída aparece (ou é bloqueada) — não some em silêncio', async () => {
    const { summary } = await get('commissions', { recordType: 'commission' })
    const stored = fake.tables.employee_financial_records!.filter(r => r.record_type === 'commission' && r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0)
    expect(summary.pending).toBe(stored)
  })
  // KF-33: o gráfico por funcionário trata "cancelada" como pendente, mas o resumo não.
  it.fails('KF-33: pendente do gráfico por funcionário = pendente do resumo (cancelada não é pendente)', async () => {
    const { charts, summary } = await get('commissions', { recordType: 'commission' })
    const chartPending = charts.byEmployee.reduce((s: number, e: any) => s + e.pending, 0)
    expect(chartPending).toBe(summary.pending)
  })
  it('R28: paginação não perde nem repete registros', async () => {
    const first = await get('commissions', { page: 1, pageSize: 2 })
    const second = await get('commissions', { page: 2, pageSize: 2 })
    const ids = [...first.items, ...second.items].map((i: any) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('Pontas soltas conhecidas de relatório (KF-34 a KF-35)', () => {
  // KF-34: OS ABERTA com sinal pago e is_installment=false entra em "devedores" pelo total, sem descontar o sinal.
  it.fails('KF-34: devedores desconta o sinal já recebido de uma OS ainda sem plano', async () => {
    const { debtorsReport } = await get('debtors', { orderStatusFilters: ['in_progress'] })
    expect(debtorsReport.totals.total).toBe(300) // 400 da OS − 100 de sinal
  })
  // KF-35: dashboard mostra o mês corrente; o relatório "visão geral" nunca avisa quando o intervalo
  // vira de mês — mas dashboard e overview precisam coincidir no mesmo intervalo. (cobertura em R2)
  it('KF-35 (caracterização): "Lucro pelas OS" sem filtro de status soma orçamento e cancelada', async () => {
    const { profitReport } = await get('profit-by-order')
    expect(profitReport.currentData.revenue).toBe(2100 + 800 + 300 + 400) // inclui D(cancelada), E(orçamento), F(andamento)
  })
})

// ─── Cenários R33, R34, R35 e C41 de docs/testing/financial-core-test-analysis.md ───

describe('R33: golden dataset — março/2026 conferido à mão (protege contra regressão silenciosa)', () => {
  // Não "atualize o número para o teste passar": se um destes mudar, descubra QUAL relatório mudou e por quê.
  it('competência: visão geral, lucro pelas OS (concluídas) e dashboard', async () => {
    const { overview } = await get('overview')
    expect(overview).toMatchObject({ grossRevenue: 2100, totalOrders: 3, totalCosts: 210, netProfit: 1890, averageTicket: 700 })
    const { profitReport } = await get('profit-by-order', { orderStatus: ['completed', 'invoiced', 'delivered'] })
    expect(profitReport.currentData).toMatchObject({ revenue: 2100, partsCost: 400, commissionCost: 160, profit: 1540, orderCount: 3 })
  })
  it('caixa: fluxo de caixa pago', async () => {
    const { profitReport } = await get('profit-cash-flow', { status: 'paid' })
    expect(profitReport.currentData).toMatchObject({ revenue: 1300, costs: 210, profit: 1090 })
  })
  it('posição em aberto: devedores', async () => {
    const { debtorsReport } = await get('debtors', { orderStatusFilters: ['completed'] })
    expect(debtorsReport.totals).toMatchObject({ total: 900, overdue: 0, current: 900 })
  })
  it('comissões: pago 100, pendente 30, bônus fora do total', async () => {
    const { summary } = await get('commissions', { recordType: 'commission' })
    expect(summary).toMatchObject({ paid: 100, pending: 30 })
  })
})

describe('C41: comissão paga entra uma vez só em cada relatório (invariante I9)', () => {
  const payCommission = () => fake.tables.financial_transactions!.push({
    id: 'tc', ...base, type: 'expense', status: 'paid', amount: 100, due_date: '2026-03-10',
    category_id: 'cat-sal', employee_financial_record_id: 'r1'
  })

  it('visão geral (caixa): o pagamento da comissão aumenta o custo exatamente pelo valor pago', async () => {
    const before = (await get('overview')).overview
    payCommission()
    const after = (await get('overview')).overview
    expect(after.totalCosts - before.totalCosts).toBe(100)
    expect(after.grossRevenue).toBe(before.grossRevenue)
  })
  it('lucro pelas OS (competência): o direito da comissão não muda quando ela é paga', async () => {
    const before = (await get('profit-by-order', { orderStatus: ['completed'] })).profitReport.currentData
    payCommission()
    const after = (await get('profit-by-order', { orderStatus: ['completed'] })).profitReport.currentData
    expect(after.commissionCost).toBe(before.commissionCost)
    expect(after.profit).toBe(before.profit)
  })
  it('custos × lucro: não soma o direito das OS às despesas (a comissão paga já está nas despesas)', async () => {
    payCommission()
    const r = await callHandler(R('costs-profit'), fakeEvent({ cookies, query: { ...range, includeRawData: 'true' } }))
    expect(r.status).toBe(200)
    const data = JSON.stringify((r.body as { data: unknown }).data)
    // despesas pagas/pendentes não canceladas do mês: 150 + 80 + 60 + 100 (comissão) = 390
    expect(data).toContain('"totalCosts":390')
  })
})

describe('R34: custo da OS no lucro', () => {
  it('lucro por OS = total − custo (total_cost_amount) − comissão (direito), e a soma das OS fecha com o período', async () => {
    const { profitReport } = await get('profit-by-order', { orderStatus: ['completed'] })
    const byNumber = Object.fromEntries(profitReport.topProfitableOrders.map((o: any) => [o.number, o]))
    expect(byNumber['1']).toMatchObject({ revenue: 1000, cost: 400, profit: 600 })
    expect(byNumber['2']).toMatchObject({ revenue: 600, cost: 160, profit: 440 })
    const sum = profitReport.topProfitableOrders.reduce((s: number, o: any) => s + o.profit, 0)
    expect(sum).toBe(profitReport.currentData.profit)
  })
  it('custo maior que a venda dá lucro negativo (não é zerado nem escondido)', async () => {
    fake.tables.service_orders!.push(order('N', { number: '50', status: 'completed', entry_date: '2026-03-14', total_amount: 100, total_cost_amount: 250 }))
    const { profitReport } = await get('profit-by-order', { orderStatus: ['completed'] })
    expect(profitReport.topProfitableOrders.find((o: any) => o.number === '50').profit).toBe(-150)
  })
})

describe('R35: compras (KF-43 — decisão de produto)', () => {
  // Hoje a compra paga só muda payment_status. Não gera lançamento financeiro, então não entra em
  // custos/caixa (overview, profit-cash-flow, costs-profit). Este teste documenta o comportamento atual.
  it('KF-43 (caracterização): compra paga aparece no relatório de compras, mas não nas despesas pagas', async () => {
    fake.tables.purchases = [{ id: 'pu1', ...base, supplier_id: null, purchase_date: '2026-03-10', total_amount: 700, payment_status: 'paid', payment_date: '2026-03-10', bank_account_id: 'acc-a' }]
    fake.tables.suppliers = []
    const purchases = JSON.stringify((await callHandler(R('purchases'), fakeEvent({ cookies, query: range }))).body)
    expect(purchases).toContain('700')
    const { overview } = await get('overview')
    expect(overview.totalCosts).toBe(210) // 700 da compra NÃO está nas despesas
  })
})
