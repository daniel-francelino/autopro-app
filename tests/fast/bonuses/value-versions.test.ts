// POST /api/bonuses/:id/value-versions contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 3 (BON-03a/b/c, BON-18, BON-05h, BON-06j).
// Padrão de referência: tests/fast/bonuses/generate.test.ts.
//  - BON-03b: o caminho 23505 -> update não é alcançável com o fake atual (ver it.todo abaixo).
//  - BON-03c depende de G1-OQ-08.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { baseSeed, USERS, MONTH, type Persona } from '../../support/bonuses-fixture'
import { resolveEffectiveVersion, type BonusValueVersionRecord } from '../../../server/utils/bonuses'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const ADD_VERSION = 'server/api/bonuses/[id]/value-versions.post.ts'

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

beforeEach(() => {
  fake = createFakeSupabase(baseSeed())
  loginAs('owner')
  auth.refreshSession.mockReset()
})

const addVersion = (bonusId: string, body?: Record<string, unknown>) =>
  callHandler(ADD_VERSION, fakeEvent({ method: 'POST', cookies, params: { id: bonusId }, body }))

const table = (name: string) => fake.tables[name]!
const versionsOf = (bonusId: string) => table('bonus_value_versions').filter(v => v.bonus_id === bonusId)
const snap = (...names: string[]) => structuredClone(Object.fromEntries(names.map(n => [n, table(n)])))
const effective = (bonusId: string, month: string) =>
  resolveEffectiveVersion(versionsOf(bonusId) as unknown as BonusValueVersionRecord[], month)

const NEXT_MONTH = '2026-11-01'
const VALID = { commissionBase: 'profit', goalAmount: 4000, bonusAmount: 600, effectiveFrom: NEXT_MONTH }

describe('BON-03a: nova versão para o mês seguinte', () => {
  it('BON-03a: effectiveFrom M+1 -> 200; mês M continua na versão antiga, M+1 usa a nova; versões antigas intactas', async () => {
    expect(effective('bon-a', MONTH)!.id).toBe('v-new') // pré-condição: vigente em M (out) é v-new (jun)
    const oldRows = structuredClone(versionsOf('bon-a'))

    const res = await addVersion('bon-a', VALID)
    expect(res.status).toBe(200)

    const rows = versionsOf('bon-a')
    expect(rows).toHaveLength(oldRows.length + 1)
    for (const old of oldRows) expect(rows.find(r => r.id === old.id)).toEqual(old) // append-only

    const created = rows.find(r => !oldRows.some(o => o.id === r.id))!
    expect(created).toMatchObject({ bonus_id: 'bon-a', commission_base: 'profit', goal_amount: 4000, bonus_amount: 600, effective_from: NEXT_MONTH, created_by: 'owner@a.com' })
    expect((res.body as { item: { id: string } }).item.id).toBe(created.id)

    expect(effective('bon-a', MONTH)!.id).toBe('v-new')
    expect(effective('bon-a', NEXT_MONTH)!.id).toBe(created.id)
    expect(fake.writes.map(w => [w.table, w.op])).toEqual([['bonus_value_versions', 'insert']])
  })
})

describe('BON-03b: versão no mesmo mês (caminho 23505 -> update)', () => {
  // Limitação do fake: createFakeSupabase não tem constraint única (bonus_value_versions_bonus_effective_from_unique
  // existe só no Postgres) e failNext devolve { message } sem `code`; o handler compara error.code === '23505'.
  // Sem isso o INSERT duplicado simplesmente cria 2 linhas e o ramo de UPDATE nunca roda. Provar exigiria estender o
  // fake (erro com code / constraint única) ou testar no banco (tests/db, PR 11). Não se simula o erro dentro do teste.
  it.todo('BON-03b: effectiveFrom igual ao de versão existente -> 200, substitui a linha do mês (1 versão por bônus e mês). Fake sem unique/code 23505; cobrir em tests/db (PR 11) ou estendendo o fake')

  // Extra, não cobre o cenário BON-03b (que segue como it.todo acima): só garante que erro != 23505 não cai no update.
  it('extra (não é BON-03b): erro de insert não-23505 vira 500 e não regrava nada', async () => {
    const before = snap('bonus_value_versions')
    fake.failNext('bonus_value_versions', 'boom')
    const res = await addVersion('bon-a', { ...VALID, effectiveFrom: '2026-06-01' })
    expect(res.status).toBe(500)
    expect(res.error?.statusMessage).toContain('Failed to create bonus value version')
    expect(snap('bonus_value_versions')).toEqual(before)
    expect(fake.writes).toEqual([])
  })
})

describe('BON-03c: versão retroativa para mês já gerado', () => {
  it.todo('BON-03c: geração/pagamento do mês fechado não é reescrito por versão retroativa - aguarda G1-OQ-08')
})

describe('BON-18: validação do corpo', () => {
  const invalidBodies: Array<[string, Record<string, unknown>]> = [
    ['commissionBase inválido', { ...VALID, commissionBase: 'lucro' }],
    ['commissionBase ausente', { ...VALID, commissionBase: undefined }],
    ['goalAmount 0', { ...VALID, goalAmount: 0 }],
    ['goalAmount negativo', { ...VALID, goalAmount: -1 }],
    ['goalAmount NaN', { ...VALID, goalAmount: Number.NaN }],
    ['goalAmount string', { ...VALID, goalAmount: 'abc' }],
    ['bonusAmount 0', { ...VALID, bonusAmount: 0 }],
    ['bonusAmount negativo', { ...VALID, bonusAmount: -1 }],
    ['bonusAmount NaN', { ...VALID, bonusAmount: Number.NaN }],
    ['bonusAmount string', { ...VALID, bonusAmount: 'abc' }]
  ]

  it.each(invalidBodies)('BON-18: %s -> 400 e nada inserido', async (_label, body) => {
    const before = snap('bonus_value_versions')
    const res = await addVersion('bon-a', body)
    expect(res.status).toBe(400)
    expect(snap('bonus_value_versions')).toEqual(before)
    expect(fake.writes).toEqual([])
  })

  // KF-50 (G1-SD-08): effectiveFrom é gravado como veio. O correto é 400 (ou normalizar), sem criar versão fora do dia 01.
  it.fails('BON-18: effectiveFrom "abc" -> 400 e nada inserido (KF-50)', async () => {
    const before = snap('bonus_value_versions')
    const res = await addVersion('bon-a', { ...VALID, effectiveFrom: 'abc' })
    expect(res.status).toBe(400)
    expect(snap('bonus_value_versions')).toEqual(before)
  })

  it.fails('BON-18: effectiveFrom "2026-11-15" (dia diferente de 01) -> 400 e nada inserido (KF-50)', async () => {
    const before = snap('bonus_value_versions')
    const res = await addVersion('bon-a', { ...VALID, effectiveFrom: '2026-11-15' })
    expect(res.status).toBe(400)
    expect(snap('bonus_value_versions')).toEqual(before)
  })
})

describe('BON-05h: isolamento de tenant', () => {
  it('BON-05h: bônus de B logado em A -> 404; nenhuma versão criada em B', async () => {
    const before = snap('bonus_value_versions')
    const res = await addVersion('bon-b', VALID)
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Bônus não encontrado')
    expect(versionsOf('bon-b')).toHaveLength(1)
    expect(snap('bonus_value_versions')).toEqual(before)
    expect(fake.writes).toEqual([])
  })
})

describe('BON-06j: permissão', () => {
  it('BON-06j: emp-sem (sem bonuses.update) -> 403 e nada criado', async () => {
    loginAs('emp-sem')
    const res = await addVersion('bon-a', VALID)
    expect(res.status).toBe(403)
    expect(res.error?.statusMessage).toContain('Acesso negado')
    expect(fake.writes).toEqual([])
  })
  it('BON-06j: controle - emp-upd (tem bonuses.update) cria versão -> 200', async () => {
    loginAs('emp-upd')
    expect((await addVersion('bon-a', VALID)).status).toBe(200)
    expect(versionsOf('bon-a')).toHaveLength(4)
  })
})
