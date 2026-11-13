/**
 * Escopo de leitura de papeis (decisao D-1): papel de sistema e GLOBAL (`organization_id IS NULL`).
 * Um chamador enxerga os papeis da propria organizacao + os globais, nunca papeis de outra organizacao,
 * mesmo que tenham `is_system_role = true`. Mesma regra da RLS `roles_select_same_org` e de
 * `changeUserRole` (server/utils/user-role.ts). Como as rotas usam service role, este filtro e o
 * unico isolamento de tenant: nao duplicar a string nas rotas.
 */
export function roleScopeFilter(organizationId: string): string {
  return `organization_id.eq.${organizationId},organization_id.is.null`
}

/** Aplica o escopo a um query builder de `roles` (ou outro com `.or`). */
export function applyRoleScope<Q extends { or: (filters: string) => Q }>(query: Q, organizationId: string): Q {
  return query.or(roleScopeFilter(organizationId))
}
