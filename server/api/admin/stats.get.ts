import { defineEventHandler } from 'h3'
import { requireOwner } from '../../utils/require-owner'
import { getSupabaseAdminClient } from '../../utils/supabase'

const DAY_MS = 86_400_000

/**
 * GET /api/admin/stats
 * Global system stats for the admin dashboard.
 * Restricted to users with is_owner = true.
 * Só contagens (`head: true`): nada de baixar todas as linhas para contar em JS.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const supabase = getSupabaseAdminClient()
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString()
  const count = { count: 'exact', head: true } as const

  const [orgs, users, subscriptions, activeSubscriptions, serviceOrders, recentOrgs] = await Promise.all([
    supabase.from('organizations').select('id', count).is('deleted_at', null),
    supabase.from('user_profiles').select('id', count).is('deleted_at', null),
    supabase.from('subscriptions').select('id', count),
    // O CHECK de `subscriptions.status` só aceita active/cancelled/suspended/trial ("trialing" nunca existiu).
    supabase.from('subscriptions').select('id', count).in('status', ['active', 'trial']),
    supabase.from('service_orders').select('id', count).is('deleted_at', null),
    supabase.from('organizations').select('id', count).is('deleted_at', null).gte('created_at', since)
  ])

  return {
    total_organizations: orgs.count ?? 0,
    total_users: users.count ?? 0,
    total_subscriptions: subscriptions.count ?? 0,
    active_subscriptions: activeSubscriptions.count ?? 0,
    total_service_orders: serviceOrders.count ?? 0,
    new_organizations_last_30_days: recentOrgs.count ?? 0
  }
})
