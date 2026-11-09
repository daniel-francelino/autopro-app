import { requireOwner } from '../../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireUuidParam } from '../../../../utils/admin-params'

const DAY_MS = 86_400_000

/**
 * GET /api/admin/organizations/:id/users
 * Usuários da oficina com papel, status e último acesso (última requisição registrada no log de auditoria, 31 dias).
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = requireUuidParam(event)
  const supabase = getSupabaseAdminClient()

  const { data: users, error } = await supabase
    .from('user_profiles')
    .select('id, user_id, display_name, email, is_active, role_id, created_at')
    .eq('organization_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) throw createError({ statusCode: 500, statusMessage: 'Erro ao listar usuários' })

  const rows = (users ?? []) as Array<Record<string, unknown>>
  const roleIds = [...new Set(rows.map(u => u.role_id).filter((v): v is string => typeof v === 'string'))]
  const roleNames = new Map<string, string>()
  if (roleIds.length) {
    const { data: roles } = await supabase.from('roles').select('id, display_name, name').in('id', roleIds)
    for (const r of roles ?? []) roleNames.set(r.id as string, (r.display_name || r.name) as string)
  }

  // Último acesso: a tabela de auditoria pode não existir (migration 097) — sem ela o campo fica nulo.
  const lastSeen = new Map<string, string>()
  const { data: logs } = await supabase
    .from('audit_logs')
    .select('actor_user_id, created_at')
    .eq('organization_id', id)
    .gte('created_at', new Date(Date.now() - 31 * DAY_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(2000)
  for (const log of (logs ?? []) as Array<{ actor_user_id: string | null, created_at: string }>) {
    if (log.actor_user_id && !lastSeen.has(log.actor_user_id)) lastSeen.set(log.actor_user_id, log.created_at)
  }

  return {
    data: rows.map(u => ({
      ...u,
      role_name: typeof u.role_id === 'string' ? roleNames.get(u.role_id) ?? null : null,
      last_seen_at: typeof u.user_id === 'string' ? lastSeen.get(u.user_id) ?? null : null
    }))
  }
})
