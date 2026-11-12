// Fase 4 (metade B) do plano de acesso: escrita em clientes, veículos, produtos, peças e produtos-mestre.
// Para cada rota: (i) sem o código -> 403 e nenhuma escrita; (ii) com outro código -> 403;
// (iii) com o código -> sucesso; (iv) admin e owner (role_actions vazio) -> sucesso. Usa o requireOrgPermission real.
// As listas GET (usadas por outras telas) continuam só com organização (D1).
// Plano: docs/engineering/access-control-rollout-plan.md, seção 8, Fase 4.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { guardSeed, USERS, type Persona } from '../../support/phase3-guard-fixture'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const api = (p: string) => `server/api/${p}`

type Case = {
  name: string
  file: string
  method?: string
  params?: Record<string, string>
  body?: unknown
  code: string
  /** status esperado de quem passa no guarda (200 por padrão) */
  okStatus?: number
}

const TABLES = {
  clients: [{ id: 'c1', organization_id: 'org-a', name: 'Cli', phone: '1', person_type: 'pf', deleted_at: null }],
  vehicles: [{ id: 'v1', organization_id: 'org-a', client_id: 'c1', license_plate: 'AAA1B23', deleted_at: null }],
  products: [{ id: 'p1', organization_id: 'org-a', name: 'Prod', code: 1, type: 'unit', deleted_at: null }],
  parts: [{ id: 'pt1', organization_id: 'org-a', code: 'P1', description: 'Peça', stock_quantity: 1, deleted_at: null }],
  master_products: [{ id: 'm1', organization_id: 'org-a', name: 'Master', deleted_at: null }],
  product_categories: []
}

const CASES: Case[] = [
  { name: 'clients POST', file: api('clients/index.post.ts'), method: 'POST', body: { name: 'Novo', phone: '11', person_type: 'pf' }, code: 'customers.create' },
  { name: 'clients/batch POST', file: api('clients/batch.post.ts'), method: 'POST', body: { rows: [{ name: 'Imp', phone: '11999999999' }] }, code: 'customers.create' },
  { name: 'clients PUT', file: api('clients/[id].put.ts'), method: 'PUT', params: { id: 'c1' }, body: { name: 'Outro' }, code: 'customers.update' },
  { name: 'clients DELETE', file: api('clients/[id].delete.ts'), method: 'DELETE', params: { id: 'c1' }, code: 'customers.delete' },
  { name: 'vehicles POST', file: api('vehicles/index.post.ts'), method: 'POST', body: { client_id: 'c1', license_plate: 'BBB2C34' }, code: 'vehicles.create' },
  { name: 'vehicles PUT', file: api('vehicles/[id].put.ts'), method: 'PUT', params: { id: 'v1' }, body: { color: 'preto' }, code: 'vehicles.update' },
  { name: 'vehicles DELETE', file: api('vehicles/[id].delete.ts'), method: 'DELETE', params: { id: 'v1' }, code: 'vehicles.delete' },
  // Sem placa o handler chega ao 400 "Placa inválida" (a consulta externa não é objeto deste teste).
  { name: 'vehicles/lookup-plate GET', file: api('vehicles/lookup-plate.get.ts'), code: 'vehicles.read', okStatus: 400 },
  { name: 'products POST', file: api('products/index.post.ts'), method: 'POST', body: { name: 'Novo', code: 2, type: 'unit' }, code: 'products.create' },
  { name: 'products/import POST', file: api('products/import.post.ts'), method: 'POST', body: { rows: [{ name: 'Imp', code: 9, type: 'unit' }] }, code: 'products.create' },
  { name: 'products PUT', file: api('products/[id].put.ts'), method: 'PUT', params: { id: 'p1' }, body: { name: 'Outro' }, code: 'products.update' },
  { name: 'products DELETE', file: api('products/[id].delete.ts'), method: 'DELETE', params: { id: 'p1' }, code: 'products.delete' },
  { name: 'parts POST', file: api('parts/index.post.ts'), method: 'POST', body: { code: 'P2', description: 'Nova' }, code: 'inventory.create' },
  { name: 'parts PUT', file: api('parts/[id].put.ts'), method: 'PUT', params: { id: 'pt1' }, body: { description: 'Outra' }, code: 'inventory.update' },
  { name: 'parts DELETE', file: api('parts/[id].delete.ts'), method: 'DELETE', params: { id: 'pt1' }, code: 'inventory.delete' },
  { name: 'master-products POST', file: api('master-products/index.post.ts'), method: 'POST', body: { name: 'Novo' }, code: 'orders.create' },
  { name: 'master-products PUT', file: api('master-products/[id].put.ts'), method: 'PUT', params: { id: 'm1' }, body: { name: 'Outro' }, code: 'orders.update' },
  { name: 'master-products DELETE', file: api('master-products/[id].delete.ts'), method: 'DELETE', params: { id: 'm1' }, code: 'orders.delete' }
]

function login(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

beforeEach(() => {
  auth.refreshSession.mockReset()
})

const run = (c: Case) => callHandler(c.file, fakeEvent({ method: c.method ?? 'GET', cookies, params: c.params, body: c.body }))

describe.each(CASES)('$name exige $code', (c) => {
  it('role sem o código -> 403 e nenhuma escrita', async () => {
    fake = createFakeSupabase(guardSeed([c.code], TABLES))
    const before = structuredClone(fake.tables)
    login('sem')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(fake.writes).toHaveLength(0)
    expect(fake.tables).toEqual(before)
  })

  it('role com outro código -> 403 e nenhuma escrita', async () => {
    fake = createFakeSupabase(guardSeed(['bonuses.read', c.code], { ...TABLES, role_actions: [] }))
    // r-com só recebe bonuses.read (act-0)
    fake.tables.role_actions!.push({ role_id: 'r-com', action_id: 'act-0', is_granted: true })
    login('com')
    const res = await run(c)
    expect(res.status).toBe(403)
    expect(fake.writes).toHaveLength(0)
  })

  it('role com o código -> sucesso', async () => {
    fake = createFakeSupabase(guardSeed([c.code], TABLES))
    login('com')
    const res = await run(c)
    expect(res.status).toBe(c.okStatus ?? 200)
  })

  it.each(['admin', 'owner'] as const)('%s passa sem concessão em role_actions', async (persona) => {
    fake = createFakeSupabase(guardSeed([c.code], TABLES))
    fake.tables.role_actions!.length = 0
    login(persona)
    const res = await run(c)
    expect(res.status).toBe(c.okStatus ?? 200)
  })
})

describe('leituras que continuam só com organização (D1)', () => {
  const LISTS = [
    { name: 'GET clients', file: api('clients/index.get.ts') },
    { name: 'GET vehicles', file: api('vehicles/index.get.ts') },
    { name: 'GET products', file: api('products/index.get.ts') },
    { name: 'GET parts', file: api('parts/index.get.ts') },
    { name: 'GET master-products', file: api('master-products/index.get.ts') }
  ]
  it.each(LISTS)('$name: role sem nenhuma concessão -> 200', async ({ file }) => {
    fake = createFakeSupabase(guardSeed([], TABLES))
    login('sem')
    const res = await callHandler(file, fakeEvent({ cookies }))
    expect(res.status).toBe(200)
  })
})
