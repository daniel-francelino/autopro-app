// Seed compartilhado dos testes de /api/bonuses (tests/fast/bonuses/*). Duas organizações reais (A e B).
// Cada arquivo de teste acrescenta as linhas específicas (registros pagos, gerações etc.).
export type Persona = 'owner' | 'admin' | 'emp-sem' | 'emp-upd'

export const USERS: Record<Persona, { id: string, email: string }> = {
  owner: { id: 'u-owner', email: 'owner@a.com' },
  admin: { id: 'u-admin', email: 'admin@a.com' },
  'emp-sem': { id: 'u-emp', email: 'emp@a.com' },
  // só tem bonuses.update (sem delete, sem read): é o caso "emp-sem bonuses.delete" do BON-06k
  'emp-upd': { id: 'u-empupd', email: 'empupd@a.com' }
}

/** Mês de referência dos cenários de geração. A meta/valor vigentes nele vêm de BONUS_VERSIONS. */
export const MONTH = '2026-10-01'
export const BONUS_DUE_DAY = 15

type Row = Record<string, any>

export function baseSeed(): Record<string, Row[]> {
  return {
    user_profiles: [
      { id: 'p-owner', user_id: 'u-owner', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true, employee_id: null },
      { id: 'p-admin', user_id: 'u-admin', organization_id: 'org-a', role_id: 'r-admin', is_owner: false, is_active: true, employee_id: null },
      { id: 'p-emp', user_id: 'u-emp', organization_id: 'org-a', role_id: 'r-operador', is_owner: false, is_active: true, employee_id: null },
      { id: 'p-empupd', user_id: 'u-empupd', organization_id: 'org-a', role_id: 'r-upd', is_owner: false, is_active: true, employee_id: null }
    ],
    roles: [
      { id: 'r-admin', name: 'admin', is_system_role: true },
      { id: 'r-operador', name: 'operador', is_system_role: false },
      { id: 'r-upd', name: 'so-update', is_system_role: false }
    ],
    // As ações existem de verdade: o 403 é "Acesso negado" (sem grant), não "Permissão não reconhecida".
    actions: [
      { id: 'act-read', code: 'bonuses.read', deleted_at: null },
      { id: 'act-update', code: 'bonuses.update', deleted_at: null },
      { id: 'act-delete', code: 'bonuses.delete', deleted_at: null }
    ],
    role_actions: [
      { role_id: 'r-upd', action_id: 'act-update', is_granted: true }
    ],
    employees: [
      { id: 'e1', organization_id: 'org-a', name: 'Ana (atinge meta)' },
      { id: 'e2', organization_id: 'org-a', name: 'Beto (nao atinge)' },
      { id: 'e3', organization_id: 'org-a', name: 'Caio (nao atribuido)' },
      { id: 'e-b1', organization_id: 'org-b', name: 'Bia (org B)' }
    ],
    bonuses: [
      { id: 'bon-a', organization_id: 'org-a', name: 'Meta A', active: true, due_day: BONUS_DUE_DAY, deleted_at: null },
      { id: 'bon-a2', organization_id: 'org-a', name: 'Meta A2', active: true, due_day: null, deleted_at: null },
      { id: 'bon-b', organization_id: 'org-b', name: 'Meta B', active: true, due_day: null, deleted_at: null }
    ],
    // v-old (jan) e v-future (dez) existem para provar que o mês usa a versão vigente, não a primeira nem a última.
    bonus_value_versions: [
      { id: 'v-old', bonus_id: 'bon-a', commission_base: 'revenue', goal_amount: 9999, bonus_amount: 100, effective_from: '2026-01-01' },
      { id: 'v-new', bonus_id: 'bon-a', commission_base: 'revenue', goal_amount: 3000, bonus_amount: 500.25, effective_from: '2026-06-01' },
      { id: 'v-future', bonus_id: 'bon-a', commission_base: 'revenue', goal_amount: 1, bonus_amount: 777, effective_from: '2026-12-01' },
      { id: 'v-b', bonus_id: 'bon-b', commission_base: 'revenue', goal_amount: 100, bonus_amount: 900, effective_from: '2026-01-01' }
    ],
    bonus_employee_assignments: [
      { id: 'as-1', bonus_id: 'bon-a', employee_id: 'e1', active: true, deleted_at: null },
      { id: 'as-2', bonus_id: 'bon-a', employee_id: 'e2', active: true, deleted_at: null },
      { id: 'as-b', bonus_id: 'bon-b', employee_id: 'e-b1', active: true, deleted_at: null }
    ],
    // e1 fatura 5000 (>= 3000) em outubro e novembro; e2 fatura 1000 (< 3000). B também atingiria a meta dele.
    service_orders: [
      { id: 'so-1', organization_id: 'org-a', status: 'completed', employee_responsible_id: 'e1', entry_date: '2026-10-10', total_amount: 5000, total_cost_amount: 0, items: [], deleted_at: null },
      { id: 'so-2', organization_id: 'org-a', status: 'completed', employee_responsible_id: 'e2', entry_date: '2026-10-12', total_amount: 1000, total_cost_amount: 0, items: [], deleted_at: null },
      { id: 'so-3', organization_id: 'org-a', status: 'completed', employee_responsible_id: 'e1', entry_date: '2026-11-20', total_amount: 5000, total_cost_amount: 0, items: [], deleted_at: null },
      { id: 'so-b', organization_id: 'org-b', status: 'completed', employee_responsible_id: 'e-b1', entry_date: '2026-10-10', total_amount: 5000, total_cost_amount: 0, items: [], deleted_at: null }
    ],
    employee_financial_records: [],
    bonus_generations: [],
    bank_accounts: [],
    bank_account_statements: [],
    financial_transactions: []
  }
}
