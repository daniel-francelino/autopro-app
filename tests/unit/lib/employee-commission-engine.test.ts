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
  it('converte string ISO para o dia 1 do mês', () => {
    expect(toCommissionMonthStart('2026-03-17')).toBe('2026-03-01')
  })
  it('aceita Date', () => {
    expect(toCommissionMonthStart(new Date(2026, 11, 31, 23, 0))).toBe('2026-12-01')
  })
  it('dia 31 às 23h (horário local) não vira o mês seguinte', () => {
    expect(toCommissionMonthStart(new Date(2026, 0, 31, 23, 59, 59))).toBe('2026-01-01')
  })
  it('ano bissexto: 29/02', () => {
    expect(toCommissionMonthStart('2028-02-29')).toBe('2028-02-01')
  })
  it('currentCommissionMonthStart usa o relógio', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 20, 10))
    expect(currentCommissionMonthStart()).toBe('2026-05-01')
  })
})

describe('resolveEffectiveCommissionVersion', () => {
  const v = (id: string, effective_from: string) => ({ id, plan_id: 'p', effective_from, notes: null })
  it('sem versões devolve null', () => {
    expect(resolveEffectiveCommissionVersion([], '2026-03-01')).toBeNull()
  })
  it('uma versão vigente', () => {
    expect(resolveEffectiveCommissionVersion([v('a', '2026-01-01')], '2026-03-01')?.id).toBe('a')
  })
  it('várias versões: pega a de maior effective_from <= referência', () => {
    const versions = [v('a', '2026-01-01'), v('c', '2026-06-01'), v('b', '2026-03-01')]
    expect(resolveEffectiveCommissionVersion(versions, '2026-04-01')?.id).toBe('b')
  })
  it('versão futura é ignorada', () => {
    expect(resolveEffectiveCommissionVersion([v('f', '2026-09-01')], '2026-03-01')).toBeNull()
  })
  it('versão com effective_from igual à referência vale', () => {
    expect(resolveEffectiveCommissionVersion([v('a', '2026-03-01')], '2026-03-01')?.id).toBe('a')
  })
})

describe('getApplicableCommissionRule / matchCommissionRule', () => {
  const specific = rule({ id: 'spec', category_ids: ['c1'] })
  const fallback = rule({ id: 'def', is_default: true })

  it('regra específica vence a padrão', () => {
    expect(getApplicableCommissionRule([fallback, specific], 'c1')?.id).toBe('spec')
  })
  it('categoria sem regra específica cai na padrão', () => {
    expect(getApplicableCommissionRule([specific, fallback], 'c2')?.id).toBe('def')
  })
  it('item sem categoria cai na padrão', () => {
    expect(getApplicableCommissionRule([specific, fallback], null)?.id).toBe('def')
    expect(getApplicableCommissionRule([specific, fallback], undefined)?.id).toBe('def')
  })
  it('sem regra aplicável nem padrão devolve null', () => {
    expect(getApplicableCommissionRule([specific], 'c2')).toBeNull()
    expect(getApplicableCommissionRule([], 'c1')).toBeNull()
  })
  it('matchCommissionRule preserva o plan_id', () => {
    expect(matchCommissionRule([specific], 'c1')?.plan_id).toBe('p1')
  })
})

describe('computeCommissionAmount', () => {
  const fixed = rule({ commission_type: 'fixed_amount', commission_amount: 20, commission_base: null })
  it('percentual sobre faturamento', () => {
    expect(computeCommissionAmount(rule({ commission_amount: 10 }), { revenue: 200, profit: 50 })).toBe(20)
  })
  it('percentual sobre lucro', () => {
    expect(computeCommissionAmount(rule({ commission_base: 'profit', commission_amount: 10 }), { revenue: 200, profit: 50 })).toBe(5)
  })
  it('valor fixo é por unidade', () => {
    expect(computeCommissionAmount(fixed, { revenue: 1, profit: 1, quantity: 4 })).toBe(80)
  })
  it('valor fixo sem quantidade assume 1', () => {
    expect(computeCommissionAmount(fixed, { revenue: 1, profit: 1 })).toBe(20)
  })
  it('arredonda para 2 casas', () => {
    expect(computeCommissionAmount(rule({ commission_amount: 7.5 }), { revenue: 33.33, profit: 0 })).toBe(2.5)
    expect(computeCommissionAmount(rule({ commission_amount: 3 }), { revenue: 10.01, profit: 0 })).toBe(0.3)
  })
  it('percentual 0 = 0', () => {
    expect(computeCommissionAmount(rule({ commission_amount: 0 }), { revenue: 999, profit: 999 })).toBe(0)
  })
})

describe('buildCommissionSnapshot', () => {
  it('sem regra devolve null', () => {
    expect(buildCommissionSnapshot([], { categoryId: 'x', revenue: 1, profit: 1 })).toBeNull()
  })
  it('monta o snapshot completo', () => {
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

  it('sem regras ou sem itens: nada elegível', () => {
    expect(computeEmployeeOrderCommission([], [item()], ctx).hasMatchingItems).toBe(false)
    expect(computeEmployeeOrderCommission([rule({ is_default: true })], [], ctx)).toMatchObject({ hasMatchingItems: false, total: 0 })
  })
  it('nenhum item casa com as regras', () => {
    const result = computeEmployeeOrderCommission([rule({ category_ids: ['c1'] })], [item({ categoryId: 'c2' })], ctx)
    expect(result).toMatchObject({ hasMatchingItems: false, total: 0 })
    expect(result.perItem).toEqual([null])
  })
  it('vários itens com regras mistas; soma por item == total', () => {
    const rules = [
      rule({ id: 'a', category_ids: ['c1'], commission_amount: 10 }),
      rule({ id: 'b', is_default: true, commission_amount: 5 })
    ]
    const items = [item({ categoryId: 'c1', total: 100 }), item({ categoryId: 'c9', total: 200 })]
    const result = computeEmployeeOrderCommission(rules, items, ctx)
    expect(result.perItem.map(p => p?.amount)).toEqual([10, 10])
    expect(result.total).toBe(20)
  })
  it('desconto é rateado entre itens elegíveis', () => {
    const result = computeEmployeeOrderCommission(
      [rule({ is_default: true, commission_amount: 10 })],
      [item({ total: 100 }), item({ total: 100 })],
      { discount: 20, totalTaxesAmount: 0 }
    )
    expect(result.total).toBe(18)
  })
  it('lucro nunca é negativo (custo maior que a venda)', () => {
    const result = computeEmployeeOrderCommission(
      [rule({ is_default: true, commission_base: 'profit', commission_amount: 10 })],
      [item({ total: 100, cost: 500 })],
      ctx
    )
    expect(result.total).toBe(0)
    expect(result.perItem[0]).toBeNull()
    expect(result.allMatches[0]?.amount).toBe(0)
  })
  it('impostos reduzem o lucro', () => {
    const result = computeEmployeeOrderCommission(
      [rule({ is_default: true, commission_base: 'profit', commission_amount: 10 })],
      [item({ total: 100, cost: 40 })],
      { discount: 0, totalTaxesAmount: 10 }
    )
    expect(result.total).toBe(5)
  })
  it('valor fixo multiplica pela quantidade', () => {
    expect(computeEmployeeOrderCommission([fixedDefault(20)], [item({ total: 400, quantity: 4 })], ctx).total).toBe(80)
  })
  it('quantidade inválida (0, NaN) vira 1', () => {
    expect(computeEmployeeOrderCommission([fixedDefault(20)], [item({ quantity: 0 })], ctx).total).toBe(20)
    expect(computeEmployeeOrderCommission([fixedDefault(20)], [item({ quantity: Number.NaN })], ctx).total).toBe(20)
  })
  it('itens com total 0 não geram NaN', () => {
    const result = computeEmployeeOrderCommission([fixedDefault(5)], [item({ total: 0 }), item({ total: 0 })], { discount: 10, totalTaxesAmount: 0 })
    expect(Number.isNaN(result.total)).toBe(false)
    expect(result.total).toBe(10)
  })
  it('regressão de arredondamento: total tem no máximo 2 casas', () => {
    const items = Array.from({ length: 3 }, () => item({ total: 33.33 }))
    const result = computeEmployeeOrderCommission([rule({ is_default: true, commission_amount: 3 })], items, ctx)
    expect(Math.round(result.total * 100) / 100).toBe(result.total)
  })
})

describe('leitores de campos do item', () => {
  it('quantidade: ausente=1, string numérica, inválida=1', () => {
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
  it('total_price = 0 explícito é respeitado', () => {
    expect(getOrderItemTotal({ total_price: 0, unit_price: 10, quantity: 3 })).toBe(0)
  })
  it('custo: cost_price ?? cost_amount, multiplicado pela quantidade', () => {
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

describe('override manual de comissão', () => {
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

  it('log vazio: sem override', () => {
    expect(getActiveCommissionOverride([], 'e1')).toBeNull()
    expect(getActiveOverridePlanIds([])).toEqual([])
  })
  it('recálculo simples (sem override_action) não conta', () => {
    expect(getActiveCommissionOverride([entry({})], 'e1')).toBeNull()
  })
  it('apply é o override ativo', () => {
    expect(getActiveCommissionOverride([apply('pA')], 'e1')).toEqual({ employeeId: 'e1', commissionPlanId: 'pA', commissionPlanName: 'Plano pA' })
  })
  it('apply → remove → sem override', () => {
    expect(getActiveCommissionOverride([apply('pA'), remove()], 'e1')).toBeNull()
  })
  it('apply → remove → apply: vale o último', () => {
    expect(getActiveCommissionOverride([apply('pA'), remove(), apply('pB')], 'e1')?.commissionPlanId).toBe('pB')
  })
  it('apply seguido de recálculo simples mantém o override', () => {
    expect(getActiveCommissionOverride([apply('pA'), entry({})], 'e1')?.commissionPlanId).toBe('pA')
  })
  it('override é por funcionário', () => {
    expect(getActiveCommissionOverride([apply('pA', 'e2')], 'e1')).toBeNull()
  })
  it('getActiveOverridePlanIds devolve planos distintos só dos ativos', () => {
    const log = [apply('pA', 'e1'), apply('pA', 'e2'), apply('pB', 'e3'), remove('e3')]
    expect(getActiveOverridePlanIds(log)).toEqual(['pA'])
  })

  describe('resolveEffectiveCommissionRules', () => {
    const standard = rule({ id: 'std', is_default: true, plan_id: 'pStd' })
    const over = rule({ id: 'ovr', category_ids: ['c1'], plan_id: 'pA' })
    const base = new Map([['e1', [standard]], ['e2', [standard]]])
    const plans = new Map([['pA', [over]]])

    it('log vazio devolve o mesmo mapa', () => {
      expect(resolveEffectiveCommissionRules(base, [], plans)).toBe(base)
    })
    it('regras do override ficam antes das padrão (patch, não substituição)', () => {
      const result = resolveEffectiveCommissionRules(base, [apply('pA')], plans)
      expect(result.get('e1')!.map(r => r.id)).toEqual(['ovr', 'std'])
      expect(result.get('e2')!.map(r => r.id)).toEqual(['std'])
      expect(getApplicableCommissionRule(result.get('e1') as CommissionRuleRecord[], 'c1')?.id).toBe('ovr')
      expect(getApplicableCommissionRule(result.get('e1') as CommissionRuleRecord[], 'c2')?.id).toBe('std')
    })
    it('plano do override sem regras resolvidas mantém as padrão', () => {
      expect(resolveEffectiveCommissionRules(base, [apply('pZ')], plans).get('e1')!.map(r => r.id)).toEqual(['std'])
    })
    it('não muta o mapa de entrada', () => {
      resolveEffectiveCommissionRules(base, [apply('pA')], plans)
      expect(base.get('e1')!.map(r => r.id)).toEqual(['std'])
    })
  })
})
