import { requireOwner } from '../../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireUuidParam } from '../../../../utils/admin-params'

const MODULES = [
  ['clients', 'Clientes'],
  ['vehicles', 'Veículos'],
  ['employees', 'Funcionários'],
  ['products', 'Produtos'],
  ['financial_transactions', 'Lançamentos financeiros'],
  ['purchases', 'Compras'],
  ['service_order_nfse', 'NFS-e']
] as const

/** Primeiro dia do mês (UTC) `back` meses atrás. */
function monthStart(back: number) {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1))
}

/**
 * GET /api/admin/organizations/:id/usage
 * OS por mês (6 meses), quantos registros a oficina tem em cada módulo e a última ação registrada.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = requireUuidParam(event)
  const supabase = getSupabaseAdminClient()

  const since = monthStart(5)
  const [orders, lastAction, ...counts] = await Promise.all([
    supabase.from('service_orders').select('created_at').eq('organization_id', id).is('deleted_at', null).gte('created_at', since.toISOString()).limit(20000),
    supabase.from('audit_logs').select('created_at, action').eq('organization_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ...MODULES.map(([table]) => supabase.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', id).is('deleted_at', null))
  ])

  const perMonth = new Map<string, number>()
  for (let i = 5; i >= 0; i--) perMonth.set(monthStart(i).toISOString().slice(0, 7), 0)
  for (const row of (orders.data ?? []) as Array<{ created_at: string }>) {
    const key = row.created_at.slice(0, 7)
    if (perMonth.has(key)) perMonth.set(key, (perMonth.get(key) ?? 0) + 1)
  }

  return {
    service_orders_by_month: [...perMonth].map(([month, total]) => ({ month, total })),
    modules: MODULES.map(([table, label], i) => ({ table, label, total: counts[i]?.count ?? 0 })),
    last_action: lastAction.data ?? null
  }
})
