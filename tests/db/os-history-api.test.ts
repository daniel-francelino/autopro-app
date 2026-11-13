// [OSH-030/033/035/037/039] GET /api/service-orders/:id/history com o handler REAL sobre Postgres real (adminDb).
// Mocks só nas fronteiras de auth: sessão, resolução de org e visibilidade vêm das variáveis `as`. O que é
// provado aqui é o que o fake-supabase não prova: filtro de tenant/visibilidade e keyset sobre o banco de verdade.
// Limpeza: ver tests/db/service-order-events.test.ts (tabela append-only; dados únicos por teste, sem DELETE nela).
// Orgs e OS criadas via factories são removidas no afterAll (service_orders cai em cascata; eventos não têm FK).
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { adminDb } from '../support/db'
import { createOrg, createServiceOrder, deleteOrgs } from '../support/factories'
import { callHandler, fakeEvent, installNitroGlobals } from '../support/handler-harness'

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
let osA = ''
let osADeleted = ''

type Page = { items: Array<{ id: string, title: string, groupId: string }>, nextCursor: string | null }
const get = (id: string, query: Record<string, unknown> = {}) => callHandler(HISTORY, fakeEvent({ params: { id }, query }))

async function addEvents(org: string, so: string, n: number, over: Record<string, unknown> = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({
    organization_id: org, service_order_id: so, event_type: 'order.status_changed', category: 'status', visibility: 'general',
    correlation_id: randomUUID(), source_code: 'os_form', source_label: 'Ordem de serviço (cadastro/edição)', source_trust: 'inferred',
    actor_name: 'Maria', payload: { from: 'open', to: 'completed', i }, ...over
  }))
  const { data, error } = await adminDb().from('service_order_events').insert(rows).select('id, seq')
  if (error) throw new Error(`addEvents: ${error.message}`)
  return data as Array<{ id: string, seq: number }>
}

beforeAll(async () => {
  if (!available) return
  orgA = (await createOrg()).id
  orgB = (await createOrg()).id
  orgIds.push(orgA, orgB)
  osA = (await createServiceOrder(orgA, `H${Date.now() % 1e6}`)).data!.id as string
  const del = await createServiceOrder(orgA, `D${Date.now() % 1e6}`, { deleted_at: new Date().toISOString() })
  osADeleted = del.data?.id as string
})
afterAll(async () => {
  if (available) await deleteOrgs(orgIds)
})

describe.skipIf(!available)('[OSH-030] isolamento de tenant ponta a ponta', () => {
  it('usuário da org B pedindo a OS da org A recebe 404 igual ao de id inexistente, sem dado de A', async () => {
    await addEvents(orgA, osA, 2, { payload: { segredo: 'dado-da-org-A' } })
    as.org = orgB
    const cross = await get(osA)
    const missing = await get(randomUUID())
    expect(cross.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(cross.error?.statusMessage).toBe(missing.error?.statusMessage)
    expect(JSON.stringify(cross)).not.toContain('dado-da-org-A')
  })

  it('evento de outra org com o mesmo service_order_id não aparece', async () => {
    const foreignOrder = (await createServiceOrder(orgA, `X${Date.now() % 1e6}`)).data!.id as string
    await addEvents(orgA, foreignOrder, 1)
    await addEvents(orgB, foreignOrder, 3) // org B gravando com o id da OS de A (dado errado/forjado)
    as.org = orgA
    const res = await get(foreignOrder)
    expect(res.status).toBe(200)
    expect((res.body as Page).items).toHaveLength(1)
  })
})

describe.skipIf(!available)('[OSH-033/035] visibilidade aplicada antes do limite, sobre o banco real', () => {
  it('só general: financeiro e comissão omitidos; paginação sem página vazia nem pista de omitidos', async () => {
    const os = (await createServiceOrder(orgA, `V${Date.now() % 1e6}`)).data!.id as string
    await addEvents(orgA, os, 10, { visibility: 'general' })
    await addEvents(orgA, os, 30, { visibility: 'commission', category: 'commission', event_type: 'commission.paid' })
    await addEvents(orgA, os, 5, { visibility: 'financial', category: 'payment', event_type: 'installment.paid' })
    as.org = orgA
    as.visibilities = ['general']

    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const res = await get(os, { limit: '4', ...(cursor ? { cursor } : {}) })
      expect(res.status).toBe(200)
      const page = res.body as Page
      expect(page.items.length).toBeGreaterThan(0) // nunca página vazia
      seen.push(...page.items.map(i => i.id))
      cursor = page.nextCursor
      pages++
    } while (cursor && pages < 20)
    expect(seen).toHaveLength(10)
    expect(new Set(seen).size).toBe(10)
    expect(pages).toBe(3) // 4 + 4 + 2, último sem cursor

    as.visibilities = ['general', 'financial', 'commission']
    expect(((await get(os, { limit: '100' })).body as Page).items).toHaveLength(45)
    as.visibilities = ['general']
  })
})

describe.skipIf(!available)('[OSH-037] keyset (occurred_at, seq) com empates', () => {
  it('7 eventos no mesmo instante, evento novo entre páginas: sem repetição nem salto; ordem decrescente', async () => {
    const os = (await createServiceOrder(orgA, `K${Date.now() % 1e6}`)).data!.id as string
    const at = '2026-11-13T12:00:00.000Z'
    const original = await addEvents(orgA, os, 7, { occurred_at: at })
    as.org = orgA
    as.visibilities = ['general']

    const p1 = (await get(os, { limit: '3' })).body as Page
    expect(p1.items).toHaveLength(3)
    await addEvents(orgA, os, 1, { occurred_at: at }) // chega durante a leitura, com seq maior que o cursor
    const p2 = (await get(os, { limit: '3', cursor: p1.nextCursor! })).body as Page
    const p3 = (await get(os, { limit: '3', cursor: p2.nextCursor! })).body as Page
    const seen = [...p1.items, ...p2.items, ...p3.items].map(i => i.id)

    expect(new Set(seen).size).toBe(seen.length) // sem repetição
    expect(seen).toEqual([...original].sort((a, b) => b.seq - a.seq).map(r => r.id)) // sem salto, seq decrescente
    expect(p3.nextCursor).toBeNull()
  })

  it('mais recente primeiro entre instantes diferentes', async () => {
    const os = (await createServiceOrder(orgA, `O${Date.now() % 1e6}`)).data!.id as string
    const old = (await addEvents(orgA, os, 1, { occurred_at: '2026-01-01T00:00:00Z' }))[0]!
    const recent = (await addEvents(orgA, os, 1, { occurred_at: '2026-06-01T00:00:00Z' }))[0]!
    as.org = orgA
    expect(((await get(os)).body as Page).items.map(i => i.id)).toEqual([recent.id, old.id])
  })
})

describe.skipIf(!available)('[OSH-039] OS excluída logicamente', () => {
  it('OS com deleted_at preenchido responde 404 (D6) e os eventos permanecem na tabela', async () => {
    await addEvents(orgA, osADeleted, 2)
    as.org = orgA
    expect((await get(osADeleted)).status).toBe(404)
    const { count } = await adminDb().from('service_order_events').select('id', { count: 'exact', head: true }).eq('organization_id', orgA).eq('service_order_id', osADeleted)
    expect(count).toBe(2)
  })
})
