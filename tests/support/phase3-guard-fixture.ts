// Seed compartilhado dos testes de guarda da Fase 3 (docs/engineering/access-control-rollout-plan.md).
// Quatro pessoas na org A: owner, admin (role de sistema), sem (role sem concessão) e com (role com os códigos concedidos).
export type Persona = 'owner' | 'admin' | 'sem' | 'com'

export const USERS: Record<Persona, { id: string, email: string }> = {
  owner: { id: 'u-owner', email: 'owner@a.com' },
  admin: { id: 'u-admin', email: 'admin@a.com' },
  sem: { id: 'u-sem', email: 'sem@a.com' },
  com: { id: 'u-com', email: 'com@a.com' }
}

type Row = Record<string, any>

/** `codes`: códigos que existem no catálogo; a role `r-com` recebe todos. A role `r-sem` não recebe nenhum. */
export function guardSeed(codes: string[], extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    user_profiles: [
      { id: 'p-owner', user_id: 'u-owner', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true, employee_id: null },
      { id: 'p-admin', user_id: 'u-admin', organization_id: 'org-a', role_id: 'r-admin', is_owner: false, is_active: true, employee_id: null },
      { id: 'p-sem', user_id: 'u-sem', organization_id: 'org-a', role_id: 'r-sem', is_owner: false, is_active: true, employee_id: null },
      { id: 'p-com', user_id: 'u-com', organization_id: 'org-a', role_id: 'r-com', is_owner: false, is_active: true, employee_id: null },
      ...(extra.user_profiles ?? [])
    ],
    roles: [
      { id: 'r-admin', name: 'admin', is_system_role: true, organization_id: null },
      { id: 'r-sem', name: 'operador', is_system_role: false, organization_id: 'org-a' },
      { id: 'r-com', name: 'com-permissao', is_system_role: false, organization_id: 'org-a' },
      ...(extra.roles ?? [])
    ],
    actions: codes.map((code, i) => ({ id: `act-${i}`, code, deleted_at: null })),
    role_actions: codes.map((_, i) => ({ role_id: 'r-com', action_id: `act-${i}`, is_granted: true })),
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => !['user_profiles', 'roles'].includes(k)))
  }
}
