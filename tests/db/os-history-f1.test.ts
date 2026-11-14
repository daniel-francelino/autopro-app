// [OSH-163/144] F1 sobre Postgres real: unicidade das chaves de idempotência das cascatas e leitura do endpoint
// history filtrada por visibilidade ponta a ponta com eventos F1. Tabela append-only: sem DELETE (ver service-order-events.test.ts).
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { adminDb } from '../support/db'
import { createOrg, createServiceOrder, deleteOrgs } from '../support/factories'
import { callHandler, fakeEvent, installNitroGlobals } from '../support/handler-harness'
import { OS_EVENT_CATALOG, OS_EVENT_KEYS, osEvent, recordOsEventsSafe, OS_SOURCE_POLICIES } from '../../server/utils/os-history/events'

const available = inject('apiAvailable')
const as = { org: '', visibilities: ['general'] as string[] }
vi.mock('../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => adminDb() }))
vi.mock('../../server/utils/require-auth', () => ({ requireAuthUser: async () => ({ id: 'u-test', email: 'u@test.local' }) }))
vi.mock('../../server/utils/require-org-permission', () => ({ requireOrgPermission: async () => undefined }))
vi.mock('../../server/utils/organization', () => ({ resolveOrganizationId: async () => as.org }))
vi.mock('../../server/utils/os-history/access', () => ({ allowedVisibilities: async () => as.visibilities, requireOsHistoryAccess: async () => undefined }))

installNitroGlobals()
const HISTORY = 'server/api/service-orders/[id]/history.get.ts'
const orgIds: string[] = []
let orgA = ''
let orgB = ''
let osA = ''
let osB = ''

type Item = { id: string, type?: string, title: string, category: string }
const get = (id: string) => callHandler(HISTORY, fakeEvent({ params: { id }, query: { limit: '50' } }))
const rowsOf = async (org: string, so: string) => {
  const { data, error } = await adminDb().from('service_order_events').select('*').eq('organization_id', org).eq('service_order_id', so)
  if (error) throw new Error(error.message)
  return data as Array<Record<string, any>>
}
const ctxEvent = () => {
  const e = fakeEvent({ headers: { 'x-origin': 'os_detail' } })
  ;(e as any).context = { audit: { requestId: randomUUID(), actorType: 'user' } }
  return e
}

beforeAll(async () => {
  if (!available) return
  orgA = (await createOrg()).id
  orgB = (await createOrg()).id
  orgIds.push(orgA, orgB)
  osA = (await createServiceOrder(orgA, `F${Date.now() % 1e6}`)).data!.id as string
  osB = (await createServiceOrder(orgB, `G${Date.now() % 1e6}`)).data!.id as string
})
afterAll(async () => {
  if (available) await deleteOrgs(orgIds)
})

describe.skipIf(!available)('chaves de idempotência das cascatas no banco real', () => {
  const cascade = (org: string, so: string, scope: string, recA: string, recB: string) => [
    osEvent('order.cancelled', { organizationId: org, serviceOrderId: so, entityType: 'service_order', entityId: so, idempotencyKey: OS_EVENT_KEYS.orderCancelled(so, scope) }, { order_number: 'X', previous_status: 'open' }),
    osEvent('commission.removed', { organizationId: org, serviceOrderId: so, entityType: 'employee_financial_record', entityId: recA, idempotencyKey: OS_EVENT_KEYS.commissionRemoved(recA) }, { employee_name: 'A', amount: 1, was_paid: false, reason: 'order_cancelled' }),
    osEvent('commission.removed', { organizationId: org, serviceOrderId: so, entityType: 'employee_financial_record', entityId: recB, idempotencyKey: OS_EVENT_KEYS.commissionRemoved(recB) }, { employee_name: 'B', amount: 2, was_paid: true, reason: 'order_cancelled' })
  ]

  it('reenvio da MESMA cascata colapsa (3 linhas, não 6); cascata de outra requisição só acrescenta o evento com escopo', async () => {
    const so = (await createServiceOrder(orgA, `K${Date.now() % 1e6}`)).data!.id as string
    const [a, b] = [randomUUID(), randomUUID()]
    const e = ctxEvent()
    const admin = adminDb() as never
    await recordOsEventsSafe(e as never, admin, () => cascade(orgA, so, 'req-1', a, b), OS_SOURCE_POLICIES.orderCancel)
    await recordOsEventsSafe(e as never, admin, () => cascade(orgA, so, 'req-1', a, b), OS_SOURCE_POLICIES.orderCancel)
    expect(await rowsOf(orgA, so)).toHaveLength(3)
    await recordOsEventsSafe(e as never, admin, () => cascade(orgA, so, 'req-2', a, b), OS_SOURCE_POLICIES.orderCancel)
    const rows = await rowsOf(orgA, so)
    expect(rows).toHaveLength(4) // commission.removed é por registro (físico, único); order.cancelled por requisição
    expect(rows.every(r => r.source_code === 'os_detail' && r.source_trust === 'declared')).toBe(true)
  })

  it('chaves iguais em organizações diferentes não colidem', async () => {
    const id = randomUUID()
    const mk = (org: string, so: string) => [osEvent('commission.removed', { organizationId: org, serviceOrderId: so, entityType: 'employee_financial_record', entityId: id, idempotencyKey: OS_EVENT_KEYS.commissionRemoved(id) }, { employee_name: 'A', amount: 1, was_paid: false, reason: 'manual_delete' })]
    await recordOsEventsSafe(ctxEvent() as never, adminDb() as never, () => mk(orgA, osA), OS_SOURCE_POLICIES.commissionDelete)
    await recordOsEventsSafe(ctxEvent() as never, adminDb() as never, () => mk(orgB, osB), OS_SOURCE_POLICIES.commissionDelete)
    expect((await rowsOf(orgA, osA)).filter(r => r.entity_id === id)).toHaveLength(1)
    expect((await rowsOf(orgB, osB)).filter(r => r.entity_id === id)).toHaveLength(1)
  })

  it('pagamento de comissão: mesma comissão com transações distintas gera 2 linhas; mesma transação, 1', async () => {
    const so = (await createServiceOrder(orgA, `P${Date.now() % 1e6}`)).data!.id as string
    const rec = randomUUID()
    const [t1, t2] = [randomUUID(), randomUUID()]
    const mk = (t: string) => [osEvent('commission.paid', { organizationId: orgA, serviceOrderId: so, entityType: 'employee_financial_record', entityId: rec, idempotencyKey: OS_EVENT_KEYS.commissionPaid(rec, t) }, { employee_name: 'A', amount: 1, payment_date: '2026-11-13', bank_account_name: null, without_receipt: false })]
    for (const t of [t1, t1, t2]) await recordOsEventsSafe(ctxEvent() as never, adminDb() as never, () => mk(t), OS_SOURCE_POLICIES.commissionPay)
    expect(await rowsOf(orgA, so)).toHaveLength(2)
  })
})

describe.skipIf(!available)('endpoint history com eventos F1: visibilidade e tenant ponta a ponta (OSH-163, 144)', () => {
  it('catálogo gravado no banco: general só vê os eventos order.*; financial soma pagamentos; commission vê tudo; org B não vê nada de A', async () => {
    const so = (await createServiceOrder(orgA, `E${Date.now() % 1e6}`)).data!.id as string
    const payloads: Record<string, Record<string, unknown>> = {}
    const events = Object.keys(OS_EVENT_CATALOG).map((type, i) => osEvent(type as keyof typeof OS_EVENT_CATALOG, { organizationId: orgA, serviceOrderId: so, idempotencyKey: `e2e:${type}:${so}:${i}` }, payloads[type] ?? {}))
    await recordOsEventsSafe(ctxEvent() as never, adminDb() as never, () => events, OS_SOURCE_POLICIES.osDetail)
    expect(await rowsOf(orgA, so)).toHaveLength(events.length)

    as.org = orgA
    as.visibilities = ['general']
    const general = ((await get(so)).body as { items: Item[] }).items
    expect(general.length).toBe(Object.values(OS_EVENT_CATALOG).filter(m => m.visibility === 'general').length)
    expect(general.map(i => i.category).every(c => c === 'order' || c === 'status' || c === 'items')).toBe(true)

    as.visibilities = ['general', 'financial']
    const financial = ((await get(so)).body as { items: Item[] }).items
    expect(financial.length).toBe(Object.values(OS_EVENT_CATALOG).filter(m => m.visibility !== 'commission').length)
    expect(financial.some(i => i.category === 'commission')).toBe(false)

    as.visibilities = ['general', 'financial', 'commission']
    const all = ((await get(so)).body as { items: Item[] }).items
    expect(all).toHaveLength(events.length)
    const json = JSON.stringify(all)
    expect(json).not.toContain('correlation')
    expect(json).not.toContain(orgA)

    as.org = orgB
    expect((await get(so)).status).toBe(404)
  })
})
