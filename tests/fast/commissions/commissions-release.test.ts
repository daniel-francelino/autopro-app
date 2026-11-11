// Comissões — releaseServiceOrderCommissions (server/utils/service-order-commissions.ts)
// Cenários C-xx documentados em docs/testing/financial-core-test-analysis.md.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { releaseServiceOrderCommissions } from '../../../server/utils/service-order-commissions'

const ORG = 'org-a'
const rules = vi.hoisted(() => ({ byEmployee: new Map<string, unknown[]>(), byPlan: new Map<string, unknown[]>() }))

vi.mock('../../../server/utils/employee-commission-plans', () => ({
  resolveEmployeeCommissionRulesForEmployees: vi.fn(async (_s: unknown, _o: string, ids: string[]) =>
    new Map(ids.filter(id => rules.byEmployee.has(id)).map(id => [id, rules.byEmployee.get(id)!]))),
  resolveCommissionPlanRules: vi.fn(async (_s: unknown, _o: string, planId: string) => rules.byPlan.get(planId) ?? []),
  fetchCommissionPlan: vi.fn(async (_s: unknown, _o: string, planId: string) =>
    planId === 'plan-x' ? { id: 'plan-x', name: 'Plano X', active: true } : planId === 'plan-off' ? { id: 'plan-off', name: 'Off', active: false } : null)
}))

const pct = (amount: number, base = 'revenue', extra: Record<string, unknown> = {}) => ({
  id: `rule-${amount}-${base}`, plan_id: 'plan-1', version_id: 'v1', name: `${amount}%`,
  commission_type: 'percentage', commission_amount: amount, commission_base: base, category_ids: [], is_default: true, ...extra
})

let fake: FakeSupabase

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1', organization_id: ORG, number: '100', status: 'completed', entry_date: '2026-03-10',
    total_amount: 1000, discount: 0, total_taxes_amount: 0, deleted_at: null,
    commission_release_mode: null, commission_manual_adjustments_log: [],
    responsible_employees: [{ employee_id: 'e1' }],
    items: [{ id: 'it1', total_price: 1000, cost_price: 0, quantity: 1, category_id: null }],
    ...overrides
  }
}

function seed(o: Record<string, unknown> = {}, installments: Array<Record<string, unknown>> = [], records: Array<Record<string, unknown>> = []) {
  fake = createFakeSupabase({
    service_orders: [order(o)],
    employees: [
      { id: 'e1', organization_id: ORG, name: 'Ana', deleted_at: null },
      { id: 'e2', organization_id: ORG, name: 'Bruno', deleted_at: null },
      { id: 'e-del', organization_id: ORG, name: 'Removido', deleted_at: '2026-01-01' }
    ],
    service_order_installments: installments.map((i, n) => ({ id: `i${n}`, organization_id: ORG, service_order_id: 'o1', deleted_at: null, ...i })),
    employee_financial_records: records.map((r, n) => ({
      id: `r${n}`, organization_id: ORG, service_order_id: 'o1', employee_id: 'e1', record_type: 'commission',
      created_at: `2026-03-1${n}T10:00:00Z`, ...r
    }))
  })
}

const run = (extra: Record<string, unknown> = {}) =>
  releaseServiceOrderCommissions({ supabase: fake.client, organizationId: ORG, orderId: 'o1', userEmail: 'u@x.com', ...extra } as never)
const records = (employee = 'e1') => fake.tables.employee_financial_records!.filter(r => r.employee_id === employee)
const sum = (rows: Array<Record<string, unknown>>) => Number(rows.reduce((s, r) => s + Number(r.amount), 0).toFixed(2))

beforeEach(() => {
  rules.byEmployee = new Map([['e1', [pct(10)]], ['e2', [pct(5)]]])
  rules.byPlan = new Map()
})

describe('C1–C6: release proportional to amount received', () => {
  it('C1: nothing received → no commission', async () => {
    seed({}, [{ status: 'pending', amount: 1000 }])
    const r = await run()
    expect(r.commissions).toHaveLength(0)
    expect(records()).toHaveLength(0)
    expect(r.totalCommission).toBe(100) // o direito total é calculado mesmo sem recebimento
  })
  it('C2: 50% received → 50% of commission', async () => {
    seed({}, [{ status: 'paid', amount: 500 }, { status: 'pending', amount: 500 }])
    await run()
    expect(sum(records())).toBe(50)
  })
  it('C3: 100% received → full commission', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }])
    await run()
    expect(sum(records())).toBe(100)
  })
  it('C4: received above total (ratio capped at 1) never pays more than the entitlement', async () => {
    seed({}, [{ status: 'paid', amount: 1500 }])
    await run()
    expect(sum(records())).toBe(100)
  })
  it('C5: "full" mode releases everything even without receipt', async () => {
    seed({ commission_release_mode: 'full' }, [{ status: 'pending', amount: 1000 }])
    await run()
    expect(sum(records())).toBe(100)
  })
  it('C6: OS with total 0 generates no commission and no NaN', async () => {
    seed({ total_amount: 0, items: [{ id: 'it1', total_price: 0, quantity: 1 }] }, [{ status: 'paid', amount: 0 }])
    const r = await run()
    expect(records()).toHaveLength(0)
    expect(Number.isNaN(r.totalCommission)).toBe(false)
  })
})

describe('C7–C12: top-ups, idempotence and rounding', () => {
  it('C7: second paid installment tops up only the difference (never duplicates)', async () => {
    seed({}, [{ status: 'paid', amount: 500 }, { status: 'pending', amount: 500 }])
    await run()
    fake.tables.service_order_installments![1]!.status = 'paid'
    await run()
    expect(records()).toHaveLength(2)
    expect(sum(records())).toBe(100)
  })
  it('C8: calling twice with no change is idempotent', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }])
    await run()
    await run()
    expect(records()).toHaveLength(1)
    expect(sum(records())).toBe(100)
  })
  it('C9: 3 installments of 333,33/333,33/333,34 sum EXACTLY the commission (no cent lost)', async () => {
    seed({ total_amount: 1000 }, [{ status: 'paid', amount: 333.33 }, { status: 'pending', amount: 333.33 }, { status: 'pending', amount: 333.34 }])
    await run()
    fake.tables.service_order_installments![1]!.status = 'paid'
    await run()
    fake.tables.service_order_installments![2]!.status = 'paid'
    await run()
    expect(sum(records())).toBe(100)
  })
  it('C10: commission with cents (7% of 333,33) closes at 2 decimals without accumulating error', async () => {
    rules.byEmployee.set('e1', [pct(7)])
    seed({ total_amount: 333.33, items: [{ id: 'it1', total_price: 333.33, quantity: 1 }] }, [{ status: 'paid', amount: 333.33 }])
    await run()
    expect(sum(records())).toBe(23.33)
  })
  it('C11: two responsibles each receive their own rule', async () => {
    seed({ responsible_employees: [{ employee_id: 'e1' }, { employee_id: 'e2' }] }, [{ status: 'paid', amount: 1000 }])
    await run()
    expect(sum(records('e1'))).toBe(100)
    expect(sum(records('e2'))).toBe(50)
  })
  it('C12: responsible without rule / deleted employee receives nothing', async () => {
    rules.byEmployee.delete('e2')
    seed({ responsible_employees: [{ employee_id: 'e2' }, { employee_id: 'e-del' }] }, [{ status: 'paid', amount: 1000 }])
    const r = await run()
    expect(fake.tables.employee_financial_records).toHaveLength(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})

describe('C13–C18: reversal (reverted receipts)', () => {
  it('C13: reversed receipt removes the corresponding pending commission', async () => {
    seed({}, [{ status: 'pending', amount: 1000 }], [{ amount: 100, status: 'pending' }])
    await run()
    expect(sum(records())).toBe(0)
  })
  it('C14: partial reversal reduces the last pending record', async () => {
    seed({}, [{ status: 'paid', amount: 500 }], [{ amount: 100, status: 'pending' }])
    await run()
    expect(sum(records())).toBe(50)
  })
  it('C15: commission ALREADY PAID is never deleted; excess becomes a reconciliation warning', async () => {
    seed({}, [{ status: 'pending', amount: 1000 }], [{ amount: 100, status: 'paid' }])
    const r = await run()
    expect(records()).toHaveLength(1)
    expect(records()[0]!.status).toBe('paid')
    expect(r.warnings.join(' ')).toMatch(/reconcilia/i)
  })
  it('C16: pending is consumed first; paid stays intact', async () => {
    seed({}, [{ status: 'paid', amount: 500 }], [{ amount: 50, status: 'paid' }, { amount: 50, status: 'pending' }])
    await run()
    expect(records().map(r => r.status)).toEqual(['paid'])
  })
  it('C17: OS from another organization/deleted → 404', async () => {
    seed({ deleted_at: '2026-01-01' })
    await expect(run()).rejects.toMatchObject({ statusCode: 404 })
  })
  it('C18: commission records from ANOTHER organization are not counted', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }], [{ amount: 100, status: 'pending', organization_id: 'org-b' }])
    await run()
    expect(fake.tables.employee_financial_records!.filter(r => r.organization_id === ORG)).toHaveLength(1)
  })
})

describe('C19–C26: calculation base, discount and items', () => {
  it('C19: discount reduces the commission base over revenue', async () => {
    seed({ total_amount: 900, discount: 100 }, [{ status: 'paid', amount: 900 }])
    await run()
    expect(sum(records())).toBe(90)
  })
  it('C20: profit base (revenue - cost)', async () => {
    rules.byEmployee.set('e1', [pct(10, 'profit')])
    seed({ items: [{ id: 'it1', total_price: 1000, cost_price: 400, quantity: 1 }] }, [{ status: 'paid', amount: 1000 }])
    await run()
    expect(sum(records())).toBe(60)
  })
  it('C21: cost greater than sale does not generate negative commission', async () => {
    rules.byEmployee.set('e1', [pct(10, 'profit')])
    seed({ items: [{ id: 'it1', total_price: 100, cost_price: 500, quantity: 1 }], total_amount: 100 }, [{ status: 'paid', amount: 100 }])
    await run()
    expect(records().every(r => Number(r.amount) >= 0)).toBe(true)
  })
  it('C22: OS without items generates no commission', async () => {
    seed({ items: [] }, [{ status: 'paid', amount: 1000 }])
    const r = await run()
    expect(r.commissions).toHaveLength(0)
  })
  it('C23: category rule only applies to items of the category', async () => {
    rules.byEmployee.set('e1', [pct(20, 'revenue', { id: 'cat', category_ids: ['c1'], is_default: false })])
    seed({ items: [{ id: 'a', total_price: 600, category_id: 'c1', quantity: 1 }, { id: 'b', total_price: 400, category_id: 'c2', quantity: 1 }] }, [{ status: 'paid', amount: 1000 }])
    await run()
    expect(sum(records())).toBe(120)
  })
  it('C24: fixed amount is per unit', async () => {
    rules.byEmployee.set('e1', [{ ...pct(0), commission_type: 'fixed_amount', commission_amount: 15 }])
    seed({ items: [{ id: 'a', total_price: 1000, quantity: 3 }] }, [{ status: 'paid', amount: 1000 }])
    await run()
    expect(sum(records())).toBe(45)
  })
  it('C25: stores the OS snapshot (commission_amount) with the full entitlement', async () => {
    seed({}, [{ status: 'pending', amount: 1000 }])
    await run()
    expect(fake.tables.service_orders![0]!.commission_amount).toBe(100)
  })
  it('C26: reference date comes from entry_date (month of the rule in force)', async () => {
    seed({ entry_date: '2026-03-31' }, [{ status: 'paid', amount: 1000 }])
    await run()
    expect(records()[0]!.reference_date).toBe('2026-03-31')
  })
})

describe('C27–C34: manual recalculation and override', () => {
  it('C27: manual recalculation requires a reason', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }])
    await expect(run({ employeeId: 'e1' })).rejects.toMatchObject({ statusCode: 400 })
  })
  it('C28: manual recalculation for someone who already has PAID commission is blocked', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }], [{ amount: 100, status: 'paid' }])
    await expect(run({ employeeId: 'e1', reason: 'teste' })).rejects.toMatchObject({ statusCode: 400 })
  })
  it('C29: manual recalculation consolidates pending items into a single line and logs it', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }], [{ amount: 30, status: 'pending' }, { amount: 20, status: 'pending' }])
    await run({ employeeId: 'e1', reason: 'ajuste', userName: 'Admin' })
    expect(records()).toHaveLength(1)
    expect(sum(records())).toBe(100)
    const log = fake.tables.service_orders![0]!.commission_manual_adjustments_log as Array<Record<string, unknown>>
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ employee_id: 'e1', previous_amount: 50, new_amount: 100, reason: 'ajuste' })
  })
  it('C30: manual recalculation of one employee does not touch the one of another employee', async () => {
    seed({ responsible_employees: [{ employee_id: 'e1' }, { employee_id: 'e2' }] }, [{ status: 'paid', amount: 1000 }], [{ amount: 10, status: 'pending', employee_id: 'e2' }])
    await run({ employeeId: 'e1', reason: 'x' })
    expect(sum(records('e2'))).toBe(10)
  })
  it('C31: override without employeeId → 400; without plan → 400; inactive/nonexistent plan → 400', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }])
    await expect(run({ overrideAction: 'apply' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(run({ employeeId: 'e1', reason: 'x', overrideAction: 'apply' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(run({ employeeId: 'e1', reason: 'x', overrideAction: 'apply', overrideCommissionPlanId: 'plan-off' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(run({ employeeId: 'e1', reason: 'x', overrideAction: 'apply', overrideCommissionPlanId: 'nope' })).rejects.toMatchObject({ statusCode: 400 })
  })
  it('C32: override applies the rules of the chosen plan and persists for future payments', async () => {
    rules.byPlan.set('plan-x', [pct(30)])
    seed({}, [{ status: 'paid', amount: 500 }, { status: 'pending', amount: 500 }])
    await run({ employeeId: 'e1', reason: 'acordo', overrideAction: 'apply', overrideCommissionPlanId: 'plan-x' })
    expect(sum(records())).toBe(150)
    fake.tables.service_order_installments![1]!.status = 'paid'
    await run() // pagamento posterior continua usando o override
    expect(sum(records())).toBe(300)
  })
  it('C33: removing override without an active override → 400', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }])
    await expect(run({ employeeId: 'e1', reason: 'x', overrideAction: 'remove' })).rejects.toMatchObject({ statusCode: 400 })
  })
  it('C34: no responsibles → empty response with warning, no error', async () => {
    seed({ responsible_employees: [] }, [{ status: 'paid', amount: 1000 }])
    const r = await run()
    expect(r.commissions).toEqual([])
    expect(r.warnings).toHaveLength(1)
  })
})

describe('C35–C36: real incidents (docs/finance/auditoria-arredondamento-comissoes-2026-09-10.md)', () => {
  it('C35: per-item rounding drifts at most 1 cent per item (3 × 33,33 at 10%)', async () => {
    seed({ total_amount: 99.99, items: [1, 2, 3].map(n => ({ id: `i${n}`, total_price: 33.33, quantity: 1 })) }, [{ status: 'paid', amount: 99.99 }])
    await run()
    const exact = 99.99 * 0.1
    expect(Math.abs(sum(records()) - exact)).toBeLessThanOrEqual(0.03 + 1e-9)
  })
  // KF-36: incidente de 10/09/2026 — recálculo manual de quem ficou sem regra aplicável ZEROU R$ 7.130,99 de
  // comissões pendentes em 21 OS, sem confirmação. O comportamento correto é recusar (ou exigir confirmação).
  it.fails('KF-36: manual recalculation for an employee without applicable rule does NOT silently delete the pending commission', async () => {
    rules.byEmployee.delete('e1')
    seed({}, [{ status: 'paid', amount: 1000 }], [{ amount: 100, status: 'pending' }])
    await run({ employeeId: 'e1', reason: 'conferência' }).catch(() => undefined)
    expect(sum(records())).toBe(100)
  })
})

describe('Known loose ends (KF-24 to KF-26) — the test describes the correct behavior', () => {
  // KF-24: o recebido é somado só das parcelas 'paid'; o valor já recebido numa parcela 'partial' é ignorado.
  it.fails('KF-24: PARTIAL installment already received releases the proportional commission', async () => {
    seed({}, [{ status: 'partial', amount: 1000 }])
    fake.tables.financial_transactions = [
      { id: 't1', organization_id: ORG, service_order_installment_id: 'i0', type: 'income', status: 'paid', amount: 600, deleted_at: null }
    ]
    await run()
    expect(sum(records())).toBe(60)
  })
  // KF-25: funcionário que deixou de ser responsável pela OS mantém a comissão pendente antiga.
  it.fails('KF-25: whoever left the responsibles list loses the still-pending commission', async () => {
    seed({ responsible_employees: [{ employee_id: 'e2' }] }, [{ status: 'paid', amount: 1000 }], [{ amount: 100, status: 'pending', employee_id: 'e1' }])
    await run()
    expect(sum(records('e1'))).toBe(0)
  })
  // KF-26: se a regra passa a render 0 (ex.: plano desativado), o pendente antigo não é recolhido no fluxo automático.
  it.fails('KF-26: rule that now yields 0 reverts the pending commission (automatic flow)', async () => {
    rules.byEmployee.delete('e1')
    seed({}, [{ status: 'paid', amount: 1000 }], [{ amount: 100, status: 'pending' }])
    await run()
    expect(sum(records())).toBe(0)
  })
})
