import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  calculateVariation,
  formatCurrency,
  formatOptionalDate,
  formatStatusLabel,
  getComparisonModeLabel,
  getPreviousRangeByMode,
  getPurchasePaymentStatus,
  matchesStatusFilters,
  normalizeId,
  normalizeReportStatus,
  normalizeStatusFilters,
  paginate,
  parseDateEnd,
  parseDateRange,
  parseDateStart,
  qArr,
  roundMoney,
  sortFactor,
  toNumber,
  toStringArray
} from '../../../server/utils/report-helpers'
import {
  buildByOrderEvolutionData,
  buildCashFlowTransactionsEvolutionData,
  buildTopProfitableOrders,
  buildVariations,
  calculateByOrderPeriodData,
  calculateCashFlowFromTransactions,
  resolveComparison,
  toPublicPeriodData
} from '../../../server/utils/profit-report-helpers'
import { csvEscape, textToBase64, toLocalDateOnly, uint8ToBase64 } from '../../../server/utils/report-export'
import { fetchAllOrganizationRows } from '../../../server/utils/supabase-pagination'
import { normalizeSearchText } from '../../../server/utils/search'
import { normalizeOsNumber } from '../../../server/utils/service-order-number'

afterEach(() => vi.useRealTimers())

describe('report-helpers: parâmetros e números', () => {
  it('qArr', () => {
    expect(qArr(undefined)).toEqual([])
    expect(qArr('a')).toEqual(['a'])
    expect(qArr(['a', '', 'b'])).toEqual(['a', 'b'])
  })
  it('toNumber / roundMoney', () => {
    expect(toNumber('12.5', 0)).toBe(12.5)
    expect(toNumber('abc', 7)).toBe(7)
    expect(toNumber(undefined, 3)).toBe(3)
    expect(toNumber(Infinity, 1)).toBe(1)
    expect(roundMoney(1.005 * 100)).toBe(100.5)
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
    expect(roundMoney(Number.NaN)).toBe(0)
  })
  it('toStringArray', () => {
    expect(toStringArray(['a', ' a ', '', null])).toEqual(['a'])
    expect(toStringArray('a,b, a')).toEqual(['a', 'b'])
    expect(toStringArray('["x","y"]')).toEqual(['x', 'y'])
    expect(toStringArray('[quebrado')).toEqual(['[quebrado'])
    expect(toStringArray('todos')).toEqual([])
    expect(toStringArray('')).toEqual([])
    expect(toStringArray(42)).toEqual([])
  })
  it('normalizeId', () => {
    expect(normalizeId('  x ')).toBe('x')
    expect(normalizeId('')).toBeNull()
    expect(normalizeId(null)).toBeNull()
  })
  it('sortFactor', () => {
    expect(sortFactor('asc')).toBe(1)
    expect(sortFactor('desc')).toBe(-1)
  })
})

describe('report-helpers: datas', () => {
  it('parseDateStart/End', () => {
    expect(parseDateStart('2026-03-10')?.getHours()).toBe(0)
    const end = parseDateEnd('2026-03-10')!
    expect([end.getHours(), end.getMinutes(), end.getMilliseconds()]).toEqual([23, 59, 999])
    expect(parseDateStart(undefined)).toBeNull()
    expect(parseDateStart('lixo')).toBeNull()
    expect(parseDateEnd('2026-13-45')).toBeNull()
  })
  it('parseDateRange: só "from" vira dia único', () => {
    const { dateFrom, dateTo } = parseDateRange('2026-03-10')
    expect(dateFrom?.getDate()).toBe(10)
    expect(dateTo?.getDate()).toBe(10)
    expect(dateTo?.getHours()).toBe(23)
  })
  it('parseDateRange: "to" antes de "from" é devolvido como está (sem inverter)', () => {
    const { dateFrom, dateTo } = parseDateRange('2026-03-10', '2026-03-01')
    expect(dateFrom! > dateTo!).toBe(true)
  })
  it('parseDateRange vazio', () => {
    expect(parseDateRange()).toEqual({ dateFrom: null, dateTo: null })
  })
  it('formatOptionalDate', () => {
    expect(formatOptionalDate(null)).toBe('-')
    expect(formatOptionalDate('x')).toBe('-')
    expect(formatOptionalDate('2026-03-10')).toBe('10/03/2026')
  })
  it('formatCurrency', () => {
    expect(formatCurrency(1234.5).replace(/\s/g, ' ')).toBe('R$ 1.234,50')
    expect(formatCurrency('abc').replace(/\s/g, ' ')).toBe('R$ 0,00')
  })
})

describe('report-helpers: paginação e status', () => {
  it('paginate: total e páginas', () => {
    const items = Array.from({ length: 25 }, (_, n) => n)
    const p = paginate(items, 2, 10)
    expect(p.data).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect(p.pagination).toEqual({ page: 2, pageSize: 10, totalItems: 25, totalPages: 3 })
  })
  it('paginate: página além do fim vai para a última; lista vazia tem 1 página', () => {
    expect(paginate([1, 2, 3], 99, 2).pagination.page).toBe(2)
    expect(paginate([], 1, 10).pagination).toEqual({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 })
  })
  it('normalizeReportStatus', () => {
    expect(normalizeReportStatus('PAID')).toBe('paid')
    expect(normalizeReportStatus('cancelled')).toBe('cancelled')
    expect(normalizeReportStatus('partial')).toBe('pending')
    expect(normalizeReportStatus('overdue')).toBe('pending')
    expect(normalizeReportStatus(null)).toBe('pending')
    expect(normalizeReportStatus('qualquer')).toBe('pending')
  })
  it('normalizeStatusFilters / matchesStatusFilters', () => {
    expect(normalizeStatusFilters('all')).toEqual([])
    expect(normalizeStatusFilters(undefined)).toEqual([])
    expect(normalizeStatusFilters('paid,cancelled')).toEqual(['paid', 'cancelled'])
    expect(normalizeStatusFilters(['paid', 'partial'])).toEqual(['paid', 'pending'])
    expect(matchesStatusFilters('paid', [])).toBe(true)
    expect(matchesStatusFilters('paid', ['pending'])).toBe(false)
    expect(matchesStatusFilters('partial', ['pending'])).toBe(true)
  })
  it('formatStatusLabel', () => {
    expect(formatStatusLabel('paid')).toBe('Pago')
    expect(formatStatusLabel('')).toBe('-')
    expect(formatStatusLabel('algo_novo')).toBe('Algo Novo')
  })
  it('getPurchasePaymentStatus: paga, vencida e pendente', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 15))
    expect(getPurchasePaymentStatus({ payment_status: 'paid', due_date: '2020-01-01' })).toBe('paid')
    expect(getPurchasePaymentStatus({ payment_status: 'pending', due_date: '2026-01-01' })).toBe('overdue')
    expect(getPurchasePaymentStatus({ payment_status: 'pending', due_date: '2026-12-01' })).toBe('pending')
    expect(getPurchasePaymentStatus({ payment_status: 'pending' })).toBe('pending')
    expect(getPurchasePaymentStatus(null)).toBe('pending')
  })
})

describe('report-helpers: comparação de períodos', () => {
  const d = (y: number, m: number, day: number) => new Date(y, m - 1, day)
  const key = (x: Date) => `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`

  it('mesmo período do ano anterior', () => {
    const r = getPreviousRangeByMode(d(2026, 3, 1), d(2026, 3, 31), 'same_period_last_year')
    expect([key(r.previousStartDate), key(r.previousEndDate)]).toEqual(['2025-3-1', '2025-3-31'])
  })
  it('mês anterior (e virada de ano)', () => {
    const r = getPreviousRangeByMode(d(2026, 1, 10), d(2026, 1, 20), 'previous_month')
    expect([key(r.previousStartDate), key(r.previousEndDate)]).toEqual(['2025-12-1', '2025-12-31'])
  })
  it('trimestre anterior (e virada de ano)', () => {
    const q2 = getPreviousRangeByMode(d(2026, 5, 1), d(2026, 5, 31), 'previous_quarter')
    expect([key(q2.previousStartDate), key(q2.previousEndDate)]).toEqual(['2026-1-1', '2026-3-31'])
    const q1 = getPreviousRangeByMode(d(2026, 2, 1), d(2026, 2, 28), 'previous_quarter')
    expect([key(q1.previousStartDate), key(q1.previousEndDate)]).toEqual(['2025-10-1', '2025-12-31'])
  })
  it('padrão: período equivalente imediatamente anterior', () => {
    const r = getPreviousRangeByMode(d(2026, 3, 11), new Date(2026, 2, 20, 23, 59, 59, 999), 'qualquer')
    expect([key(r.previousStartDate), key(r.previousEndDate)]).toEqual(['2026-3-1', '2026-3-10'])
  })
  it('rótulos', () => {
    expect(getComparisonModeLabel('previous_month')).toBe('Mês anterior')
    expect(getComparisonModeLabel('x')).toBe('Período anterior equivalente')
  })
  it('calculateVariation: base zero não gera Infinity/NaN', () => {
    expect(calculateVariation(0, 0)).toEqual({ variation: 0, type: 'equal' })
    expect(calculateVariation(10, 0)).toMatchObject({ variation: null, type: 'increase', fromZeroBase: true })
    expect(calculateVariation(-10, 0)).toMatchObject({ variation: null, type: 'decrease' })
  })
  it('calculateVariation: aumento, queda e base negativa', () => {
    expect(calculateVariation(150, 100)).toEqual({ variation: 50, type: 'increase', fromZeroBase: false })
    expect(calculateVariation(50, 100)).toEqual({ variation: 50, type: 'decrease', fromZeroBase: false })
    expect(calculateVariation(100, 100)).toMatchObject({ variation: 0, type: 'equal' })
    expect(calculateVariation(-50, -100).type).toBe('increase')
  })
})

describe('profit-report-helpers', () => {
  const start = new Date(2026, 2, 1)
  const end = new Date(2026, 2, 31, 23, 59, 59, 999)

  const tx = [
    { type: 'income', status: 'paid', due_date: '2026-03-05', amount: 1000 },
    { type: 'income', status: 'pending', due_date: '2026-03-06', amount: 500 },
    { type: 'income', status: 'cancelled', due_date: '2026-03-06', amount: 999 },
    { type: 'expense', status: 'paid', due_date: '2026-03-07', amount: 400 },
    { type: 'expense', status: 'paid', due_date: '2026-04-01', amount: 77 },
    { type: 'income', status: 'paid', due_date: null, amount: 5 }
  ]

  it('fluxo de caixa: período, cancelados e filtro de status', () => {
    const all = calculateCashFlowFromTransactions(tx, start, end, [])
    expect(all).toMatchObject({ revenue: 1500, costs: 400, profit: 1100, orderCount: 2 })
    expect(all.profitMargin).toBeCloseTo(73.33, 1)
    const paidOnly = calculateCashFlowFromTransactions(tx, start, end, ['paid'])
    expect(paidOnly).toMatchObject({ revenue: 1000, costs: 400, profit: 600 })
  })
  it('fluxo de caixa: período vazio devolve zeros e margem 0', () => {
    expect(calculateCashFlowFromTransactions([], start, end, [])).toMatchObject({ revenue: 0, costs: 0, profit: 0, profitMargin: 0, orderCount: 0 })
  })
  it('evolução diária cobre todos os dias do período', () => {
    const data = calculateCashFlowFromTransactions(tx, start, end, [])
    const evolution = buildCashFlowTransactionsEvolutionData(data, start, end)
    expect(evolution).toHaveLength(31)
    expect(evolution.find(p => p.name === '05/03')).toMatchObject({ revenue: 1000, costs: 0, profit: 1000 })
    expect(evolution.reduce((s, p) => s + p.revenue, 0)).toBe(1500)
  })

  const orders = [
    { number: 'OS1', entry_date: '2026-03-02', status: 'completed', payment_status: 'paid', total_amount: 1000, total_cost_amount: 300, commission_amount: 100 },
    { number: 'OS2', entry_date: '2026-03-03', status: 'open', payment_status: 'pending', total_amount: 500, total_cost_amount: 0, commission_amount: 0 },
    { number: 'OS3', entry_date: '2026-05-03', status: 'completed', payment_status: 'paid', total_amount: 9999, total_cost_amount: 0, commission_amount: 0 }
  ]
  it('pelas OS: custo = peças + comissão', () => {
    const r = calculateByOrderPeriodData(orders, start, end)
    expect(r).toMatchObject({ revenue: 1500, partsCost: 300, commissionCost: 100, costs: 400, profit: 1100, orderCount: 2 })
  })
  it('pelas OS: filtros de status da OS e de pagamento', () => {
    expect(calculateByOrderPeriodData(orders, start, end, ['completed']).orderCount).toBe(1)
    expect(calculateByOrderPeriodData(orders, start, end, [], ['pending']).orderCount).toBe(1)
  })
  it('evolução pelas OS e top lucrativas', () => {
    const r = calculateByOrderPeriodData(orders, start, end)
    const evo = buildByOrderEvolutionData(r, start, end)
    expect(evo.find(p => p.name === '02/03')).toMatchObject({ revenue: 1000, costs: 400, profit: 600 })
    const top = buildTopProfitableOrders(orders)
    expect(top[0]).toMatchObject({ number: 'OS3', profit: 9999 })
    expect(top.find(t => t.number === 'OS1')).toMatchObject({ cost: 400, profit: 600, margin: 60 })
    expect(buildTopProfitableOrders(Array.from({ length: 15 }, (_, n) => ({ number: n, total_amount: n })))).toHaveLength(10)
  })
  it('margem de OS sem receita é 0 (sem NaN)', () => {
    expect(buildTopProfitableOrders([{ number: 'x', total_amount: 0, total_cost_amount: 10 }])[0]!.margin).toBe(0)
  })
  it('buildVariations e resolveComparison', () => {
    const cur = calculateByOrderPeriodData(orders, start, end)
    expect(buildVariations(cur, null)).toBeNull()
    expect(buildVariations(null, cur)).toBeNull()
    const prev = { ...cur, revenue: 750, costs: 400, profit: 350, profitMargin: 46 }
    expect(buildVariations(cur, prev)!.revenue).toMatchObject({ variation: 100, type: 'increase' })

    expect(resolveComparison(start, end, 'previous_month', false, () => cur)).toEqual({ previousData: null, comparisonMeta: null })
    const cmp = resolveComparison(start, end, 'previous_month', true, () => prev)
    expect(cmp.previousData).toBe(prev)
    expect(cmp.comparisonMeta).toMatchObject({ currentStartDate: '2026-03-01', previousStartDate: '2026-02-01', previousEndDate: '2026-02-28' })
  })
  it('toPublicPeriodData não vaza campos internos', () => {
    const data = calculateByOrderPeriodData(orders, start, end)
    const pub = toPublicPeriodData(data)!
    expect(Object.keys(pub).sort()).toEqual(['commissionCost', 'costs', 'orderCount', 'partsCost', 'profit', 'profitMargin', 'revenue'])
    expect(pub).not.toHaveProperty('orders')
    expect(pub).not.toHaveProperty('incomeData')
    expect(toPublicPeriodData(null)).toBeNull()
  })
})

describe('report-export (CSV e base64)', () => {
  it('csvEscape: aspas, vírgula e quebra de linha', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('diz "oi"')).toBe('"diz ""oi"""')
    expect(csvEscape('linha1\nlinha2')).toBe('"linha1 linha2"')
    expect(csvEscape(null)).toBe('""')
    expect(csvEscape(10)).toBe('"10"')
  })
  // KF-04: sem proteção contra injeção de fórmula (CSV injection) em planilhas.
  it.fails.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd'])('csvEscape neutraliza fórmula: %s', (value) => {
    expect(csvEscape(value)).toMatch(/^"'/)
  })
  it('base64 e data local', () => {
    expect(textToBase64('olá')).toBe(Buffer.from('olá').toString('base64'))
    expect(uint8ToBase64(new Uint8Array(50_000).fill(65))).toBe(Buffer.alloc(50_000, 'A').toString('base64'))
    expect(toLocalDateOnly(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('supabase-pagination: fetchAllOrganizationRows', () => {
  function client(pages: Array<unknown[] | { error: string }>) {
    const calls: string[] = []
    let page = 0
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'order']) {
      builder[m] = (...args: unknown[]) => { calls.push(`${m}:${args.map(String).join(',')}`); return builder }
    }
    builder.range = async (from: number, to: number) => {
      calls.push(`range:${from}-${to}`)
      const p = pages[page++]!
      return Array.isArray(p) ? { data: p, error: null } : { data: null, error: { message: p.error } }
    }
    return { calls, supabase: { from: () => builder } as never }
  }
  it('filtra sempre por organization_id', async () => {
    const { calls, supabase } = client([[{ id: 1 }]])
    await fetchAllOrganizationRows(supabase, { table: 't', organizationId: 'org-a', nullColumns: ['deleted_at'], eq: { k: 'v' } })
    expect(calls).toContain('eq:organization_id,org-a')
    expect(calls).toContain('is:deleted_at,null')
    expect(calls).toContain('eq:k,v')
  })
  it('pagina até receber página incompleta', async () => {
    const { calls, supabase } = client([[1, 2], [3, 4], [5]])
    const rows = await fetchAllOrganizationRows(supabase, { table: 't', organizationId: 'o', pageSize: 2 } as never)
    expect(rows).toEqual([1, 2, 3, 4, 5])
    expect(calls.filter(c => c.startsWith('range'))).toEqual(['range:0-1', 'range:2-3', 'range:4-5'])
  })
  it('erro vira 500 com a tabela na mensagem', async () => {
    const { supabase } = client([{ error: 'boom' }])
    await expect(fetchAllOrganizationRows(supabase, { table: 'clients', organizationId: 'o' })).rejects.toMatchObject({ statusCode: 500, statusMessage: expect.stringContaining('clients') })
  })
})

describe('busca e número de OS', () => {
  it('normalizeSearchText ignora acento e caixa', () => {
    expect(normalizeSearchText('  José ')).toBe('jose')
    expect(normalizeSearchText('AÇÃO')).toBe('acao')
    expect(normalizeSearchText(null)).toBe('')
  })
  it('normalizeOsNumber', () => {
    expect(normalizeOsNumber('123')).toBe('OS123')
    expect(normalizeOsNumber(' os 45 ')).toBe('OS45')
    expect(normalizeOsNumber('OS7')).toBe('OS7')
    expect(normalizeOsNumber('ABC-1')).toBe('ABC-1')
    expect(normalizeOsNumber('')).toBe('')
    expect(normalizeOsNumber(null)).toBe('')
  })
})
