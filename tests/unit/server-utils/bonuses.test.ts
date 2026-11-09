import { describe, expect, it } from 'vitest'
import {
  lastDayOfMonth,
  monthDateRange,
  resolveDueDate,
  resolveEffectiveVersion,
  sumAchievedAmount,
  toMonthStart
} from '../../../server/utils/bonuses'

describe('datas de bônus', () => {
  it('toMonthStart', () => {
    expect(toMonthStart('2026-07-15')).toBe('2026-07-01')
    expect(toMonthStart(new Date(2026, 0, 31, 23, 59))).toBe('2026-01-01')
  })
  it('lastDayOfMonth: fevereiro comum, bissexto e meses de 30/31 dias', () => {
    expect(lastDayOfMonth('2026-02-01')).toBe('2026-02-28')
    expect(lastDayOfMonth('2028-02-01')).toBe('2028-02-29')
    expect(lastDayOfMonth('2026-04-01')).toBe('2026-04-30')
    expect(lastDayOfMonth('2026-12-01')).toBe('2026-12-31')
  })
  it('monthDateRange cobre o mês inteiro', () => {
    const { start, end } = monthDateRange('2026-03-01')
    expect(start.getDate()).toBe(1)
    expect(end.getDate()).toBe(31)
    expect(end.getHours()).toBe(23)
  })
  it('resolveDueDate: sem dia → último dia', () => {
    expect(resolveDueDate('2026-04-01', null)).toBe('2026-04-30')
    expect(resolveDueDate('2026-04-01', undefined)).toBe('2026-04-30')
    expect(resolveDueDate('2026-04-01', 0)).toBe('2026-04-30')
  })
  it('resolveDueDate: dia configurado e dia 31 em mês de 30 dias', () => {
    expect(resolveDueDate('2026-04-01', 10)).toBe('2026-04-10')
    expect(resolveDueDate('2026-04-01', 31)).toBe('2026-04-30')
    expect(resolveDueDate('2026-02-01', 30)).toBe('2026-02-28')
  })
})

describe('resolveEffectiveVersion (bônus)', () => {
  const v = (id: string, effective_from: string) => ({
    id, bonus_id: 'b', commission_base: 'revenue' as const, goal_amount: 1, bonus_amount: 1, effective_from
  })
  it('null sem versões / só futuras', () => {
    expect(resolveEffectiveVersion([], '2026-03-01')).toBeNull()
    expect(resolveEffectiveVersion([v('a', '2026-05-01')], '2026-03-01')).toBeNull()
  })
  it('pega a de maior effective_from <= mês', () => {
    expect(resolveEffectiveVersion([v('a', '2026-01-01'), v('b', '2026-03-01'), v('c', '2026-08-01')], '2026-04-01')?.id).toBe('b')
  })
})

describe('sumAchievedAmount', () => {
  const order = (o: Record<string, unknown> = {}) => ({
    id: 'o1',
    status: 'completed',
    employee_responsible_id: 'e1',
    entry_date: '2026-03-10',
    total_amount: 1000,
    total_cost_amount: 300,
    items: [],
    ...o
  })
  const month = '2026-03-01'

  it('revenue soma o faturamento', () => {
    expect(sumAchievedAmount([order(), order({ id: 'o2', total_amount: 500 })], 'e1', month, 'revenue')).toBe(1500)
  })
  it('profit = faturamento - custo de peças', () => {
    expect(sumAchievedAmount([order()], 'e1', month, 'profit')).toBe(700)
  })
  it('employee_net_profit desconta a comissão do funcionário naquela OS', () => {
    const commissions = [
      { employee_id: 'e1', service_order_id: 'o1', amount: 100 },
      { employee_id: 'e2', service_order_id: 'o1', amount: 50 }
    ]
    expect(sumAchievedAmount([order()], 'e1', month, 'employee_net_profit', commissions)).toBe(600)
  })
  it('revenue_minus_parts sem itens cai no total - custo', () => {
    expect(sumAchievedAmount([order()], 'e1', month, 'revenue_minus_parts')).toBe(700)
  })
  it('revenue_minus_parts conta só itens atribuídos ao funcionário', () => {
    const items = [
      { quantity: 1, total_amount: 400, cost_amount: 100, commissions: [{ employee_id: 'e1' }] },
      { quantity: 2, total_amount: 600, cost_amount: 50, commissions: [{ employee_id: 'e2' }] },
      { quantity: 1, total_amount: 200, cost_amount: 20, commissions: [] }
    ]
    expect(sumAchievedAmount([order({ items })], 'e1', month, 'revenue_minus_parts')).toBe(480)
  })
  it('ignora OS não concluída, de outro funcionário e de outro mês', () => {
    const orders = [
      order({ status: 'open' }),
      order({ employee_responsible_id: 'e2' }),
      order({ entry_date: '2026-04-01' }),
      order({ entry_date: null })
    ]
    expect(sumAchievedAmount(orders, 'e1', month, 'revenue')).toBe(0)
  })
  it('reconhece co-responsável e status invoiced', () => {
    const o = order({ employee_responsible_id: 'x', responsible_employees: [{ employee_id: 'e1' }], status: 'invoiced' })
    expect(sumAchievedAmount([o], 'e1', month, 'revenue')).toBe(1000)
  })
  it('limites do mês: primeiro e último dia entram', () => {
    expect(sumAchievedAmount([order({ entry_date: '2026-03-01' }), order({ entry_date: '2026-03-31' })], 'e1', month, 'revenue')).toBe(2000)
  })
  it('arredonda para 2 casas', () => {
    expect(sumAchievedAmount([order({ total_amount: 0.1 }), order({ total_amount: 0.2 })], 'e1', month, 'revenue')).toBe(0.3)
  })
})
