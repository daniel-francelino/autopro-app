// L3 (banco real): migrations 101–103 e as consultas que o painel do owner depende de PostgREST/Postgres.
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll, describe, expect, inject, it } from 'vitest'
import { adminDb } from '../helpers/db'
import { createOrg, deleteOrgs } from '../helpers/factories'
import { TEST_ENV } from '../setup/env'
import { claimStripeEvent, finishStripeEvent } from '../../server/utils/stripe-webhook-events'
import { isOrganizationSuspended } from '../../server/utils/organization'
import { computeChurnSeries } from '../../server/utils/billing-metrics'

const available = inject('apiAvailable')
const orgs: string[] = []
const eventIds: string[] = []

afterAll(async () => {
  if (!available) return
  await deleteOrgs(orgs)
  if (eventIds.length) await adminDb().from('stripe_webhook_events').delete().in('id', eventIds)
  await adminDb().from('geo_probe_runs').delete().eq('run_date', '2001-01-01')
})

describe.skipIf(!available)('suspensão de oficina (migration 101)', () => {
  it('o embed `organizations(suspended_at)` que o servidor usa devolve a suspensão', async () => {
    const org = await createOrg()
    orgs.push(org.id)
    const userId = randomUUID()
    const { error: authError } = await adminDb().auth.admin.createUser({ id: userId, email: `${userId.slice(0, 8)}@teste.local`, password: 'Teste-12345', email_confirm: true })
    expect(authError).toBeNull()
    const { error } = await adminDb().from('user_profiles').insert({ user_id: userId, organization_id: org.id, email: `${userId.slice(0, 8)}@teste.local`, is_active: true })
    expect(error).toBeNull()

    const read = () => adminDb().from('user_profiles').select('organization_id, employee_id, is_active, organizations(suspended_at)').eq('user_id', userId).maybeSingle()

    expect(isOrganizationSuspended((await read()).data)).toBe(false)

    await adminDb().from('organizations').update({ suspended_at: new Date().toISOString(), suspended_reason: 'teste', suspended_by: 'owner@x.com' }).eq('id', org.id)
    expect(isOrganizationSuspended((await read()).data)).toBe(true)

    await adminDb().from('organizations').update({ suspended_at: null }).eq('id', org.id)
    expect(isOrganizationSuspended((await read()).data)).toBe(false)

    await adminDb().from('user_profiles').delete().eq('user_id', userId)
    await adminDb().auth.admin.deleteUser(userId)
  })
})

describe.skipIf(!available)('webhook do Stripe: idempotência (migration 102)', () => {
  const evt = () => {
    const id = `evt_test_${randomUUID().slice(0, 12)}`
    eventIds.push(id)
    return { id, type: 'invoice.paid' }
  }

  it('o 1º recebimento processa; a reentrega de evento processado vira duplicata', async () => {
    const e = evt()
    expect(await claimStripeEvent(adminDb(), e, e)).toEqual({ kind: 'process', tracked: true })
    await finishStripeEvent(adminDb(), e.id, { status: 'processed' })
    expect(await claimStripeEvent(adminDb(), e, e)).toEqual({ kind: 'duplicate' })

    const { data } = await adminDb().from('stripe_webhook_events').select('status, processed_at').eq('id', e.id).single()
    expect(data).toMatchObject({ status: 'processed' })
    expect(data!.processed_at).toBeTruthy()
  })

  it('evento que falhou é reprocessado na reentrega do Stripe', async () => {
    const e = evt()
    await claimStripeEvent(adminDb(), e, e)
    await finishStripeEvent(adminDb(), e.id, { status: 'failed', errorMessage: 'boom' })
    expect(await claimStripeEvent(adminDb(), e, e)).toEqual({ kind: 'process', tracked: true })
    const { data } = await adminDb().from('stripe_webhook_events').select('status, error_message').eq('id', e.id).single()
    expect(data).toMatchObject({ status: 'received', error_message: null })
  })

  it('evento ignorado (tipo não tratado) também não é repetido', async () => {
    const e = evt()
    await claimStripeEvent(adminDb(), e, e)
    await finishStripeEvent(adminDb(), e.id, { status: 'ignored' })
    expect(await claimStripeEvent(adminDb(), e, e)).toEqual({ kind: 'duplicate' })
  })

  it('status inválido é rejeitado pelo CHECK', async () => {
    const { error } = await adminDb().from('stripe_webhook_events').insert({ id: `evt_bad_${randomUUID().slice(0, 8)}`, type: 'x', status: 'quase', payload: {} })
    expect(error?.message).toMatch(/check constraint/)
  })
})

describe.skipIf(!available)('bateria GEO (migration 103)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    run_date: '2001-01-01', question_id: 1, question_text: 'q', engine: 'claude', search_enabled: true,
    brand_mentioned: true, brand_linked: false, recommended: false, ...over
  })

  it('a mesma (data, pergunta, motor, busca) é regravada em vez de duplicar', async () => {
    const first = await adminDb().from('geo_probe_runs').upsert(row(), { onConflict: 'run_date,question_id,engine,search_enabled' })
    expect(first.error).toBeNull()
    const second = await adminDb().from('geo_probe_runs').upsert(row({ recommended: true }), { onConflict: 'run_date,question_id,engine,search_enabled' })
    expect(second.error).toBeNull()
    const { data } = await adminDb().from('geo_probe_runs').select('recommended').eq('run_date', '2001-01-01').eq('question_id', 1)
    expect(data).toEqual([{ recommended: true }])
  })

  it('rejeita pergunta fora de 1..20 e motor desconhecido', async () => {
    expect((await adminDb().from('geo_probe_runs').insert(row({ question_id: 21 }))).error?.message).toMatch(/check constraint/)
    expect((await adminDb().from('geo_probe_runs').insert(row({ engine: 'bing' }))).error?.message).toMatch(/check constraint/)
  })
})

describe.skipIf(!available)('tabelas novas não são legíveis por anon/authenticated (só service role)', () => {
  it.each(['stripe_webhook_events', 'geo_probe_runs'])('%s', async (table) => {
    const anon = createClient(TEST_ENV.url, TEST_ENV.anonKey || 'x', { auth: { persistSession: false } })
    const { data, error } = await anon.from(table).select('*').limit(1)
    expect(data ?? []).toHaveLength(0)
    expect(error?.message ?? '').toMatch(/permission denied|JWT|Invalid API key/i)
  })
})

describe.skipIf(!available)('cobrança: churn calculado sobre assinaturas reais do banco', () => {
  it('uma assinatura criada hoje aparece como nova no mês atual', async () => {
    const org = await createOrg()
    orgs.push(org.id)
    const today = new Date().toISOString().slice(0, 10)
    const { error } = await adminDb().from('subscriptions').insert({ organization_id: org.id, user_email: 'a@teste.local', status: 'active', plan_key: 'pro', monthly_amount: 99.9, start_date: today })
    expect(error).toBeNull()
    const { data } = await adminDb().from('subscriptions').select('status, plan_key, monthly_amount, start_date, cancellation_date, created_at').eq('organization_id', org.id)
    const current = computeChurnSeries(data as never, new Date(), 12).at(-1)!
    expect(current.new).toBe(1)
  })
})
