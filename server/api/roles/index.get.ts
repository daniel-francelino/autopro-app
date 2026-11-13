import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { filterActionsByPlan, resolveOrgLicense } from '../../utils/license'
import { computeRoleCounts } from '../../utils/role-counts'

const PAGE_SIZE = 1000

// PostgREST limita linhas por requisicao; pagina para nao truncar contagens.
async function fetchAllPages<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null, error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await run(from, from + PAGE_SIZE - 1)
    if (error)
      throw createError({ statusCode: 500, statusMessage: error.message })
    rows.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGE_SIZE) return rows
  }
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  // Include both org-specific roles and system roles
  const { data: items, error } = await supabase
    .from('roles')
    .select('*')
    .or(`organization_id.eq.${organizationId},is_system_role.eq.true`)
    .is('deleted_at', null)
    .order('display_name', { ascending: true })

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  const roleIds = (items ?? []).map(role => role.id as string)
  if (!roleIds.length) return { items }

  // Campos ADITIVOS: assigned_users_count e granted_actions_count.
  // Usuarios: somente da organizacao do chamador. Permissoes: filtradas por plano (igual a GET /api/roles/:id).
  const [{ planKey }, actions, grantedRows, userRows] = await Promise.all([
    resolveOrgLicense(organizationId),
    fetchAllPages<{ id: string, resource: string | null }>((from, to) =>
      supabase.from('actions').select('id, resource').order('id').range(from, to)
    ),
    fetchAllPages<{ role_id: string, action_id: string, is_granted: boolean }>((from, to) =>
      supabase
        .from('role_actions')
        .select('role_id, action_id, is_granted')
        .in('role_id', roleIds)
        .eq('is_granted', true)
        .order('id')
        .range(from, to)
    ),
    fetchAllPages<{ role_id: string | null }>((from, to) =>
      supabase
        .from('user_profiles')
        .select('role_id')
        .eq('organization_id', organizationId)
        .in('role_id', roleIds)
        .order('id')
        .range(from, to)
    )
  ])

  const allowedActionIds = new Set(
    filterActionsByPlan(actions, planKey).map(action => action.id)
  )
  const counts = computeRoleCounts(
    roleIds,
    allowedActionIds,
    grantedRows,
    userRows.map(row => row.role_id)
  )

  return {
    items: (items ?? []).map(role => ({ ...role, ...counts[role.id as string] }))
  }
})
