// [OSH-342..348] F3 sobre Postgres real: handlers de agendamento gravam appointment.* (CHECKs/unicidade reais),
// `GET history` lê com filtro de visibilidade/organização, e OS de outra organização não gera evento.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { adminDb } from '../support/db'
import { createClient, createOrg, createServiceOrder, deleteOrgs } from '../support/factories'
import { OS_SOURCE_POLICIES, OS_EVENT_KEYS, osEvent, recordOsEventsSafe } from '../../server/utils/os-history/events'
import { callHandler, fakeEvent, installNitroGlobals } from '../support/handler-harness'

const available = inject('apiAvailable')
const as = { org: '', grants: new Set<string>(['orders.read']) }
vi.mock('../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => adminDb() }))
vi.mock('../../server/utils/require-auth', () => ({ requireAuthUser: async () => ({ id: 'u-test', email: 'u@test.local' }) }))
// permissões controladas por `as.grants`; access.ts (allowedVisibilities) é o REAL e decide a visibilidade a partir delas
vi.mock('../../server/utils/require-org-permission', () => ({
  requireOrgPermission: async (_u: string, code: string) => { if (['orders.read', 'orders.pay', 'reports.commissions'].includes(code) && !as.grants.has(code)) throw Object.assign(new Error('forbidden'), { statusCode: 403 }) }
}))
vi.mock('../../server/utils/organization', () => ({ resolveOrganizationId: async () => as.org }))
installNitroGlobals()

const POST = 'server/api/appointments/index.post.ts'
const PUT = 'server/api/appointments/[id].put.ts'
const DEL = 'server/api/appointments/[id].delete.ts'
const HISTORY = 'server/api/service-orders/[id]/history.get.ts'
const orgIds: string[] = []
let orgA = ''
let orgB = ''
let clientId = ''
let vehicleId = ''
const call = (file: string, method: string, o: { id?: string, body?: unknown } = {}) => {
  const e = fakeEvent({ method, params: { id: o.id ?? '' }, body: o.body, headers: { 'x-origin': 'agenda' } })
  ;(e as any).context = { audit: { requestId: randomUUID(), actorType: 'user' } }
  return callHandler(file, e)
}
const rowsOf = async (org: string, so: string) => {
  const { data, error } = await adminDb().from('service_order_events').select('*').eq('organization_id', org).eq('service_order_id', so).order('seq')
  if (error) throw new Error(error.message)
  return data as Array<Record<string, any>>
}
const newOs = async (org: string, tag: string, cid?: string) => (await createServiceOrder(org, `${tag}${Date.now() % 1e6}${Math.floor(Math.random() * 99)}`, cid ? { client_id: cid } : {})).data!.id as string

beforeAll(async () => {
  if (!available) return
  orgA = (await createOrg()).id
  orgB = (await createOrg()).id
  orgIds.push(orgA, orgB)
  clientId = (await createClient(orgA)).id
  const { data, error } = await adminDb().from('vehicles').insert({ organization_id: orgA, client_id: clientId, license_plate: 'ABC1D23', brand: 'X', model: 'Y' }).select().single()
  if (error) throw new Error(`vehicle: ${error.message}`)
  vehicleId = data.id
})
afterAll(async () => { if (available) await deleteOrgs(orgIds) })

describe.skipIf(!available)('[OSH-342..345,346] agendamento -> histórico (banco real)', () => {
  it('ciclo criar/alterar/cancelar/trocar/excluir persiste e o GET history devolve só general, sem dados do cliente', async () => {
    as.org = orgA
    as.grants = new Set(['orders.read'])
    const o1 = await newOs(orgA, 'P', clientId)
    const o2 = await newOs(orgA, 'Q', clientId)
    const created = await call(POST, 'POST', { body: { client_id: clientId, vehicle_id: vehicleId, appointment_date: '2026-11-22', time: '10:00', service_type: 'Revisão', service_order_id: o1 } })
    expect(created.status).toBe(200)
    const id = (created.body as any).item.id as string
    expect((await call(PUT, 'PUT', { id, body: { time: '11:30', appointment_date: '2026-11-23' } })).status).toBe(200)
    expect((await call(PUT, 'PUT', { id, body: { time: '11:30', appointment_date: '2026-11-23' } })).status).toBe(200) // reenvio igual
    expect((await call(PUT, 'PUT', { id, body: { status: 'cancelled' } })).status).toBe(200)
    expect((await call(PUT, 'PUT', { id, body: { service_order_id: o2 } })).status).toBe(200)
    expect((await call(DEL, 'DELETE', { id })).status).toBe(200)

    const r1 = await rowsOf(orgA, o1)
    expect(r1.map(r => r.event_type)).toEqual(['appointment.linked', 'appointment.changed', 'appointment.cancelled', 'appointment.unlinked'])
    expect(r1.every(r => r.visibility === 'general' && r.category === 'order' && r.source_code === 'appointments' && r.entity_id === id)).toBe(true)
    expect(r1[1]!.payload.changes).toEqual([{ field: 'date', from: '2026-11-22', to: '2026-11-23' }, { field: 'time', from: '10:00', to: '11:30' }])
    const r2 = await rowsOf(orgA, o2)
    expect(r2.map(r => r.event_type)).toEqual(['appointment.linked', 'appointment.removed'])
    expect(r2[0]!.payload.created).toBe(false)
    expect(JSON.stringify([...r1, ...r2].map(r => r.payload))).not.toMatch(/Cliente|11999990000|ABC1D23/)

    const page = await callHandler(HISTORY, fakeEvent({ params: { id: o1 }, query: {} }))
    expect(page.status).toBe(200)
    const items = (page.body as any).items as Array<{ title: string, description?: string }>
    expect(items).toHaveLength(4)
    expect(JSON.stringify(items)).not.toMatch(/Cliente|11999990000|ABC1D23/)
  })

  it('OS de outra organização: agendamento é gravado como hoje, mas nenhum evento (nem em orgA nem em orgB)', async () => {
    as.org = orgA
    const foreign = await newOs(orgB, 'F')
    const res = await call(POST, 'POST', { body: { client_id: clientId, vehicle_id: vehicleId, appointment_date: '2026-11-22', time: '10:00', service_type: 'X', service_order_id: foreign } })
    expect(res.status).toBe(200)
    expect(await rowsOf(orgB, foreign)).toHaveLength(0)
    expect(await rowsOf(orgA, foreign)).toHaveLength(0)
  })

  it('OS excluída (soft delete): sem evento', async () => {
    as.org = orgA
    const so = await newOs(orgA, 'X', clientId)
    await adminDb().from('service_orders').update({ deleted_at: new Date().toISOString() }).eq('id', so)
    expect((await call(POST, 'POST', { body: { client_id: clientId, vehicle_id: vehicleId, appointment_date: '2026-11-22', time: '10:00', service_type: 'X', service_order_id: so } })).status).toBe(200)
    expect(await rowsOf(orgA, so)).toHaveLength(0)
  })
})

describe.skipIf(!available)('visibilidade no GET history (access.ts real, banco real)', () => {
  it('commission.recalculated: orders.read não vê (JSON e paginação); +reports.commissions vê; financial só com orders.pay', async () => {
    as.org = orgA
    const so = await newOs(orgA, 'V', clientId)
    const e = { headers: { 'x-origin': 'os_detail' } } as never
    const ev = fakeEvent(e)
    ;(ev as any).context = { audit: { requestId: randomUUID(), actorType: 'user' } }
    const scope = randomUUID()
    await recordOsEventsSafe(ev as never, adminDb() as never, () => [
      osEvent('order.created', { organizationId: orgA, serviceOrderId: so, entityType: 'service_order', entityId: so, idempotencyKey: OS_EVENT_KEYS.orderCreated(so) }, { order_number: 'V1' }),
      osEvent('commission.recalculated', { organizationId: orgA, serviceOrderId: so, entityType: 'employee', entityId: randomUUID(), idempotencyKey: `commission_recalculated:${so}:e:${scope}` }, { employee_name: 'Ana', previous_amount: 30, new_amount: 50, reason: 'ajuste do gerente', override_action: null, override_plan_name: null })
    ], OS_SOURCE_POLICIES.osDetail)
    expect((await rowsOf(orgA, so)).map(r => r.visibility).sort()).toEqual(['commission', 'general'])

    const walk = async () => {
      const items: any[] = []
      let cursor: string | null = null
      for (let i = 0; i < 5; i++) {
        const res: any = await callHandler(HISTORY, fakeEvent({ params: { id: so }, query: { limit: '1', ...(cursor ? { cursor } : {}) } }))
        expect(res.status).toBe(200)
        items.push(...res.body.items)
        cursor = res.body.nextCursor
        if (!cursor) break
      }
      return items
    }
    as.grants = new Set(['orders.read'])
    const plain = await walk()
    expect(plain).toHaveLength(1)
    expect(JSON.stringify(plain)).not.toMatch(/ajuste do gerente|Ana|recalcul/i)
    const full: any = await callHandler(HISTORY, fakeEvent({ params: { id: so }, query: {} }))
    expect(JSON.stringify(full.body)).not.toMatch(/ajuste do gerente|Ana/)
    as.grants = new Set(['orders.read', 'reports.commissions'])
    const withCom = await walk()
    expect(withCom).toHaveLength(2)
    expect(JSON.stringify(withCom)).toContain('ajuste do gerente')
    as.grants = new Set()
    expect((await callHandler(HISTORY, fakeEvent({ params: { id: so }, query: {} }))).status).toBe(403)
  })
})
