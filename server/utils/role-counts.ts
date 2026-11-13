export type RoleCounts = {
  assigned_users_count: number
  granted_actions_count: number
}

/**
 * Conta usuarios vinculados e permissoes liberadas por papel.
 * - `allowedActionIds`: acoes ja filtradas por plano (mesma regra de GET /api/roles/:id).
 * - `grantedRows`: linhas de role_actions (apenas is_granted=true e ids permitidos entram).
 * - `userRoleIds`: role_id de cada user_profile da organizacao do chamador.
 */
export function computeRoleCounts(
  roleIds: string[],
  allowedActionIds: Set<string>,
  grantedRows: { role_id: string, action_id: string, is_granted: boolean }[],
  userRoleIds: (string | null)[]
): Record<string, RoleCounts> {
  const result: Record<string, RoleCounts> = {}
  for (const id of roleIds)
    result[id] = { assigned_users_count: 0, granted_actions_count: 0 }

  const seen = new Set<string>()
  for (const row of grantedRows) {
    const counts = result[row.role_id]
    const key = `${row.role_id}:${row.action_id}`
    if (!counts || !row.is_granted || !allowedActionIds.has(row.action_id) || seen.has(key)) continue
    seen.add(key)
    counts.granted_actions_count++
  }

  for (const roleId of userRoleIds) {
    const counts = roleId ? result[roleId] : undefined
    if (counts) counts.assigned_users_count++
  }

  return result
}
