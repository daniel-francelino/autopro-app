// POST /api/bonuses/:id/generate e DELETE /api/bonuses/:id/generations/:employeeId contra o fake em memória.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 3 (BON-01a/b/c/e/f, BON-19, BON-20, BON-05i, BON-05j).
// Padrão de referência: tests/fast/bank-accounts/handlers.test.ts.
//  - BON-01d (concorrência) não entra aqui: precisa de banco real (tests/db, PR 11). O fake não tem constraint única
//    nem paralelismo real, então não prova nada sobre G1-SD-09.
//  - it.fails = comportamento correto ainda não implementado (docs/testing/known-failures.md).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals, installServerUtilsGlobals, callHandler } from '../../support/handler-harness'
import { createFakeSupabase, type FakeSupabase } from '../../support/fake-supabase'
import { baseSeed, USERS, MONTH, BONUS_DUE_DAY, type Persona } from '../../support/bonuses-fixture'
import { resolveDueDate, resolveEffectiveVersion, type BonusValueVersionRecord } from '../../../server/utils/bonuses'

let fake: FakeSupabase
const auth = { getUser: vi.fn(), refreshSession: vi.fn() }

vi.mock('../../../server/utils/supabase', () => ({ getSupabaseAdminClient: () => fake.client }))
vi.mock('../../../server/utils/supabase-anon', () => ({ getSupabaseAnonClient: () => ({ auth }) }))
vi.mock('stripe', () => ({ default: class {} }))

installNitroGlobals()
await installServerUtilsGlobals()

const cookies = { 'sb-access-token': 'tok' }
const GENERATE = 'server/api/bonuses/[id]/generate.post.ts'
const REMOVE_GENERATION = 'server/api/bonuses/[id]/generations/[employeeId].delete.ts'

function loginAs(persona: Persona) {
  const u = USERS[persona]
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: u.id, email: u.email } }, error: null })
}

function seed() {
  const s = baseSeed()
  // Org B: uma geração sem registro (meta não atingida) para o BON-05j.
  s.bonus_generations = [
    { id: 'gen-b', bonus_id: 'bon-b', employee_id: 'e-b1', reference_month: MONTH, commission_base: 'revenue', goal_amount: 100, bonus_amount: 900, achieved_amount: 5000, goal_met: false, financial_record_id: null }
  ]
  fake = createFakeSupabase(s)
}

beforeEach(() => {
  seed()
  loginAs('owner')
  auth.refreshSession.mockReset()
})

type GenResult = { employeeId: string, status: string, financialRecordId: string | null, bonusAmount: number | null }
type GenBody = { data: { referenceMonth: string, generatedCount: number, skippedCount: number, results: GenResult[] } }

const generate = (bonusId: string, body?: Record<string, unknown>) =>
  callHandler(GENERATE, fakeEvent({ method: 'POST', cookies, params: { id: bonusId }, body }))
const removeGeneration = (bonusId: string, employeeId: string, referenceMonth?: string) =>
  callHandler(REMOVE_GENERATION, fakeEvent({ method: 'DELETE', cookies, params: { id: bonusId, employeeId }, query: referenceMonth ? { referenceMonth } : {} }))

const resultOf = (res: Awaited<ReturnType<typeof generate>>, employeeId: string) =>
  (res.body as GenBody).data.results.find(r => r.employeeId === employeeId)

const table = (name: string) => fake.tables[name]!
const bonusRecords = () => table('employee_financial_records').filter(r => r.record_type === 'bonus')
const generationsOf = (bonusId: string, month?: string) =>
  table('bonus_generations').filter(g => g.bonus_id === bonusId && (!month || g.reference_month === month))
const snap = (...names: string[]) => structuredClone(Object.fromEntries(names.map(n => [n, table(n)])))
const BANK_TABLES = ['bank_accounts', 'bank_account_statements', 'financial_transactions']
const writesTo = (...names: string[]) => fake.writes.filter(w => names.includes(w.table))

describe('BON-01a: generate em lote (2 atribuídos, 1 atinge a meta)', () => {
  it('BON-01a: "generated" cria registro pendente com valor da versão vigente e data de resolveDueDate; "goal_not_met" não cria registro', async () => {
    const res = await generate('bon-a', { referenceMonth: MONTH })
    expect(res.status).toBe(200)

    const body = (res.body as GenBody).data
    expect(body).toMatchObject({ referenceMonth: MONTH, generatedCount: 1, skippedCount: 1 })

    // Valor esperado vem da versão vigente no mês (não a mais antiga nem a futura), resolvida pelo util existente.
    const effective = resolveEffectiveVersion(table('bonus_value_versions').filter(v => v.bonus_id === 'bon-a') as unknown as BonusValueVersionRecord[], MONTH)!
    expect(effective.id).toBe('v-new')
    const expectedAmount = Number(effective.bonus_amount)
    expect(expectedAmount).toBe(500.25) // tripwire literal: a versão antiga pagaria 100, a futura 777

    const e1 = resultOf(res, 'e1')!
    expect(e1.status).toBe('generated')
    expect(e1.bonusAmount).toBe(expectedAmount)
    expect(e1.financialRecordId).toEqual(expect.any(String))

    const records = bonusRecords()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      id: e1.financialRecordId,
      organization_id: 'org-a',
      employee_id: 'e1',
      record_type: 'bonus',
      bonus_id: 'bon-a',
      status: 'pending',
      amount: expectedAmount,
      reference_date: resolveDueDate(MONTH, BONUS_DUE_DAY)
    })
    expect(records[0]!.reference_date).toBe('2026-10-15') // tripwire literal do util
    expect(records[0]!.financial_transaction_id ?? null).toBeNull()

    const e2 = resultOf(res, 'e2')!
    expect(e2.status).toBe('goal_not_met')
    expect(e2.financialRecordId).toBeNull()
    expect(records.some(r => r.employee_id === 'e2')).toBe(false)

    // Uma geração por funcionário, ligada ao registro só quando a meta foi atingida.
    const gens = generationsOf('bon-a', MONTH)
    expect(gens).toHaveLength(2)
    expect(gens.find(g => g.employee_id === 'e1')).toMatchObject({ goal_met: true, financial_record_id: e1.financialRecordId, bonus_amount: expectedAmount, goal_amount: 3000 })
    expect(gens.find(g => g.employee_id === 'e2')).toMatchObject({ goal_met: false, financial_record_id: null })

    // Pendente não mexe em banco.
    expect(writesTo(...BANK_TABLES)).toEqual([])
  })
})

describe('BON-01b: idempotência da geração', () => {
  it('BON-01b: segunda chamada em lote -> already_generated; contagens de registros e gerações não mudam', async () => {
    await generate('bon-a', { referenceMonth: MONTH })
    const before = snap('employee_financial_records', 'bonus_generations')
    const writesBefore = fake.writes.length

    const res = await generate('bon-a', { referenceMonth: MONTH })
    expect(res.status).toBe(200)
    expect(resultOf(res, 'e1')!.status).toBe('already_generated')
    expect(resultOf(res, 'e2')!.status).toBe('already_generated')
    expect((res.body as GenBody).data.generatedCount).toBe(0)

    expect(bonusRecords()).toHaveLength(1)
    expect(generationsOf('bon-a', MONTH)).toHaveLength(2)
    expect(snap('employee_financial_records', 'bonus_generations')).toEqual(before)
    expect(fake.writes.slice(writesBefore).filter(w => w.op === 'insert')).toEqual([])
  })

  it('BON-01b: modo employeeId depois do lote não duplica (nem para quem gerou, nem para quem não atingiu a meta)', async () => {
    await generate('bon-a', { referenceMonth: MONTH })
    const before = snap('employee_financial_records', 'bonus_generations')

    for (const employeeId of ['e1', 'e2']) {
      const res = await generate('bon-a', { referenceMonth: MONTH, employeeId })
      expect(res.status).toBe(200)
      expect((res.body as GenBody).data.results).toHaveLength(1)
      expect(resultOf(res, employeeId)!.status).toBe('already_generated')
    }
    expect(snap('employee_financial_records', 'bonus_generations')).toEqual(before)
  })

  it('BON-01b: modo employeeId primeiro, depois lote -> o lote só gera o que falta', async () => {
    const first = await generate('bon-a', { referenceMonth: MONTH, employeeId: 'e1' })
    expect(resultOf(first, 'e1')!.status).toBe('generated')

    const batch = await generate('bon-a', { referenceMonth: MONTH })
    expect(resultOf(batch, 'e1')!.status).toBe('already_generated')
    expect(resultOf(batch, 'e2')!.status).toBe('goal_not_met')
    expect(bonusRecords()).toHaveLength(1)
    expect(generationsOf('bon-a', MONTH)).toHaveLength(2)
  })
})

describe('BON-01c: sem versão vigente e funcionário não atribuído', () => {
  it('BON-01c: mês anterior a qualquer versão -> no_value_configured para todos, nada inserido', async () => {
    const res = await generate('bon-a', { referenceMonth: '2025-12-01' })
    expect(res.status).toBe(200)
    expect((res.body as GenBody).data.results.map(r => r.status)).toEqual(['no_value_configured', 'no_value_configured'])
    expect((res.body as GenBody).data.generatedCount).toBe(0)
    expect(bonusRecords()).toHaveLength(0)
    expect(generationsOf('bon-a')).toHaveLength(0)
    expect(fake.writes.filter(w => w.op === 'insert')).toEqual([])
  })

  it.each([
    ['funcionário da org A não atribuído', 'e3'],
    ['funcionário da org B', 'e-b1']
  ])('BON-01c: employeeId = %s -> 404 "Funcionário não está atribuído", nada inserido', async (_label, employeeId) => {
    const res = await generate('bon-a', { referenceMonth: MONTH, employeeId })
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toContain('Funcionário não está atribuído')
    expect(bonusRecords()).toHaveLength(0)
    expect(generationsOf('bon-a')).toHaveLength(0)
  })
})

describe('BON-19: referenceMonth fora do dia 01 (G1-SD-08, KF-49)', () => {
  // Solução-agnóstico: normalizar para o dia 01 (2ª chamada = already_generated) ou rejeitar o dia 15 (4xx) cumprem.
  // Hoje o dedupe compara a string crua: "2026-11-15" e "2026-11-01" geram duas vezes o bônus de novembro.
  it.fails('BON-19: generate com "2026-11-15" e depois "2026-11-01" não gera dois registros do mesmo mês para o mesmo funcionário [KF-49, G1-SD-08]', async () => {
    await generate('bon-a', { referenceMonth: '2026-11-15', employeeId: 'e1' })
    await generate('bon-a', { referenceMonth: '2026-11-01', employeeId: 'e1' })

    const novemberRecords = bonusRecords().filter(r => r.employee_id === 'e1' && String(r.description).includes('2026-11'))
    const novemberGenerations = generationsOf('bon-a').filter(g => g.employee_id === 'e1' && String(g.reference_month).startsWith('2026-11'))
    expect(novemberRecords.length).toBeLessThanOrEqual(1)
    expect(novemberGenerations.length).toBeLessThanOrEqual(1)
  })
})

describe('BON-01e: DELETE de geração goal_not_met', () => {
  it('BON-01e: 200; só a linha de bonus_generations some; registros e saldos intocados; pode gerar de novo', async () => {
    await generate('bon-a', { referenceMonth: MONTH })
    const e1Gen = structuredClone(generationsOf('bon-a', MONTH).find(g => g.employee_id === 'e1')!)
    const records = snap('employee_financial_records')
    const bank = snap(...BANK_TABLES)
    const writesBefore = fake.writes.length

    const res = await removeGeneration('bon-a', 'e2', MONTH)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })

    expect(generationsOf('bon-a', MONTH).map(g => g.employee_id)).toEqual(['e1'])
    expect(generationsOf('bon-a', MONTH)[0]).toEqual(e1Gen)
    expect(generationsOf('bon-b')).toHaveLength(1) // geração da org B continua lá
    expect(snap('employee_financial_records')).toEqual(records)
    expect(snap(...BANK_TABLES)).toEqual(bank)
    const newWrites = fake.writes.slice(writesBefore)
    expect(newWrites).toHaveLength(1)
    expect(newWrites[0]).toMatchObject({ table: 'bonus_generations', op: 'delete' })

    // Liberou o reprocessamento: o lote agora reavalia só e2 e recria a geração.
    const again = await generate('bon-a', { referenceMonth: MONTH })
    expect(resultOf(again, 'e1')!.status).toBe('already_generated')
    expect(resultOf(again, 'e2')!.status).toBe('goal_not_met')
    expect(generationsOf('bon-a', MONTH)).toHaveLength(2)
    expect(bonusRecords()).toHaveLength(1)
  })
})

describe('BON-01f: DELETE de geração com financial_record_id', () => {
  it('BON-01f: 409 e nada removido (registro e geração intactos)', async () => {
    await generate('bon-a', { referenceMonth: MONTH })
    const before = snap('employee_financial_records', 'bonus_generations', ...BANK_TABLES)
    const writesBefore = fake.writes.length

    const res = await removeGeneration('bon-a', 'e1', MONTH)
    expect(res.status).toBe(409)
    expect(snap('employee_financial_records', 'bonus_generations', ...BANK_TABLES)).toEqual(before)
    expect(fake.writes.slice(writesBefore)).toEqual([])
    expect(generationsOf('bon-a', MONTH).find(g => g.employee_id === 'e1')!.financial_record_id).toEqual(expect.any(String))
  })
})

describe('BON-20: DELETE de geração quando nada foi gerado', () => {
  it('BON-20: 404 "Nada foi gerado", nada escrito', async () => {
    const res = await removeGeneration('bon-a', 'e1', MONTH)
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toContain('Nada foi gerado')
    expect(fake.writes).toEqual([])
  })
  it('BON-20: gerado em outro mês não conta -> 404 para o mês pedido, geração do outro mês intacta', async () => {
    await generate('bon-a', { referenceMonth: MONTH })
    const before = snap('bonus_generations')
    const res = await removeGeneration('bon-a', 'e2', '2026-09-01')
    expect(res.status).toBe(404)
    expect(snap('bonus_generations')).toEqual(before)
  })
})

describe('BON-05i: generate - isolamento de tenant e permissão', () => {
  it('BON-05i: bônus de B logado em A -> 404 "Bônus não encontrado"; nada criado em B nem em A', async () => {
    const before = snap('employee_financial_records', 'bonus_generations')
    const res = await generate('bon-b', { referenceMonth: MONTH })
    expect(res.status).toBe(404)
    expect(res.error?.statusMessage).toBe('Bônus não encontrado')
    expect(snap('employee_financial_records', 'bonus_generations')).toEqual(before)
    expect(generationsOf('bon-b')).toHaveLength(1)
    expect(bonusRecords()).toHaveLength(0)
    expect(fake.writes).toEqual([])
  })

  it('BON-05i: bônus de B com employeeId de B logado em A -> 404 igualmente', async () => {
    const res = await generate('bon-b', { referenceMonth: MONTH, employeeId: 'e-b1' })
    expect(res.status).toBe(404)
    expect(fake.writes).toEqual([])
  })

  it('BON-05i: emp-sem -> 403 e nada criado', async () => {
    loginAs('emp-sem')
    const res = await generate('bon-a', { referenceMonth: MONTH })
    expect(res.status).toBe(403)
    expect(res.error?.statusMessage).toContain('Acesso negado')
    expect(fake.writes).toEqual([])
    expect(bonusRecords()).toHaveLength(0)
  })

  it('BON-05i: controle - emp-upd (tem bonuses.update) gera normalmente; admin também', async () => {
    loginAs('emp-upd')
    expect((await generate('bon-a', { referenceMonth: MONTH, employeeId: 'e1' })).status).toBe(200)
    loginAs('admin')
    expect((await generate('bon-a', { referenceMonth: MONTH, employeeId: 'e2' })).status).toBe(200)
    expect(bonusRecords()).toHaveLength(1)
  })
})

describe('BON-05j: DELETE de geração - isolamento de tenant e permissão', () => {
  it('BON-05j: geração de B logado em A -> 404; geração de B intacta, nenhuma escrita', async () => {
    const before = structuredClone(generationsOf('bon-b'))
    const res = await removeGeneration('bon-b', 'e-b1', MONTH)
    expect(res.status).toBe(404)
    expect(generationsOf('bon-b')).toEqual(before)
    expect(fake.writes).toEqual([])
  })

  it('BON-05j: emp-sem -> 403 e geração de A intacta', async () => {
    await generate('bon-a', { referenceMonth: MONTH })
    const before = snap('bonus_generations')
    const writesBefore = fake.writes.length
    loginAs('emp-sem')
    const res = await removeGeneration('bon-a', 'e2', MONTH)
    expect(res.status).toBe(403)
    expect(snap('bonus_generations')).toEqual(before)
    expect(fake.writes.slice(writesBefore)).toEqual([])
  })
})

describe('BON-01d: concorrência', () => {
  it.todo('BON-01d: 2 chamadas concorrentes para o mesmo (bônus, funcionário, mês) -> 1 só registro, sem órfão (G1-SD-09). Precisa de banco real: tests/db, PR 11')
})
