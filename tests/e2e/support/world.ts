// "Mundo" de teste: organizações, usuários e papéis criados no Supabase LOCAL antes dos specs logados
// e apagados no fim. Nada aqui toca outro banco: o chamador já verificou `authSkipReason()`.
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { E2E, PASSWORD, isLocalUrl } from './env'

export type UserKind = 'admin' | 'staff' | 'otherOrg' | 'platformOwner' | 'noOrg' | 'pendingOnboarding'

export interface TestUser {
  kind: UserKind
  id: string
  email: string
  password: string
  displayName: string
  organizationId: string | null
}

export interface World {
  db: SupabaseClient
  orgA: string
  orgB: string
  orgPending: string
  users: Record<UserKind, TestUser>
  cleanup: () => Promise<void>
}

const DEFAULT_CATEGORIES = [
  { name: 'Vendas', type: 'income' }, { name: 'Serviços', type: 'income' }, { name: 'Outros', type: 'income' },
  { name: 'Aluguel', type: 'expense' }, { name: 'Salários', type: 'expense' }, { name: 'Fornecedores', type: 'expense' },
  { name: 'Impostos', type: 'expense' }, { name: 'Marketing', type: 'expense' }, { name: 'Outros', type: 'expense' }
]

function must<T>(result: { data: T | null, error: { message: string } | null }, what: string): T {
  if (result.error || result.data === null) throw new Error(`[e2e seed] ${what}: ${result.error?.message ?? 'sem dados'}`)
  return result.data
}

export async function createWorld(): Promise<World> {
  if (!isLocalUrl(E2E.url)) throw new Error('[e2e seed] só roda contra Supabase local')
  const db = createClient(E2E.url, E2E.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const run = randomUUID().slice(0, 8)

  async function org(label: string, onboardingCompleted: boolean, plan: 'pro' | null) {
    const created = must(await db.from('organizations').insert({ name: `E2E ${label} ${run}`, onboarding_completed: onboardingCompleted }).select('id').single(), `organização ${label}`)
    if (plan) {
      must(await db.from('subscriptions').insert({ organization_id: created.id, user_email: `owner-${label}-${run}@e2e.local`, plan_key: plan, status: 'active' }).select('id').single(), `assinatura ${label}`)
      must(await db.from('financial_categories').insert(DEFAULT_CATEGORIES.map(c => ({ ...c, organization_id: created.id, icon: 'i-lucide-circle', color: '#64748b', is_default: true, created_by: 'e2e' }))).select('id'), `categorias ${label}`)
    }
    return created.id as string
  }

  async function role(organizationId: string, name: string, system: boolean) {
    return must(await db.from('roles').insert({ organization_id: organizationId, name, display_name: name, is_system_role: system }).select('id').single(), `papel ${name}`).id as string
  }

  async function user(kind: UserKind, organizationId: string | null, roleId: string | null, isOwner = false): Promise<TestUser> {
    const email = `${kind}-${run}@e2e.local`
    const displayName = `E2E ${kind} ${run}`
    const created = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { name: displayName } })
    if (created.error || !created.data.user) throw new Error(`[e2e seed] usuário ${kind}: ${created.error?.message}`)
    const id = created.data.user.id
    must(await db.from('user_profiles').insert({ user_id: id, organization_id: organizationId, role_id: roleId, is_owner: isOwner, display_name: displayName, is_active: true }).select('id').single(), `perfil ${kind}`)
    return { kind, id, email, password: PASSWORD, displayName, organizationId }
  }

  const orgA = await org('A', true, 'pro')
  const orgB = await org('B', true, 'pro')
  const orgPending = await org('Pendente', false, null)

  const users = {
    admin: await user('admin', orgA, await role(orgA, 'admin', true)),
    staff: await user('staff', orgA, await role(orgA, 'operador', false)),
    otherOrg: await user('otherOrg', orgB, await role(orgB, 'admin', true)),
    platformOwner: await user('platformOwner', null, null, true),
    noOrg: await user('noOrg', null, null),
    pendingOnboarding: await user('pendingOnboarding', orgPending, await role(orgPending, 'admin', true))
  } satisfies Record<UserKind, TestUser>

  async function cleanup() {
    for (const u of Object.values(users)) {
      await db.from('user_profiles').delete().eq('user_id', u.id)
      await db.auth.admin.deleteUser(u.id)
    }
    // ON DELETE CASCADE leva papéis, contas, OS, lançamentos etc.
    await db.from('organizations').delete().in('id', [orgA, orgB, orgPending])
  }

  return { db, orgA, orgB, orgPending, users, cleanup }
}
