// Handlers de leitura de /api/employees: GET lista, GET :id/commission-plans, :id/commission-rules, :id/bonuses contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 4 (EMP-07, 05a, 05b, 05c, 06i, 06j, 06k). EMP-06a está em crud.test.ts; EMP-06h em commissions.test.ts.
//  - 401 sem sessão já é provado por guard-matrix.test.ts; não se repete aqui.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md, KF-54; G1-SD-06).
//    Ao corrigir o handler o Vitest acusa "unexpected pass": troque it.fails por it.
//  - Limitações do fake: `or()` é no-op, então o filtro de desligados do GET lista (`termination_date.is.null,termination_date.gt.now()`) e a busca
//    (`search`) não são provados aqui; cobertos como it.todo. `range()` só limita; `select(cols)` devolve todas as colunas.
//  - Relógio: os mapeamentos de mês corrente usam fake timers só para `Date` (SEED_NOW = 2026-06-15).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { employeesSeed, SEED_NOW, USERS, type Persona } from './employees-seed'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const LIST = 'server/api/employees/index.get.ts'
const PLANS = 'server/api/employees/[id]/commission-plans.get.ts'
const RULES = 'server/api/employees/[id]/commission-rules.get.ts'
const BONUSES = 'server/api/employees/[id]/bonuses.get.ts'

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

beforeEach(() => {
  fake = createFakeSupabase(employeesSeed())
  loginAs('owner')
  auth.refreshSession.mockReset()
})
afterEach(() => vi.useRealTimers())

const freezeNow = (iso = SEED_NOW) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)) }
const list = (query: Record<string, unknown> = {}) => callHandler(LIST, fakeEvent({ cookies, query }))
const plans = (id: string) => callHandler(PLANS, fakeEvent({ cookies, params: { id } }))
const rules = (id: string, query: Record<string, unknown> = {}) => callHandler(RULES, fakeEvent({ cookies, params: { id }, query }))
const bonuses = (id: string, query: Record<string, unknown> = {}) => callHandler(BONUSES, fakeEvent({ cookies, params: { id }, query }))
type Items = { items: Array<Record<string, any>> }
const itemsOf = (res: { body?: unknown }) => (res.body as Items).items

describe('EMP-07: GET lista', () => {
  it('padrão: só org A, nunca excluído (deleted_at) nem funcionário de B; ordenado por nome; ativo e futuro presentes (o filtro de desligados não é provado, ver it.todo)', async () => {
    const res = await list()
    expect(res.status).toBe(200)
    const items = itemsOf(res)
    const ids = items.map(i => i.id)
    expect(ids).toContain('e-a1')
    expect(ids).toContain('e-a-fut')
    expect(ids).not.toContain('e-a-del')
    expect(ids).not.toContain('e-b1')
    expect(ids).not.toContain('e-b-link')
    expect(items.every(i => i.organization_id === 'org-a' && i.deleted_at === null)).toBe(true)
    const names = items.map(i => i.name)
    expect(names).toEqual([...names].sort())
  })

  it('include_terminated=true: continua sem excluído e sem B; ativos presentes (a inclusão do desligado não é provada, ver it.todo)', async () => {
    const ids = itemsOf(await list({ include_terminated: 'true' })).map(i => i.id)
    expect(ids).toContain('e-a1')
    expect(ids).not.toContain('e-a-del')
    expect(ids).not.toContain('e-b1')
  })

  // Prova só org, deleted_at e completude dos vivos; não prova o efeito da flag (com `or()` no-op, o resultado independe dela).
  it('lista devolve todos os vivos de A por org e deleted_at (nenhum a mais, nenhum a menos; independe do filtro de desligados)', async () => {
    const ids = itemsOf(await list({ include_terminated: 'true' })).map(i => i.id).sort()
    const live = employeesSeed().employees!.filter(e => e.organization_id === 'org-a' && !e.deleted_at).map(e => e.id).sort()
    expect(ids).toEqual(live)
  })

  it('não grava nada', async () => {
    await list()
    expect(fake.writes).toHaveLength(0)
  })

  it.todo('EMP-07: padrão exclui o desligado e include_terminated=true o inclui (fake não prova .or() (filtro de desligados))')
  it.todo('EMP-07: `search` filtra por name/tax_id. Limitação do fake: `or()` é no-op, não prova o filtro')
})

describe('EMP-05a: GET :id/commission-plans', () => {
  beforeEach(() => freezeNow())

  it('só planos vivos da org atribuídos ao funcionário: 2 atribuídos (1 excluído) -> 1 plano; plano de B e atribuição removida ficam fora', async () => {
    const res = await plans('e-a1')
    expect(res.status).toBe(200)
    const items = itemsOf(res)
    expect(items.map(i => i.planId)).toEqual(['pl-a1'])
    expect(items[0]).toMatchObject({ planName: 'Plano Mecânico', active: true })
    expect(JSON.stringify(res.body)).not.toContain('Plano B')
    expect(JSON.stringify(res.body)).not.toContain('Plano Excluído')
    expect(JSON.stringify(res.body)).not.toContain('Plano Outro')
  })

  it('traz a versão vigente no mês corrente (mai/2026 em jun/2026) com as regras e as categorias nomeadas', async () => {
    const [item] = itemsOf(await plans('e-a1'))
    expect(item!.effectiveFrom).toBe('2026-05-01')
    expect(item!.rules.map((r: any) => r.id)).toEqual(['ru-new', 'ru-new-def'])
    expect(item!.rules[0]).toEqual({ id: 'ru-new', name: 'Regra nova', commissionType: 'percentage', commissionAmount: 10, commissionBase: 'profit', isDefault: false, categories: [{ id: 'cat-1', name: 'Mecânica' }] })
    expect(item!.rules[1]).toMatchObject({ id: 'ru-new-def', commissionType: 'fixed_amount', commissionAmount: 20, commissionBase: null, isDefault: true, categories: [] })
  })

  it('a versão vigente depende do mês corrente: em mar/2026 vale a antiga', async () => {
    freezeNow('2026-03-10T12:00:00')
    const [item] = itemsOf(await plans('e-a1'))
    expect(item!.effectiveFrom).toBe('2026-01-01')
    expect(item!.rules.map((r: any) => r.id)).toEqual(['ru-old'])
  })

  it('funcionário sem atribuição ativa -> 200 com lista vazia', async () => {
    const res = await plans('e-a-link')
    expect(res.status).toBe(200)
    expect(itemsOf(res)).toEqual([])
  })

  it('controle positivo: emp-com (commissions.read concedido) -> 200 com o mesmo plano', async () => {
    loginAs('emp-com')
    const res = await plans('e-a1')
    expect(res.status).toBe(200)
    expect(itemsOf(res).map(i => i.planId)).toEqual(['pl-a1'])
  })
})

describe('EMP-06i: GET :id/commission-plans de funcionário de B e permissão', () => {
  beforeEach(() => freezeNow())

  it('sem vazamento: funcionário de B logado em A não devolve plano nem regra de B', async () => {
    const res = await plans('e-b1')
    const text = JSON.stringify(res)
    expect(text).not.toContain('Plano B')
    expect(text).not.toContain('Regra B')
    expect(text).not.toContain('pl-b')
    expect(res.status === 200 || res.status === 404).toBe(true)
  })

  it.fails('funcionário de B logado em A -> 404 (hoje 200 com lista vazia) [KF-54]', async () => {
    const res = await plans('e-b1')
    expect(res.status).toBe(404)
  })

  it.fails('funcionário inexistente -> 404 (hoje 200 com lista vazia) [KF-54]', async () => {
    const res = await plans('nope')
    expect(res.status).toBe(404)
  })

  it('emp-sem (sem commissions.read) -> 403 "Acesso negado", nada lido', async () => {
    loginAs('emp-sem')
    const res = await plans('e-a1')
    expect(res.status).toBe(403)
    expect(res.error?.statusMessage).toContain('Acesso negado')
    expect(res.body).toBeUndefined()
  })
})

describe('EMP-05b: GET :id/commission-rules', () => {
  beforeEach(() => freezeNow())
  const ids = (res: { body?: unknown }) => itemsOf(res).map(r => r.id)

  it('sem referenceDate: regras do mês corrente (jun/2026 -> versão de mai), com plan_id, valor numérico e categorias', async () => {
    const res = await rules('e-a1')
    expect(res.status).toBe(200)
    expect(ids(res)).toEqual(['ru-new', 'ru-new-def'])
    expect(itemsOf(res)[0]).toMatchObject({ plan_id: 'pl-a1', commission_type: 'percentage', commission_amount: 10, commission_base: 'profit', is_default: false, category_ids: ['cat-1'] })
    expect(itemsOf(res)[1]).toMatchObject({ plan_id: 'pl-a1', commission_type: 'fixed_amount', commission_amount: 20, is_default: true, category_ids: [] })
  })

  it('referenceDate=2026-03-20: regras do mês informado (versão de jan) em vez do corrente', async () => {
    const res = await rules('e-a1', { referenceDate: '2026-03-20' })
    expect(ids(res)).toEqual(['ru-old'])
    expect(itemsOf(res)[0]).toMatchObject({ plan_id: 'pl-a1', commission_amount: 5, commission_base: 'revenue', is_default: true })
  })

  it('referenceDate é normalizada para o 1º dia do mês: 2026-05-31 já pega a versão que vale desde 2026-05-01', async () => {
    expect(ids(await rules('e-a1', { referenceDate: '2026-05-31' }))).toEqual(['ru-new', 'ru-new-def'])
    expect(ids(await rules('e-a1', { referenceDate: '2026-04-30' }))).toEqual(['ru-old'])
  })

  it('referenceDate anterior a qualquer versão -> 200 e lista vazia', async () => {
    const res = await rules('e-a1', { referenceDate: '2025-12-01' })
    expect(res.status).toBe(200)
    expect(itemsOf(res)).toEqual([])
  })

  it('referenceDate só com espaços cai no mês corrente', async () => {
    expect(ids(await rules('e-a1', { referenceDate: '   ' }))).toEqual(['ru-new', 'ru-new-def'])
  })

  it('coerente com os planos atribuídos: plano excluído, atribuição removida e plano de B não geram regra', async () => {
    const all = JSON.stringify((await rules('e-a1')).body)
    expect(all).not.toContain('ru-a2')
    expect(all).not.toContain('ru-other')
    expect(all).not.toContain('ru-b')
  })

  it('coerente com o endpoint de planos: as mesmas regras do mês corrente', async () => {
    const fromRules = ids(await rules('e-a1')).sort()
    const fromPlans = itemsOf(await plans('e-a1')).flatMap(p => p.rules.map((r: any) => r.id)).sort()
    expect(fromRules).toEqual(fromPlans)
  })

  it('plano inativo não gera regra: e-a-fut tem um plano ativo e um inativo -> só a regra do ativo', async () => {
    const res = await rules('e-a-fut')
    expect(ids(res)).toEqual(['ru-other'])
    expect(itemsOf(res)[0]).toMatchObject({ plan_id: 'pl-a-other' })
  })

  it('não exige permissão de comissões (decisão documentada no handler): emp-sem -> 200 com as regras', async () => {
    loginAs('emp-sem')
    const res = await rules('e-a1')
    expect(res.status).toBe(200)
    expect(ids(res)).toEqual(['ru-new', 'ru-new-def'])
  })
})

describe('EMP-06j: GET :id/commission-rules de funcionário de B logado em A', () => {
  beforeEach(() => freezeNow())

  it('nenhuma regra de B vaza (200 vazio ou 404, ambos aceitos pela regra)', async () => {
    const res = await rules('e-b1')
    expect([200, 404]).toContain(res.status)
    if (res.status === 200) expect(itemsOf(res)).toEqual([])
    const text = JSON.stringify(res)
    expect(text).not.toContain('Regra B')
    expect(text).not.toContain('ru-b')
    expect(text).not.toContain('pl-b')
  })

  it('mesmo com referenceDate e ?organization_id=org-b na query nada de B aparece', async () => {
    const res = await rules('e-b1', { referenceDate: '2026-03-01', organization_id: 'org-b' })
    expect([200, 404]).toContain(res.status)
    expect(JSON.stringify(res)).not.toContain('Regra B')
  })

  it.todo('EMP-06j: contrato de funcionário de outra org (200 vazio vs 404). Aguarda decisão de contrato (G1-SD-06, KF-54); se o contrato for 404, trocar por it.fails KF-54')
})

describe('EMP-05c: GET :id/bonuses', () => {
  const MONTH = { referenceMonth: '2026-10-01' }
  const byId = (res: { body?: unknown }, id: string) => itemsOf(res).find(i => i.bonusId === id)

  it('só bônus vivos e ativos atribuídos: removido, excluído, inativo e o de B ficam fora', async () => {
    const res = await bonuses('e-a1', MONTH)
    expect(res.status).toBe(200)
    expect(itemsOf(res).map(i => i.bonusId).sort()).toEqual(['bo-live', 'bo-nogen'])
    const text = JSON.stringify(res.body)
    for (const name of ['Meta Removida', 'Meta Excluída', 'Meta Inativa', 'Meta B']) expect(text).not.toContain(name)
  })

  it('bônus com geração no mês: generated=true com os valores gravados na geração', async () => {
    expect(byId(await bonuses('e-a1', MONTH), 'bo-live')).toEqual({
      bonusId: 'bo-live', bonusName: 'Meta Live', referenceMonth: '2026-10-01', commissionBase: 'revenue', goalAmount: 3000, bonusAmount: 500, achievedAmount: 3500, goalMet: true, generated: true
    })
  })

  it('bônus sem geração no mês: generated=false, meta e valor da versão vigente, alcançado das OS do funcionário no mês', async () => {
    // so-oct (5000, concluída, e-a1) conta; a meta é 6000 -> não batida
    expect(byId(await bonuses('e-a1', MONTH), 'bo-nogen')).toEqual({
      bonusId: 'bo-nogen', bonusName: 'Meta Sem Geração', referenceMonth: '2026-10-01', commissionBase: 'revenue', goalAmount: 6000, bonusAmount: 300, achievedAmount: 5000, goalMet: false, generated: false
    })
  })

  it('o status de geração é do mês pedido: em set/2026 o bônus gerado em out aparece como não gerado e sem alcançado', async () => {
    const live = byId(await bonuses('e-a1', { referenceMonth: '2026-09-01' }), 'bo-live')
    expect(live).toMatchObject({ generated: false, achievedAmount: 0, goalMet: false, goalAmount: 3000, bonusAmount: 500, referenceMonth: '2026-09-01' })
  })

  it('geração de outro funcionário no mesmo mês não marca como gerado para este', async () => {
    fake.tables.bonus_generations!.push({ id: 'bg-2', bonus_id: 'bo-nogen', employee_id: 'e-a-fut', reference_month: '2026-10-01', commission_base: 'revenue', goal_amount: 6000, bonus_amount: 300, achieved_amount: 9000, goal_met: true })
    expect(byId(await bonuses('e-a1', MONTH), 'bo-nogen')).toMatchObject({ generated: false, achievedAmount: 5000, goalMet: false })
  })

  it('funcionário sem atribuição -> 200 com lista vazia; leitura não grava nada', async () => {
    const res = await bonuses('e-a-link', MONTH)
    expect(res.status).toBe(200)
    expect(itemsOf(res)).toEqual([])
    await bonuses('e-a1', MONTH)
    expect(fake.writes).toHaveLength(0)
  })

  it('controle positivo: emp-com (bonuses.read concedido) -> 200 com os mesmos bônus', async () => {
    loginAs('emp-com')
    const res = await bonuses('e-a1', MONTH)
    expect(res.status).toBe(200)
    expect(itemsOf(res).map(i => i.bonusId).sort()).toEqual(['bo-live', 'bo-nogen'])
  })
})

describe('EMP-06k: GET :id/bonuses de funcionário de B e permissão', () => {
  const MONTH = { referenceMonth: '2026-10-01' }

  it('sem vazamento: funcionário de B logado em A não devolve bônus de B', async () => {
    const res = await bonuses('e-b1', MONTH)
    const text = JSON.stringify(res)
    expect(text).not.toContain('Meta B')
    expect(text).not.toContain('bo-b')
    expect(res.status === 200 || res.status === 404).toBe(true)
  })

  it.fails('funcionário de B logado em A -> 404 (hoje 200 com lista vazia) [KF-54]', async () => {
    const res = await bonuses('e-b1', MONTH)
    expect(res.status).toBe(404)
  })

  it.fails('funcionário inexistente -> 404 (hoje 200 com lista vazia) [KF-54]', async () => {
    const res = await bonuses('nope', MONTH)
    expect(res.status).toBe(404)
  })

  it('emp-sem (sem bonuses.read) -> 403 "Acesso negado", nada lido', async () => {
    loginAs('emp-sem')
    const res = await bonuses('e-a1', MONTH)
    expect(res.status).toBe(403)
    expect(res.error?.statusMessage).toContain('Acesso negado')
    expect(res.body).toBeUndefined()
  })
})
