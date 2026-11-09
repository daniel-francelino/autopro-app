// L3 (banco) — roda só com Supabase local no ar ("supabase start" + migrations aplicadas).
// Sem Supabase local o arquivo é PULADO com o motivo. NÃO foi executado ao ser escrito
// (Docker indisponível): ver docs/testing/known-failures.md, KF-00.
import { afterAll, describe, expect, inject, it } from 'vitest'
import { adminDb } from '../helpers/db'
import { createBankAccount, createOrg, createServiceOrder, createSubscription, deleteOrgs } from '../helpers/factories'

const available = inject('apiAvailable')
const created: string[] = []

afterAll(async () => {
  if (available) await deleteOrgs(created)
})

describe.skipIf(!available)('banco: migrations e regras de integridade', () => {
  it('as tabelas centrais existem (migrations sobem em banco limpo — R8)', async () => {
    const tables = ['organizations', 'user_profiles', 'roles', 'actions', 'role_actions', 'service_orders', 'service_order_installments',
      'financial_transactions', 'bank_accounts', 'bank_account_statements', 'employees', 'subscriptions']
    for (const table of tables) {
      const { error } = await adminDb().from(table).select('*', { head: true, count: 'exact' })
      expect(error, `${table}: ${error?.message}`).toBeNull()
    }
  })

  it('número de OS: RPC devolve OS<n+1> e respeita o piso da organização', async () => {
    const org = await createOrg({ initial_service_order_number: 4000 })
    created.push(org.id)
    const first = await adminDb().rpc('next_service_order_number', { p_organization_id: org.id })
    expect(first.data).toBe('OS4000')
    await createServiceOrder(org.id, 'OS4000')
    const second = await adminDb().rpc('next_service_order_number', { p_organization_id: org.id })
    expect(second.data).toBe('OS4001')
  })

  it('duas OS com o mesmo número na mesma organização são rejeitadas; em organizações diferentes, aceitas', async () => {
    const [a, b] = [await createOrg(), await createOrg()]
    created.push(a.id, b.id)
    expect((await createServiceOrder(a.id, 'OS1')).error).toBeNull()
    expect((await createServiceOrder(a.id, 'OS1')).error).not.toBeNull()
    expect((await createServiceOrder(b.id, 'OS1')).error).toBeNull()
  })

  it('número de parcela pode ser reaproveitado após soft delete (índice parcial)', async () => {
    const org = await createOrg()
    created.push(org.id)
    const { data: so } = await createServiceOrder(org.id, 'OS1')
    const row = (n: number) => ({
      organization_id: org.id, service_order_id: so!.id, installment_number: n, kind: 'installment', amount: 10, due_date: '2026-01-01', status: 'pending'
    })
    const first = await adminDb().from('service_order_installments').insert(row(1)).select().single()
    expect(first.error).toBeNull()
    expect((await adminDb().from('service_order_installments').insert(row(1))).error).not.toBeNull()
    await adminDb().from('service_order_installments').update({ deleted_at: new Date().toISOString() }).eq('id', first.data!.id)
    expect((await adminDb().from('service_order_installments').insert(row(1))).error).toBeNull()
  })

  it('assinatura ativa por organização é única', async () => {
    const org = await createOrg()
    created.push(org.id)
    await createSubscription(org.id, 'starter')
    const second = await adminDb().from('subscriptions').insert({ organization_id: org.id, plan_key: 'pro', status: 'active' })
    expect(second.error).not.toBeNull()
  })

  it('saldo inicial da conta é preservado', async () => {
    const org = await createOrg()
    created.push(org.id)
    const acc = await createBankAccount(org.id, 250)
    const { data } = await adminDb().from('bank_accounts').select('current_balance').eq('id', acc.id).single()
    expect(Number(data!.current_balance)).toBe(250)
  })
})

describe.skipIf(available)('banco (api) indisponível', () => {
  it.skip(`PULADO: ${inject('apiSkipReason')}`, () => {})
})
