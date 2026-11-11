import { randomUUID } from 'node:crypto'
import { adminDb } from './db'

/** CPF válido gerado por função (nunca dados reais — D7 do plano). */
export function fakeCpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 9))
  const digit = (nums: number[]) => {
    const factor = nums.length + 1
    const sum = nums.reduce((s, n, i) => s + n * (factor - i), 0)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  const d1 = digit(base)
  const d2 = digit([...base, d1])
  return [...base, d1, d2].join('')
}

export async function createOrg(overrides: Record<string, unknown> = {}) {
  const { data, error } = await adminDb()
    .from('organizations')
    .insert({ name: `Oficina ${randomUUID().slice(0, 8)}`, ...overrides })
    .select()
    .single()
  if (error) throw new Error(`createOrg: ${error.message}`)
  return data as { id: string } & Record<string, unknown>
}

export async function createSubscription(organizationId: string, planKey: 'starter' | 'pro' | 'fiscal') {
  const { error } = await adminDb().from('subscriptions').insert({ organization_id: organizationId, user_email: `${randomUUID().slice(0, 8)}@teste.local`, plan_key: planKey, status: 'active' })
  if (error) throw new Error(`createSubscription: ${error.message}`)
}

export async function createBankAccount(organizationId: string, balance = 0) {
  const { data, error } = await adminDb()
    .from('bank_accounts')
    .insert({ organization_id: organizationId, account_name: `Conta ${randomUUID().slice(0, 6)}`, account_type: 'checking', initial_balance: balance, current_balance: balance })
    .select()
    .single()
  if (error) throw new Error(`createBankAccount: ${error.message}`)
  return data as { id: string }
}

export async function createClient(organizationId: string) {
  const { data, error } = await adminDb()
    .from('clients')
    .insert({ organization_id: organizationId, name: `Cliente ${randomUUID().slice(0, 6)}`, person_type: 'pf', tax_id: fakeCpf(), phone: '11999990000' })
    .select()
    .single()
  if (error) throw new Error(`createClient: ${error.message}`)
  return data as { id: string }
}

export async function createServiceOrder(organizationId: string, number: string, overrides: Record<string, unknown> = {}) {
  const clientId = (overrides.client_id as string | undefined) ?? (await createClient(organizationId)).id
  return adminDb()
    .from('service_orders')
    .insert({ organization_id: organizationId, number, client_id: clientId, entry_date: '2026-01-01', status: 'open', ...overrides })
    .select()
    .single()
}

/** Apaga tudo que as factories criam. Chamar no afterAll. */
export async function deleteOrgs(ids: string[]) {
  if (ids.length === 0) return
  await adminDb().from('organizations').delete().in('id', ids)
}
