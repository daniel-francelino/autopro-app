// [OSH-251/259/268/275/302/303] F2 sobre Postgres real: eventos de edição/status/criação/exclusão persistem após soft delete,
// `history` responde 404 a OS excluída, outra organização não lê, unicidade da chave de order.created e paginação com volume.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { adminDb } from '../support/db'
import { createOrg, createServiceOrder, deleteOrgs } from '../support/factories'
import { callHandler, fakeEvent, installNitroGlobals } from '../support/handler-harness'
import { OS_SOURCE_POLICIES, recordOsEventsSafe } from '../../server/utils/os-history/events'
import { buildOrderCreatedEvent, buildOrderDeletedEvent, buildOrderUpdateEvents } from '../../server/utils/os-history/order-events'

const available = inject('apiAvailable')
const as = { org: '', visibilities: ['general'] as string[] }
vi.mock('../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => adminDb() }))
vi.mock('../../server/utils/require-auth', () => ({ requireAuthUser: async () => ({ id: 'u-test', email: 'u@test.local' }) }))
vi.mock('../../server/utils/require-org-permission', () => ({ requireOrgPermission: async () => undefined }))
vi.mock('../../server/utils/organization', () => ({ resolveOrganizationId: async () => as.org }))
vi.mock('../../server/utils/os-history/access', () => ({ allowedVisibilities: async () => as.visibilities }))
installNitroGlobals()

const HISTORY = 'server/api/service-orders/[id]/history.get.ts'
const orgIds: string[] = []
let orgA = ''
let orgB = ''
type Page = { items: Array<{ id: string, title: string }>, nextCursor: string | null }
const get = (id: string, query: Record<string, string> = {}) => callHandler(HISTORY, fakeEvent({ params: { id }, query }))
const ctx = (origin = 'os_form') => {
  const e = fakeEvent({ headers: { 'x-origin': origin } })
  ;(e as any).context = { audit: { requestId: randomUUID(), actorType: 'user' } }
  return e
}
const rowsOf = async (org: string, so: string) => {
  const { data, error } = await adminDb().from('service_order_events').select('*').eq('organization_id', org).eq('service_order_id', so).order('seq')
  if (error) throw new Error(error.message)
  return data as Array<Record<string, any>>
}
const newOs = async (org: string, tag: string) => (await createServiceOrder(org, `${tag}${Date.now() % 1e6}${Math.floor(Math.random() * 99)}`)).data!.id as string
const record = (e: unknown, build: () => any, policy: any = OS_SOURCE_POLICIES.osForm) => recordOsEventsSafe(e as never, adminDb() as never, build, policy)

beforeAll(async () => {
  if (!available) return
  orgA = (await createOrg()).id
  orgB = (await createOrg()).id
  orgIds.push(orgA, orgB)
})
afterAll(async () => { if (available) await deleteOrgs(orgIds) })

describe.skipIf(!available)('[OSH-260] unicidade da chave de order.created', () => {
  it('reenvio do mesmo order.created colapsa em 1 linha; chave igual em outra org não colide', async () => {
    const so = await newOs(orgA, 'C')
    await record(ctx(), () => [buildOrderCreatedEvent(orgA, { id: so, number: 'OS-9' })])
    await record(ctx(), () => [buildOrderCreatedEvent(orgA, { id: so, number: 'OS-9' })]) // outro request, mesma OS
    const rows = (await rowsOf(orgA, so)).filter(r => r.event_type === 'order.created')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ visibility: 'general', idempotency_key: `order_created:${so}`, payload: { order_number: 'OS-9' } })
    const other = await newOs(orgB, 'C')
    await record(ctx(), () => [buildOrderCreatedEvent(orgB, { id: other, number: 'OS-9' })])
    expect((await rowsOf(orgB, other)).filter(r => r.event_type === 'order.created')).toHaveLength(1)
  })
})

describe.skipIf(!available)('[OSH-251/259/302/303] ciclo completo e exclusão da OS', () => {
  it('mudanças sequenciais em ordem; exclusão preserva todos, history 404, append-only', async () => {
    const so = await newOs(orgA, 'D')
    await record(ctx(), () => [buildOrderCreatedEvent(orgA, { id: so, number: 'OS-1' })])
    for (const [from, to] of [['open', 'in_progress'], ['in_progress', 'completed']]) {
      await record(ctx(), () => buildOrderUpdateEvents(adminDb() as never, { organizationId: orgA, orderId: so, before: { status: from }, after: { status: to }, scope: randomUUID() }))
    }
    await record(ctx(), () => buildOrderUpdateEvents(adminDb() as never, {
      organizationId: orgA, orderId: so, before: { reported_defect: 'a', items: [] },
      after: { reported_defect: 'b', items: [{ name: 'Filtro', quantity: 1, unit_price: 35, commissions: [{ amount: 4321 }] }] }, scope: randomUUID()
    }))
    as.org = orgA
    const before = await rowsOf(orgA, so)
    expect(before.map(r => r.event_type)).toEqual(['order.created', 'order.status_changed', 'order.status_changed', 'order.fields_changed', 'order.items_changed'])
    expect(JSON.stringify(before.map(r => r.payload))).not.toMatch(/commission|4321/i)
    const page = (await get(so)).body as Page
    expect(page.items.map(i => i.id)).toEqual([...before].reverse().map(r => r.id))

    await record(ctx('os_list'), () => [buildOrderDeletedEvent(orgA, so, 'OS-1', randomUUID())], OS_SOURCE_POLICIES.orderDelete)
    const upd = await adminDb().from('service_orders').update({ deleted_at: new Date().toISOString() }).eq('id', so)
    expect(upd.error).toBeNull()
    expect((await get(so)).status).toBe(404)
    const after = await rowsOf(orgA, so)
    expect(after).toHaveLength(6)
    expect(after.at(-1)).toMatchObject({ event_type: 'order.deleted', source_code: 'os_list', source_trust: 'declared', payload: { order_number: 'OS-1' } })
    expect(after.slice(0, 5).map(r => r.id)).toEqual(before.map(r => r.id))
    const u = await adminDb().from('service_order_events').update({ payload: { x: 1 } }).eq('service_order_id', so)
    const d = await adminDb().from('service_order_events').delete().eq('service_order_id', so)
    expect(u.error).toBeTruthy()
    expect(d.error).toBeTruthy()
    expect(await rowsOf(orgA, so)).toHaveLength(6)
  })

  it('outra organização não lê a OS: 404 igual ao de id inexistente, sem dado da org A', async () => {
    const so = await newOs(orgA, 'E')
    await record(ctx(), () => [buildOrderCreatedEvent(orgA, { id: so, number: 'SEGREDO-A' })])
    as.org = orgB
    const res = await get(so)
    expect(res.status).toBe(404)
    expect(JSON.stringify(res.body ?? null)).not.toMatch(/SEGREDO-A/)
    const missing = await get(randomUUID())
    expect(missing.status).toBe(404)
    expect(JSON.stringify(res.body ?? null)).toEqual(JSON.stringify(missing.body ?? null))
  })
})

describe.skipIf(!available)('[OSH-275] 300 eventos de F2: paginação limit=30', () => {
  it('sem repetição nem salto, ordem estável e fim correto', async () => {
    const so = await newOs(orgA, 'P')
    const rows = Array.from({ length: 300 }, (_, i) => ({
      organization_id: orgA, service_order_id: so, event_type: 'order.fields_changed', category: 'order', visibility: 'general', schema_version: 1,
      payload: { changes: [{ field: 'reported_defect', from: `v${i}`, to: `v${i + 1}` }] }, correlation_id: randomUUID(), source_code: 'os_form',
      source_label: 'Ordem de serviço', source_trust: 'declared', idempotency_key: `order_fields_changed:${so}:${i}`,
      occurred_at: new Date(Date.UTC(2026, 10, 13, 12, 0, 0) + Math.floor(i / 10) * 1000).toISOString()
    }))
    const ins = await adminDb().from('service_order_events').insert(rows).select('id, seq')
    expect(ins.error).toBeNull()
    const expected = [...ins.data!].sort((a, b) => b.seq - a.seq).map(r => r.id)
    as.org = orgA
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const res = await get(so, { limit: '30', ...(cursor ? { cursor } : {}) })
      const body = res.body as Page
      expect(body.items.length).toBeLessThanOrEqual(30)
      seen.push(...body.items.map(i => i.id))
      cursor = body.nextCursor
      pages++
    } while (cursor && pages < 20)
    expect(pages).toBe(10)
    expect(new Set(seen).size).toBe(300)
    expect(seen).toEqual(expected)
    expect(cursor).toBeNull()
  })
})
