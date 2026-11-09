// Comissões — releaseServiceOrderCommissions (server/utils/service-order-commissions.ts)
// Cenários C-xx documentados em docs/testing/financial-core-test-analysis.md.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fake-supabase'
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

describe('C1–C6: liberação proporcional ao recebido', () => {
  it('C1: nada recebido → nenhuma comissão', async () => {
    seed({}, [{ status: 'pending', amount: 1000 }])
    const r = await run()
    expect(r.commissions).toHaveLength(0)
    expect(records()).toHaveLength(0)
    expect(r.totalCommission).toBe(100) // o direito total é calculado mesmo sem recebimento
  })
  it('C2: 50% recebido → 50% da comissão', async () => {
    seed({}, [{ status: 'paid', amount: 500 }, { status: 'pending', amount: 500 }])
    await run()
    expect(sum(records())).toBe(50)
  })
  it('C3: 100% recebido → comissão cheia', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }])
    await run()
    expect(sum(records())).toBe(100)
  })
  it('C4: recebido acima do total (ratio limitado a 1) nunca paga mais que o direito', async () => {
    seed({}, [{ status: 'paid', amount: 1500 }])
    await run()
    expect(sum(records())).toBe(100)
  })
  it('C5: modo "full" libera tudo mesmo sem recebimento', async () => {
    seed({ commission_release_mode: 'full' }, [{ status: 'pending', amount: 1000 }])
    await run()
    expect(sum(records())).toBe(100)
  })
  it('C6: OS com total 0 não gera comissão nem NaN', async () => {
    seed({ total_amount: 0, items: [{ id: 'it1', total_price: 0, quantity: 1 }] }, [{ status: 'paid', amount: 0 }])
    const r = await run()
    expect(records()).toHaveLength(0)
    expect(Number.isNaN(r.totalCommission)).toBe(false)
  })
})

describe('C7–C12: complementos, idempotência e arredondamento', () => {
  it('C7: segunda parcela paga complementa só a diferença (nunca duplica)', async () => {
    seed({}, [{ status: 'paid', amount: 500 }, { status: 'pending', amount: 500 }])
    await run()
    fake.tables.service_order_installments![1]!.status = 'paid'
    await run()
    expect(records()).toHaveLength(2)
    expect(sum(records())).toBe(100)
  })
  it('C8: chamar duas vezes sem mudança é idempotente', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }])
    await run()
    await run()
    expect(records()).toHaveLength(1)
    expect(sum(records())).toBe(100)
  })
  it('C9: 3 parcelas de 333,33/333,33/333,34 somam EXATAMENTE a comissão (sem centavo perdido)', async () => {
    seed({ total_amount: 1000 }, [{ status: 'paid', amount: 333.33 }, { status: 'pending', amount: 333.33 }, { status: 'pending', amount: 333.34 }])
    await run()
    fake.tables.service_order_installments![1]!.status = 'paid'
    await run()
    fake.tables.service_order_installments![2]!.status = 'paid'
    await run()
    expect(sum(records())).toBe(100)
  })
  it('C10: comissão com centavos (7% de 333,33) fecha em 2 casas sem acumular erro', async () => {
    rules.byEmployee.set('e1', [pct(7)])
    seed({ total_amount: 333.33, items: [{ id: 'it1', total_price: 333.33, quantity: 1 }] }, [{ status: 'paid', amount: 333.33 }])
    await run()
    expect(sum(records())).toBe(23.33)
  })
  it('C11: dois responsáveis recebem cada um a sua regra', async () => {
    seed({ responsible_employees: [{ employee_id: 'e1' }, { employee_id: 'e2' }] }, [{ status: 'paid', amount: 1000 }])
    await run()
    expect(sum(records('e1'))).toBe(100)
    expect(sum(records('e2'))).toBe(50)
  })
  it('C12: responsável sem regra / funcionário excluído não recebe', async () => {
    rules.byEmployee.delete('e2')
    seed({ responsible_employees: [{ employee_id: 'e2' }, { employee_id: 'e-del' }] }, [{ status: 'paid', amount: 1000 }])
    const r = await run()
    expect(fake.tables.employee_financial_records).toHaveLength(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})

describe('C13–C18: estorno (receipts revertidos)', () => {
  it('C13: recebimento estornado remove a comissão pendente correspondente', async () => {
    seed({}, [{ status: 'pending', amount: 1000 }], [{ amount: 100, status: 'pending' }])
    await run()
    expect(sum(records())).toBe(0)
  })
  it('C14: estorno parcial reduz o último registro pendente', async () => {
    seed({}, [{ status: 'paid', amount: 500 }], [{ amount: 100, status: 'pending' }])
    await run()
    expect(sum(records())).toBe(50)
  })
  it('C15: comissão JÁ PAGA nunca é apagada; excesso vira aviso de reconciliação', async () => {
    seed({}, [{ status: 'pending', amount: 1000 }], [{ amount: 100, status: 'paid' }])
    const r = await run()
    expect(records()).toHaveLength(1)
    expect(records()[0]!.status).toBe('paid')
    expect(r.warnings.join(' ')).toMatch(/reconcilia/i)
  })
  it('C16: pendente é consumido antes; pago fica intacto', async () => {
    seed({}, [{ status: 'paid', amount: 500 }], [{ amount: 50, status: 'paid' }, { amount: 50, status: 'pending' }])
    await run()
    expect(records().map(r => r.status)).toEqual(['paid'])
  })
  it('C17: OS de outra organização/excluída → 404', async () => {
    seed({ deleted_at: '2026-01-01' })
    await expect(run()).rejects.toMatchObject({ statusCode: 404 })
  })
  it('C18: registros de comissão de OUTRA organização não entram na conta', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }], [{ amount: 100, status: 'pending', organization_id: 'org-b' }])
    await run()
    expect(fake.tables.employee_financial_records!.filter(r => r.organization_id === ORG)).toHaveLength(1)
  })
})

describe('C19–C26: base de cálculo, desconto e itens', () => {
  it('C19: desconto reduz a base de comissão sobre faturamento', async () => {
    seed({ total_amount: 900, discount: 100 }, [{ status: 'paid', amount: 900 }])
    await run()
    expect(sum(records())).toBe(90)
  })
  it('C20: base lucro (revenue - custo)', async () => {
    rules.byEmployee.set('e1', [pct(10, 'profit')])
    seed({ items: [{ id: 'it1', total_price: 1000, cost_price: 400, quantity: 1 }] }, [{ status: 'paid', amount: 1000 }])
    await run()
    expect(sum(records())).toBe(60)
  })
  it('C21: custo maior que a venda não gera comissão negativa', async () => {
    rules.byEmployee.set('e1', [pct(10, 'profit')])
    seed({ items: [{ id: 'it1', total_price: 100, cost_price: 500, quantity: 1 }], total_amount: 100 }, [{ status: 'paid', amount: 100 }])
    await run()
    expect(records().every(r => Number(r.amount) >= 0)).toBe(true)
  })
  it('C22: OS sem itens não gera comissão', async () => {
    seed({ items: [] }, [{ status: 'paid', amount: 1000 }])
    const r = await run()
    expect(r.commissions).toHaveLength(0)
  })
  it('C23: regra por categoria só atinge itens da categoria', async () => {
    rules.byEmployee.set('e1', [pct(20, 'revenue', { id: 'cat', category_ids: ['c1'], is_default: false })])
    seed({ items: [{ id: 'a', total_price: 600, category_id: 'c1', quantity: 1 }, { id: 'b', total_price: 400, category_id: 'c2', quantity: 1 }] }, [{ status: 'paid', amount: 1000 }])
    await run()
    expect(sum(records())).toBe(120)
  })
  it('C24: valor fixo é por unidade', async () => {
    rules.byEmployee.set('e1', [{ ...pct(0), commission_type: 'fixed_amount', commission_amount: 15 }])
    seed({ items: [{ id: 'a', total_price: 1000, quantity: 3 }] }, [{ status: 'paid', amount: 1000 }])
    await run()
    expect(sum(records())).toBe(45)
  })
  it('C25: grava o snapshot da OS (commission_amount) com o direito total', async () => {
    seed({}, [{ status: 'pending', amount: 1000 }])
    await run()
    expect(fake.tables.service_orders![0]!.commission_amount).toBe(100)
  })
  it('C26: data de referência vem do entry_date (mês da regra vigente)', async () => {
    seed({ entry_date: '2026-03-31' }, [{ status: 'paid', amount: 1000 }])
    await run()
    expect(records()[0]!.reference_date).toBe('2026-03-31')
  })
})

describe('C27–C34: recálculo manual e override', () => {
  it('C27: recálculo manual exige motivo', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }])
    await expect(run({ employeeId: 'e1' })).rejects.toMatchObject({ statusCode: 400 })
  })
  it('C28: recálculo manual de quem já tem comissão PAGA é bloqueado', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }], [{ amount: 100, status: 'paid' }])
    await expect(run({ employeeId: 'e1', reason: 'teste' })).rejects.toMatchObject({ statusCode: 400 })
  })
  it('C29: recálculo manual consolida os pendentes numa linha só e registra no log', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }], [{ amount: 30, status: 'pending' }, { amount: 20, status: 'pending' }])
    await run({ employeeId: 'e1', reason: 'ajuste', userName: 'Admin' })
    expect(records()).toHaveLength(1)
    expect(sum(records())).toBe(100)
    const log = fake.tables.service_orders![0]!.commission_manual_adjustments_log as Array<Record<string, unknown>>
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ employee_id: 'e1', previous_amount: 50, new_amount: 100, reason: 'ajuste' })
  })
  it('C30: recálculo manual de um funcionário não mexe no do outro', async () => {
    seed({ responsible_employees: [{ employee_id: 'e1' }, { employee_id: 'e2' }] }, [{ status: 'paid', amount: 1000 }], [{ amount: 10, status: 'pending', employee_id: 'e2' }])
    await run({ employeeId: 'e1', reason: 'x' })
    expect(sum(records('e2'))).toBe(10)
  })
  it('C31: override sem employeeId → 400; sem plano → 400; plano inativo/inexistente → 400', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }])
    await expect(run({ overrideAction: 'apply' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(run({ employeeId: 'e1', reason: 'x', overrideAction: 'apply' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(run({ employeeId: 'e1', reason: 'x', overrideAction: 'apply', overrideCommissionPlanId: 'plan-off' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(run({ employeeId: 'e1', reason: 'x', overrideAction: 'apply', overrideCommissionPlanId: 'nope' })).rejects.toMatchObject({ statusCode: 400 })
  })
  it('C32: override aplica as regras do plano escolhido e persiste para pagamentos futuros', async () => {
    rules.byPlan.set('plan-x', [pct(30)])
    seed({}, [{ status: 'paid', amount: 500 }, { status: 'pending', amount: 500 }])
    await run({ employeeId: 'e1', reason: 'acordo', overrideAction: 'apply', overrideCommissionPlanId: 'plan-x' })
    expect(sum(records())).toBe(150)
    fake.tables.service_order_installments![1]!.status = 'paid'
    await run() // pagamento posterior continua usando o override
    expect(sum(records())).toBe(300)
  })
  it('C33: remover override sem override ativo → 400', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }])
    await expect(run({ employeeId: 'e1', reason: 'x', overrideAction: 'remove' })).rejects.toMatchObject({ statusCode: 400 })
  })
  it('C34: sem responsáveis → resposta vazia com aviso, sem erro', async () => {
    seed({ responsible_employees: [] }, [{ status: 'paid', amount: 1000 }])
    const r = await run()
    expect(r.commissions).toEqual([])
    expect(r.warnings).toHaveLength(1)
  })
})

describe('C35–C36: incidentes reais (docs/finance/auditoria-arredondamento-comissoes-2026-09-10.md)', () => {
  it('C35: arredondamento por item deriva no máximo 1 centavo por item (3 × 33,33 a 10%)', async () => {
    seed({ total_amount: 99.99, items: [1, 2, 3].map(n => ({ id: `i${n}`, total_price: 33.33, quantity: 1 })) }, [{ status: 'paid', amount: 99.99 }])
    await run()
    const exact = 99.99 * 0.1
    expect(Math.abs(sum(records()) - exact)).toBeLessThanOrEqual(0.03 + 1e-9)
  })
  // KF-36: incidente de 10/09/2026 — recálculo manual de quem ficou sem regra aplicável ZEROU R$ 7.130,99 de
  // comissões pendentes em 21 OS, sem confirmação. O comportamento correto é recusar (ou exigir confirmação).
  it.fails('KF-36: recálculo manual de funcionário sem regra aplicável NÃO apaga a comissão pendente em silêncio', async () => {
    rules.byEmployee.delete('e1')
    seed({}, [{ status: 'paid', amount: 1000 }], [{ amount: 100, status: 'pending' }])
    await run({ employeeId: 'e1', reason: 'conferência' }).catch(() => undefined)
    expect(sum(records())).toBe(100)
  })
})

describe('Pontas soltas já conhecidas (KF-24 a KF-26) — o teste descreve o comportamento correto', () => {
  // KF-24: o recebido é somado só das parcelas 'paid'; o valor já recebido numa parcela 'partial' é ignorado.
  it.fails('KF-24: parcela PARCIAL já recebida libera a comissão proporcional', async () => {
    seed({}, [{ status: 'partial', amount: 1000 }])
    fake.tables.financial_transactions = [
      { id: 't1', organization_id: ORG, service_order_installment_id: 'i0', type: 'income', status: 'paid', amount: 600, deleted_at: null }
    ]
    await run()
    expect(sum(records())).toBe(60)
  })
  // KF-25: funcionário que deixou de ser responsável pela OS mantém a comissão pendente antiga.
  it.fails('KF-25: quem saiu da lista de responsáveis perde a comissão ainda pendente', async () => {
    seed({ responsible_employees: [{ employee_id: 'e2' }] }, [{ status: 'paid', amount: 1000 }], [{ amount: 100, status: 'pending', employee_id: 'e1' }])
    await run()
    expect(sum(records('e1'))).toBe(0)
  })
  // KF-26: se a regra passa a render 0 (ex.: plano desativado), o pendente antigo não é recolhido no fluxo automático.
  it.fails('KF-26: regra que passou a render 0 recolhe a comissão pendente (fluxo automático)', async () => {
    rules.byEmployee.delete('e1')
    seed({}, [{ status: 'paid', amount: 1000 }], [{ amount: 100, status: 'pending' }])
    await run()
    expect(sum(records())).toBe(0)
  })
})
