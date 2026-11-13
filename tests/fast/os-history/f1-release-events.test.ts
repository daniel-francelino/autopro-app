// Histórico da OS (F1): eventos de comissão gravados por releaseServiceOrderCommissions (OSH-120/121).
// Mesmo harness de tests/fast/commissions/commissions-release.test.ts (regras mockadas, fake supabase).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { fakeEvent, installNitroGlobals } from '../../support/handler-harness'
import { releaseServiceOrderCommissions } from '../../../server/utils/service-order-commissions'
import { OS_SOURCE_POLICIES, historyContext } from '../../../server/utils/os-history/events'

installNitroGlobals()
const ORG = 'org-a'
const RID = '44444444-4444-4444-8444-444444444444'
const rules = vi.hoisted(() => ({ byEmployee: new Map<string, unknown[]>() }))

vi.mock('../../../server/utils/employee-commission-plans', () => ({
  resolveEmployeeCommissionRulesForEmployees: vi.fn(async (_s: unknown, _o: string, ids: string[]) =>
    new Map(ids.filter(id => rules.byEmployee.has(id)).map(id => [id, rules.byEmployee.get(id)!]))),
  resolveCommissionPlanRules: vi.fn(async () => []),
  fetchCommissionPlan: vi.fn(async () => null)
}))

const pct = (amount: number) => ({
  id: `rule-${amount}`, plan_id: 'plan-1', version_id: 'v1', name: `${amount}%`,
  commission_type: 'percentage', commission_amount: amount, commission_base: 'revenue', category_ids: [], is_default: true
})

let fake: FakeSupabase
type Row = Record<string, any>

function seed(order: Row = {}, installments: Row[] = [], records: Row[] = []) {
  fake = createFakeSupabase({
    service_orders: [{
      id: 'o1', organization_id: ORG, number: '100', status: 'completed', entry_date: '2026-03-10', total_amount: 1000, discount: 0,
      total_taxes_amount: 0, deleted_at: null, commission_release_mode: null, commission_manual_adjustments_log: [],
      responsible_employees: [{ employee_id: 'e1' }], items: [{ id: 'it1', total_price: 1000, cost_price: 0, quantity: 1, category_id: null }], ...order
    }],
    employees: [{ id: 'e1', organization_id: ORG, name: 'Ana', deleted_at: null }],
    service_order_installments: installments.map((i, n) => ({ id: `i${n}`, organization_id: ORG, service_order_id: 'o1', deleted_at: null, ...i })),
    employee_financial_records: records.map((r, n) => ({
      id: `r${n}`, organization_id: ORG, service_order_id: 'o1', employee_id: 'e1', record_type: 'commission', created_at: `2026-03-1${n}T10:00:00Z`, ...r
    })),
    service_order_events: []
  })
}

const ctx = (headers: Record<string, string> = {}) => {
  const e = fakeEvent({ method: 'POST', headers })
  ;(e as any).context = { audit: { requestId: RID, actorType: 'user' } }
  return historyContext(e as never, OS_SOURCE_POLICIES.osDetail)
}
const run = (extra: Row = {}, withHistory = true, headers: Record<string, string> = { 'x-origin': 'os_detail' }) =>
  releaseServiceOrderCommissions({ supabase: fake.client, organizationId: ORG, orderId: 'o1', userEmail: 'u@x.com', ...(withHistory ? { history: ctx(headers) } : {}), ...extra } as never)
const events = (): Row[] => (fake.tables.service_order_events ?? []) as Row[]
const src = (e: Row) => [e.source_code, e.source_trust, e.source_declared]
/** Faz a N-ésima consulta (1-based) a `table` falhar. */
const failNth = (table: string, nth: number, message = 'boom') => {
  const real = fake.client.from.bind(fake.client)
  let n = 0
  ;(fake.client as any).from = (t: string) => {
    if (t === table && ++n === nth) fake.failNext(t, message)
    return real(t)
  }
}

beforeEach(() => {
  rules.byEmployee = new Map([['e1', [pct(10)]]])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('commission.released', () => {
  it('modo proporcional: parcela paga libera a fatia; snapshot legível, chave por registro, origem herdada', async () => {
    seed({}, [{ status: 'paid', amount: 500 }, { status: 'pending', amount: 500 }])
    await run()
    expect(events()).toHaveLength(1)
    const rec = (fake.tables.employee_financial_records as Row[])[0]!
    const e = events()[0]!
    expect(e).toMatchObject({
      event_type: 'commission.released', visibility: 'commission', category: 'commission', organization_id: ORG, service_order_id: 'o1',
      entity_type: 'employee_financial_record', idempotency_key: `commission_released:${rec.id}`, correlation_id: RID
    })
    expect(e.payload).toEqual({ employee_name: 'Ana', amount: 50, release_mode: 'proportional', rule_name: '10%' })
    expect(src(e)).toEqual(['os_detail', 'declared', 'os_detail'])
    expect(JSON.stringify(e)).not.toContain('e1')
  })

  it('modo full: libera tudo sem recebimento e informa release_mode=full', async () => {
    seed({ commission_release_mode: 'full' }, [{ status: 'pending', amount: 1000 }])
    await run()
    expect(events().map(e => e.event_type)).toEqual(['commission.released'])
    expect(events()[0]!.payload).toMatchObject({ amount: 100, release_mode: 'full' })
  })

  it('sem header: origem inferida do endpoint; header de outro fluxo: mismatch', async () => {
    seed({}, [{ status: 'paid', amount: 1000 }])
    await run({}, true, {})
    expect(src(events()[0]!)).toEqual(['os_detail', 'inferred', null])
    seed({}, [{ status: 'paid', amount: 1000 }])
    await run({}, true, { 'x-origin': 'commission_report' })
    expect(src(events()[0]!)).toEqual(['os_detail', 'mismatch', 'commission_report'])
  })

  it('nada a liberar (nada recebido) ou sem `history`: nenhum evento', async () => {
    seed({}, [{ status: 'pending', amount: 1000 }])
    await run()
    seed({}, [{ status: 'paid', amount: 1000 }])
    await run({}, false)
    expect(events()).toHaveLength(0)
    expect(fake.tables.employee_financial_records).toHaveLength(1)
  })
})

describe('clawback automático (recebimento estornado)', () => {
  it('remove registro pendente inteiro: commission.removed motivo `recalculated`, was_paid=false', async () => {
    seed({}, [{ status: 'pending', amount: 1000 }], [{ status: 'pending', amount: 100 }])
    await run()
    expect(events().map(e => e.event_type)).toEqual(['commission.removed'])
    expect(events()[0]).toMatchObject({ visibility: 'commission', entity_id: null, idempotency_key: 'commission_removed:r0' })
    expect(events()[0]!.payload).toEqual({ employee_name: 'Ana', amount: 100, was_paid: false, reason: 'recalculated' })
    expect(fake.tables.employee_financial_records).toHaveLength(0)
  })

  it('reduz registro pendente parcialmente: commission.recalculated com de/para', async () => {
    seed({}, [{ status: 'paid', amount: 500 }, { status: 'pending', amount: 500 }], [{ status: 'pending', amount: 100 }])
    await run()
    expect(events().map(e => e.event_type)).toEqual(['commission.recalculated'])
    expect(events()[0]!.idempotency_key).toBe(`commission_recalculated_record:r0:${RID}`)
    expect(events()[0]!.payload).toEqual({ employee_name: 'Ana', previous_amount: 100, new_amount: 50 })
  })

  it('M4: delete que volta com erro NÃO gera commission.removed', async () => {
    seed({}, [{ status: 'pending', amount: 1000 }], [{ status: 'pending', amount: 100 }])
    failNth('employee_financial_records', 2) // 1=leitura dos registros, 2=delete
    await run()
    expect(events()).toHaveLength(0)
    expect(fake.tables.employee_financial_records).toHaveLength(1)
  })

  it('M4: update (redução) com erro NÃO gera commission.recalculated', async () => {
    seed({}, [{ status: 'paid', amount: 500 }, { status: 'pending', amount: 500 }], [{ status: 'pending', amount: 100 }])
    failNth('employee_financial_records', 2)
    await run()
    expect(events()).toHaveLength(0)
    expect((fake.tables.employee_financial_records as Row[])[0]!.amount).toBe(100)
  })

  it('comissão paga nunca é tocada nem vira evento (só aviso)', async () => {
    seed({}, [{ status: 'pending', amount: 1000 }], [{ status: 'paid', amount: 100 }])
    const res = await run()
    expect(events()).toHaveLength(0)
    expect(res.warnings.length).toBeGreaterThan(0)
  })
})

describe('ramo manual (employeeId + motivo)', () => {
  it('vira commission.recalculated por funcionário (com motivo), nunca commission.released; consolida pendentes', async () => {
    seed({}, [{ status: 'paid', amount: 500 }], [{ status: 'pending', amount: 20 }, { status: 'pending', amount: 10 }])
    await run({ employeeId: 'e1', reason: 'ajuste de teste' })
    expect(events().map(e => e.event_type)).toEqual(['commission.recalculated'])
    const e = events()[0]!
    expect(e).toMatchObject({ visibility: 'commission', category: 'commission', entity_type: 'employee', idempotency_key: `commission_recalculated:o1:e1:${RID}` })
    expect(e.payload).toEqual({ employee_name: 'Ana', previous_amount: 30, new_amount: 50, reason: 'ajuste de teste', override_action: null, override_plan_name: null })
    expect(src(e)).toEqual(['os_detail', 'declared', 'os_detail'])
    expect((fake.tables.employee_financial_records as Row[]).filter(r => r.status === 'pending')).toHaveLength(1)
  })

  it('falha ao gravar o log de ajuste manual NÃO gera evento', async () => {
    seed({}, [{ status: 'paid', amount: 500 }], [{ status: 'pending', amount: 20 }])
    failNth('service_orders', 3) // 1=select, 2=snapshot de itens, 3=log
    await run({ employeeId: 'e1', reason: 'x' })
    expect(events()).toHaveLength(0)
  })

  it('já tem comissão paga: 400 e zero eventos; sem motivo: 400', async () => {
    seed({}, [{ status: 'paid', amount: 500 }], [{ status: 'paid', amount: 20 }])
    await expect(run({ employeeId: 'e1', reason: 'x' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(run({ employeeId: 'e1', reason: '' })).rejects.toMatchObject({ statusCode: 400 })
    expect(events()).toHaveLength(0)
  })
})
