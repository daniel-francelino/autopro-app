import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildCommissionSnapshot,
  computeCommissionAmount,
  computeEmployeeOrderCommission,
  currentCommissionMonthStart,
  getActiveCommissionOverride,
  getActiveOverridePlanIds,
  getApplicableCommissionRule,
  getOrderItemCost,
  getOrderItemQuantity,
  getOrderItemTotal,
  matchCommissionRule,
  resolveEffectiveCommissionRules,
  resolveEffectiveCommissionVersion,
  toCommissionMonthStart,
  toCommissionOrderItemInput,
  type CommissionManualAdjustmentLogEntry,
  type CommissionRuleRecord,
  type ResolvedCommissionRule
} from '../../../lib/utils/employee-commission-engine'

function rule(overrides: Partial<ResolvedCommissionRule> = {}): ResolvedCommissionRule {
  return {
    id: 'r1',
    version_id: 'v1',
    plan_id: 'p1',
    name: 'Regra',
    commission_type: 'percentage',
    commission_amount: 10,
    commission_base: 'revenue',
    is_default: false,
    sort_order: 0,
    category_ids: [],
    ...overrides
  }
}

afterEach(() => vi.useRealTimers())

describe('toCommissionMonthStart', () => {
  it('converts an ISO string to the 1st day of the month', () => {
    expect(toCommissionMonthStart('2026-03-17')).toBe('2026-03-01')
  })
  it('accepts Date', () => {
    expect(toCommissionMonthStart(new Date(2026, 11, 31, 23, 0))).toBe('2026-12-01')
  })
  it('day 31 at 23h (local time) does not become the next month', () => {
    expect(toCommissionMonthStart(new Date(2026, 0, 31, 23, 59, 59))).toBe('2026-01-01')
  })
  it('leap year: 29/02', () => {
    expect(toCommissionMonthStart('2028-02-29')).toBe('2028-02-01')
  })
  it('currentCommissionMonthStart uses the clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 20, 10))
    expect(currentCommissionMonthStart()).toBe('2026-05-01')
  })
})

describe('resolveEffectiveCommissionVersion', () => {
  const v = (id: string, effective_from: string) => ({ id, plan_id: 'p', effective_from, notes: null })
  it('no versions returns null', () => {
    expect(resolveEffectiveCommissionVersion([], '2026-03-01')).toBeNull()
  })
  it('one version in force', () => {
    expect(resolveEffectiveCommissionVersion([v('a', '2026-01-01')], '2026-03-01')?.id).toBe('a')
  })
  it('several versions: picks the one with the greatest effective_from <= reference', () => {
    const versions = [v('a', '2026-01-01'), v('c', '2026-06-01'), v('b', '2026-03-01')]
    expect(resolveEffectiveCommissionVersion(versions, '2026-04-01')?.id).toBe('b')
  })
  it('future version is ignored', () => {
    expect(resolveEffectiveCommissionVersion([v('f', '2026-09-01')], '2026-03-01')).toBeNull()
  })
  it('version with effective_from equal to the reference applies', () => {
    expect(resolveEffectiveCommissionVersion([v('a', '2026-03-01')], '2026-03-01')?.id).toBe('a')
  })
})

describe('getApplicableCommissionRule / matchCommissionRule', () => {
  const specific = rule({ id: 'spec', category_ids: ['c1'] })
  const fallback = rule({ id: 'def', is_default: true })

  it('specific rule beats the default', () => {
    expect(getApplicableCommissionRule([fallback, specific], 'c1')?.id).toBe('spec')
  })
  it('category without specific rule falls back to the default', () => {
    expect(getApplicableCommissionRule([specific, fallback], 'c2')?.id).toBe('def')
  })
  it('item without category falls back to the default', () => {
    expect(getApplicableCommissionRule([specific, fallback], null)?.id).toBe('def')
    expect(getApplicableCommissionRule([specific, fallback], undefined)?.id).toBe('def')
  })
  it('no applicable rule nor default returns null', () => {
    expect(getApplicableCommissionRule([specific], 'c2')).toBeNull()
    expect(getApplicableCommissionRule([], 'c1')).toBeNull()
  })
  it('matchCommissionRule preserva o plan_id', () => {
    expect(matchCommissionRule([specific], 'c1')?.plan_id).toBe('p1')
  })
})

describe('computeCommissionAmount', () => {
  const fixed = rule({ commission_type: 'fixed_amount', commission_amount: 20, commission_base: null })
  it('percentage over revenue', () => {
    expect(computeCommissionAmount(rule({ commission_amount: 10 }), { revenue: 200, profit: 50 })).toBe(20)
  })
  it('percentage over profit', () => {
    expect(computeCommissionAmount(rule({ commission_base: 'profit', commission_amount: 10 }), { revenue: 200, profit: 50 })).toBe(5)
  })
  it('fixed amount is per unit', () => {
    expect(computeCommissionAmount(fixed, { revenue: 1, profit: 1, quantity: 4 })).toBe(80)
  })
  it('fixed amount without quantity assumes 1', () => {
    expect(computeCommissionAmount(fixed, { revenue: 1, profit: 1 })).toBe(20)
  })
  it('rounds to 2 decimals', () => {
    expect(computeCommissionAmount(rule({ commission_amount: 7.5 }), { revenue: 33.33, profit: 0 })).toBe(2.5)
    expect(computeCommissionAmount(rule({ commission_amount: 3 }), { revenue: 10.01, profit: 0 })).toBe(0.3)
  })
  it('percentage 0 = 0', () => {
    expect(computeCommissionAmount(rule({ commission_amount: 0 }), { revenue: 999, profit: 999 })).toBe(0)
  })
})

describe('buildCommissionSnapshot', () => {
  it('no rule returns null', () => {
    expect(buildCommissionSnapshot([], { categoryId: 'x', revenue: 1, profit: 1 })).toBeNull()
  })
  it('builds the full snapshot', () => {
    const snap = buildCommissionSnapshot([rule({ is_default: true, name: 'Padrão' })], { categoryId: null, revenue: 100, profit: 40 })
    expect(snap).toEqual({
      commission_plan_id: 'p1',
      commission_rule_id: 'r1',
      commission_rule_version_id: 'v1',
      commission_rule_name: 'Padrão',
      commission_amount_snapshot: 10,
      commission_type: 'percentage',
      commission_base: 'revenue'
    })
  })
})

describe('computeEmployeeOrderCommission', () => {
  const ctx = { discount: 0, totalTaxesAmount: 0 }
  const item = (o: Partial<{ categoryId: string | null, total: number, cost: number, quantity: number }> = {}) =>
    ({ categoryId: null, total: 100, cost: 0, quantity: 1, ...o })
  const fixedDefault = (amount: number) =>
    rule({ is_default: true, commission_type: 'fixed_amount', commission_base: null, commission_amount: amount })

  it('no rules or no items: nothing eligible', () => {
    expect(computeEmployeeOrderCommission([], [item()], ctx).hasMatchingItems).toBe(false)
    expect(computeEmployeeOrderCommission([rule({ is_default: true })], [], ctx)).toMatchObject({ hasMatchingItems: false, total: 0 })
  })
  it('no item matches the rules', () => {
    const result = computeEmployeeOrderCommission([rule({ category_ids: ['c1'] })], [item({ categoryId: 'c2' })], ctx)
    expect(result).toMatchObject({ hasMatchingItems: false, total: 0 })
    expect(result.perItem).toEqual([null])
  })
  it('several items with mixed rules; sum per item == total', () => {
    const rules = [
      rule({ id: 'a', category_ids: ['c1'], commission_amount: 10 }),
      rule({ id: 'b', is_default: true, commission_amount: 5 })
    ]
    const items = [item({ categoryId: 'c1', total: 100 }), item({ categoryId: 'c9', total: 200 })]
    const result = computeEmployeeOrderCommission(rules, items, ctx)
    expect(result.perItem.map(p => p?.amount)).toEqual([10, 10])
    expect(result.total).toBe(20)
  })
  it('discount is prorated among eligible items', () => {
    const result = computeEmployeeOrderCommission(
      [rule({ is_default: true, commission_amount: 10 })],
      [item({ total: 100 }), item({ total: 100 })],
      { discount: 20, totalTaxesAmount: 0 }
    )
    expect(result.total).toBe(18)
  })
  it('profit is never negative (cost greater than sale)', () => {
    const result = computeEmployeeOrderCommission(
      [rule({ is_default: true, commission_base: 'profit', commission_amount: 10 })],
      [item({ total: 100, cost: 500 })],
      ctx
    )
    expect(result.total).toBe(0)
    expect(result.perItem[0]).toBeNull()
    expect(result.allMatches[0]?.amount).toBe(0)
  })
  it('taxes reduce profit', () => {
    const result = computeEmployeeOrderCommission(
      [rule({ is_default: true, commission_base: 'profit', commission_amount: 10 })],
      [item({ total: 100, cost: 40 })],
      { discount: 0, totalTaxesAmount: 10 }
    )
    expect(result.total).toBe(5)
  })
  it('fixed amount multiplies by quantity', () => {
    expect(computeEmployeeOrderCommission([fixedDefault(20)], [item({ total: 400, quantity: 4 })], ctx).total).toBe(80)
  })
  it('invalid quantity (0, NaN) becomes 1', () => {
    expect(computeEmployeeOrderCommission([fixedDefault(20)], [item({ quantity: 0 })], ctx).total).toBe(20)
    expect(computeEmployeeOrderCommission([fixedDefault(20)], [item({ quantity: Number.NaN })], ctx).total).toBe(20)
  })
  it('items with total 0 do not generate NaN', () => {
    const result = computeEmployeeOrderCommission([fixedDefault(5)], [item({ total: 0 }), item({ total: 0 })], { discount: 10, totalTaxesAmount: 0 })
    expect(Number.isNaN(result.total)).toBe(false)
    expect(result.total).toBe(10)
  })
  it('rounding regression: total has at most 2 decimals', () => {
    const items = Array.from({ length: 3 }, () => item({ total: 33.33 }))
    const result = computeEmployeeOrderCommission([rule({ is_default: true, commission_amount: 3 })], items, ctx)
    expect(Math.round(result.total * 100) / 100).toBe(result.total)
  })
})

describe('item field readers', () => {
  it('quantity: missing=1, numeric string, invalid=1', () => {
    expect(getOrderItemQuantity({})).toBe(1)
    expect(getOrderItemQuantity({ quantity: '3' })).toBe(3)
    expect(getOrderItemQuantity({ quantity: 'abc' })).toBe(1)
    expect(getOrderItemQuantity({ quantity: -2 })).toBe(1)
    expect(getOrderItemQuantity({ quantity: null })).toBe(1)
  })
  it('total: total_price > total_amount > unit_price*quantity', () => {
    expect(getOrderItemTotal({ total_price: 50, total_amount: 70 })).toBe(50)
    expect(getOrderItemTotal({ total_amount: '70' })).toBe(70)
    expect(getOrderItemTotal({ unit_price: 10, quantity: 3 })).toBe(30)
    expect(getOrderItemTotal({})).toBe(0)
  })
  it('explicit total_price = 0 is respected', () => {
    expect(getOrderItemTotal({ total_price: 0, unit_price: 10, quantity: 3 })).toBe(0)
  })
  it('cost: cost_price ?? cost_amount, multiplied by quantity', () => {
    expect(getOrderItemCost({ cost_price: 5, quantity: 2 })).toBe(10)
    expect(getOrderItemCost({ cost_amount: '4', quantity: 2 })).toBe(8)
    expect(getOrderItemCost({})).toBe(0)
  })
  it('toCommissionOrderItemInput', () => {
    expect(toCommissionOrderItemInput({ category_id: 'c', unit_price: 10, quantity: 2, cost_price: 3 }))
      .toEqual({ categoryId: 'c', total: 20, cost: 6, quantity: 2 })
    expect(toCommissionOrderItemInput({}).categoryId).toBeNull()
  })
})

describe('manual commission override', () => {
  const entry = (o: Partial<CommissionManualAdjustmentLogEntry>): CommissionManualAdjustmentLogEntry => ({
    employee_id: 'e1',
    employee_name: 'A',
    reason: 'x',
    previous_amount: 0,
    new_amount: 0,
    recalculated_by_email: null,
    recalculated_by_name: null,
    recalculated_at: '2026-01-01',
    ...o
  })
  const apply = (plan: string, e = 'e1') =>
    entry({ employee_id: e, override_action: 'apply', override_commission_plan_id: plan, override_commission_plan_name: `Plano ${plan}` })
  const remove = (e = 'e1') =>
    entry({ employee_id: e, override_action: 'remove', override_commission_plan_id: null })

  it('empty log: no override', () => {
    expect(getActiveCommissionOverride([], 'e1')).toBeNull()
    expect(getActiveOverridePlanIds([])).toEqual([])
  })
  it('simple recalculation (without override_action) does not count', () => {
    expect(getActiveCommissionOverride([entry({})], 'e1')).toBeNull()
  })
  it('apply is the active override', () => {
    expect(getActiveCommissionOverride([apply('pA')], 'e1')).toEqual({ employeeId: 'e1', commissionPlanId: 'pA', commissionPlanName: 'Plano pA' })
  })
  it('apply → remove → no override', () => {
    expect(getActiveCommissionOverride([apply('pA'), remove()], 'e1')).toBeNull()
  })
  it('apply → remove → apply: the last one counts', () => {
    expect(getActiveCommissionOverride([apply('pA'), remove(), apply('pB')], 'e1')?.commissionPlanId).toBe('pB')
  })
  it('apply followed by simple recalculation keeps the override', () => {
    expect(getActiveCommissionOverride([apply('pA'), entry({})], 'e1')?.commissionPlanId).toBe('pA')
  })
  it('override is per employee', () => {
    expect(getActiveCommissionOverride([apply('pA', 'e2')], 'e1')).toBeNull()
  })
  it('getActiveOverridePlanIds returns distinct plans only of the active ones', () => {
    const log = [apply('pA', 'e1'), apply('pA', 'e2'), apply('pB', 'e3'), remove('e3')]
    expect(getActiveOverridePlanIds(log)).toEqual(['pA'])
  })

  describe('resolveEffectiveCommissionRules', () => {
    const standard = rule({ id: 'std', is_default: true, plan_id: 'pStd' })
    const over = rule({ id: 'ovr', category_ids: ['c1'], plan_id: 'pA' })
    const base = new Map([['e1', [standard]], ['e2', [standard]]])
    const plans = new Map([['pA', [over]]])

    it('empty log returns the same map', () => {
      expect(resolveEffectiveCommissionRules(base, [], plans)).toBe(base)
    })
    it('override rules come before the defaults (patch, not replacement)', () => {
      const result = resolveEffectiveCommissionRules(base, [apply('pA')], plans)
      expect(result.get('e1')!.map(r => r.id)).toEqual(['ovr', 'std'])
      expect(result.get('e2')!.map(r => r.id)).toEqual(['std'])
      expect(getApplicableCommissionRule(result.get('e1') as CommissionRuleRecord[], 'c1')?.id).toBe('ovr')
      expect(getApplicableCommissionRule(result.get('e1') as CommissionRuleRecord[], 'c2')?.id).toBe('std')
    })
    it('override plan without resolved rules keeps the defaults', () => {
      expect(resolveEffectiveCommissionRules(base, [apply('pZ')], plans).get('e1')!.map(r => r.id)).toEqual(['std'])
    })
    it('does not mutate the input map', () => {
      resolveEffectiveCommissionRules(base, [apply('pA')], plans)
      expect(base.get('e1')!.map(r => r.id)).toEqual(['std'])
    })
  })
})
