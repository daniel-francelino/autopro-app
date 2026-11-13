// Histórico da OS: recordOsEvents grava com ator/origem/correlação do servidor e NUNCA lança.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, installNitroGlobals } from '../../support/handler-harness'
import { createFakeSupabase } from '../../support/fake-supabase'
import { recordOsEvents } from '../../../server/utils/os-history/record'

installNitroGlobals()

const REQ = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const policy = { defaultSource: 'os_detail', allowedSources: [] } as const

const input = { organizationId: ORG, serviceOrderId: 'o1', eventType: 'installment.paid', category: 'payment', visibility: 'financial', payload: { amount: 10 }, idempotencyKey: 'k1' } as const

function evt(headers: Record<string, string> = {}) {
  const e = fakeEvent({ headers }) as unknown as { context: unknown }
  e.context = { audit: { requestId: REQ, startedAt: 0, userId: USER, email: 'maria@x.com' } }
  return e as never
}

beforeEach(() => vi.restoreAllMocks())

describe('recordOsEvents', () => {
  it('monta a linha com ator, request_id e origem validada', async () => {
    const fake = createFakeSupabase({ user_profiles: [{ user_id: USER, display_name: 'Maria Silva' }] })
    await recordOsEvents(evt({ 'x-origin': 'os_detail' }), fake.client, [input], policy)
    const [row] = fake.tables.service_order_events as Array<Record<string, unknown>>
    expect(row).toMatchObject({
      organization_id: ORG, service_order_id: 'o1', actor_name: 'Maria Silva', actor_user_id: USER, correlation_id: REQ,
      source_code: 'os_detail', source_trust: 'declared', origin: 'live', idempotency_key: 'k1', visibility: 'financial'
    })
  })

  it('origem forjada/fora do catálogo não é gravada como declarada; sem nome cai no e-mail', async () => {
    const fake = createFakeSupabase()
    await recordOsEvents(evt({ 'x-origin': 'financial_bulk' }), fake.client, [input], policy)
    await recordOsEvents(evt({ 'x-origin': 'bogus' }), fake.client, [{ ...input, idempotencyKey: 'k2' }], policy)
    const rows = fake.tables.service_order_events as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({ source_code: 'os_detail', source_declared: 'financial_bulk', source_trust: 'mismatch', actor_name: 'Usuário' })
    expect(rows[1]).toMatchObject({ source_code: 'os_detail', source_declared: null, source_trust: 'inferred' })
  })

  it('tenta de novo uma vez; se continuar falhando, não lança', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fake = createFakeSupabase()
    fake.failNext('service_order_events', 'boom')
    await expect(recordOsEvents(evt(), fake.client, [input], policy)).resolves.toBeUndefined()
    expect(fake.tables.service_order_events).toHaveLength(1) // 1ª falhou, retry gravou
    expect(err).not.toHaveBeenCalled()

    const throwing = { from: () => { throw new Error('db down') } } as never
    await expect(recordOsEvents(evt(), throwing, [input], policy)).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    expect(JSON.stringify(err.mock.calls[0])).toContain(REQ)
  })

  it('retry: as 2 tentativas enviam as mesmas linhas, com a mesma idempotency_key, onConflict e ignoreDuplicates', async () => {
    const upsert = vi.fn().mockResolvedValueOnce({ error: { message: 'boom' } }).mockResolvedValueOnce({ error: null })
    const client = { from: vi.fn(() => ({ upsert, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) })) } as never
    await recordOsEvents(evt(), client, [input], policy)
    expect(upsert).toHaveBeenCalledTimes(2)
    const opts = { onConflict: 'organization_id,idempotency_key', ignoreDuplicates: true }
    expect(upsert).toHaveBeenNthCalledWith(1, [expect.objectContaining({ idempotency_key: 'k1', organization_id: ORG })], opts)
    expect(upsert).toHaveBeenNthCalledWith(2, [expect.objectContaining({ idempotency_key: 'k1', organization_id: ORG })], opts)
    expect(upsert.mock.calls[1]![0]).toEqual(upsert.mock.calls[0]![0])
  })

  it('sem eventos não grava nada; sem contexto de auditoria gera correlation_id próprio', async () => {
    const fake = createFakeSupabase()
    await recordOsEvents(null, fake.client, [], policy)
    expect(fake.writes).toHaveLength(0)
    await recordOsEvents(null, fake.client, [input], policy)
    const [row] = fake.tables.service_order_events as Array<Record<string, unknown>>
    expect(row!.correlation_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(row!.actor_user_id).toBeNull()
  })
})
