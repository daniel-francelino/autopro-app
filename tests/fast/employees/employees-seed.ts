// Seed de grupo dos testes de /api/employees (tests/fast/employees/*). Duas organizações reais (A e B).
// Fica ao lado dos testes (não em tests/support/): só estes cinco arquivos usam. Cada teste acrescenta o que for específico.
// Cenários: docs/testing/endpoint-scenarios-g1.md, seção 4 (EMP-xx).
export type Persona = 'owner' | 'emp-sem' | 'emp-com'

export const USERS: Record<Persona, { id: string, email: string }> = {
  owner: { id: 'u-owner', email: 'owner@a.com' },
  'emp-sem': { id: 'u-emp', email: 'emp@a.com' },
  // tem commissions.read e bonuses.read concedidos (controle positivo das leituras com permissão)
  'emp-com': { id: 'u-empcom', email: 'empcom@a.com' }
}

export const DELETED_AT = '2026-01-01T00:00:00.000Z'
export const SEED_NOW = '2026-06-15T12:00:00'

type Row = Record<string, any>

export function emp(id: string, org: string, extra: Row = {}): Row {
  return {
    id, organization_id: org, name: id, person_type: 'pf', tax_id: `tax-${id}`, phone: '11999990000', email: null, role: 'Mecânico',
    has_salary: false, termination_date: null, termination_reason: null,
    created_at: '2026-01-01T10:00:00.000Z', created_by: 'x@a.com', updated_by: 'x@a.com', deleted_at: null, deleted_by: null, ...extra
  }
}

export function employeesSeed(): Record<string, Row[]> {
  return {
    user_profiles: [
      { id: 'p-owner', user_id: 'u-owner', organization_id: 'org-a', role_id: null, is_owner: true, is_active: true, employee_id: null, email: 'owner@a.com' },
      { id: 'p-emp', user_id: 'u-emp', organization_id: 'org-a', role_id: 'r-operador', is_owner: false, is_active: true, employee_id: null, email: 'emp@a.com' },
      { id: 'p-empcom', user_id: 'u-empcom', organization_id: 'org-a', role_id: 'r-com', is_owner: false, is_active: true, employee_id: null, email: 'empcom@a.com' },
      // funcionário vinculado de A e de B (com usuário de acesso já concedido)
      { id: 'p-edu', user_id: 'u-edu', organization_id: 'org-a', role_id: 'r-employee', is_owner: false, is_active: true, employee_id: 'e-a-link', email: 'edu@a.com', display_name: 'Edu Vinculado' },
      { id: 'p-beto', user_id: 'u-beto', organization_id: 'org-b', role_id: 'r-employee-b', is_owner: false, is_active: true, employee_id: 'e-b-link', email: 'beto@b.com', display_name: 'Beto Vinculado B' }
    ],
    roles: [
      { id: 'r-operador', name: 'operador', is_system_role: false, organization_id: 'org-a' },
      { id: 'r-com', name: 'com-permissao', is_system_role: false, organization_id: 'org-a' },
      { id: 'r-employee', name: 'employee', is_system_role: true, organization_id: 'org-a' },
      { id: 'r-employee-b', name: 'employee', is_system_role: true, organization_id: 'org-b' },
      { id: 'r-admin-b', name: 'admin', is_system_role: true, organization_id: 'org-b' }
    ],
    // As ações existem de verdade: o 403 é "Acesso negado" (sem grant), não "Permissão não reconhecida".
    actions: [
      { id: 'act-comm-read', code: 'commissions.read', deleted_at: null },
      { id: 'act-bon-read', code: 'bonuses.read', deleted_at: null }
    ],
    role_actions: [
      { role_id: 'r-com', action_id: 'act-comm-read', is_granted: true },
      { role_id: 'r-com', action_id: 'act-bon-read', is_granted: true }
    ],
    // Org A em plano pro (limite 10); B sem assinatura não é usada em escrita.
    subscriptions: [
      { id: 'sub-a', organization_id: 'org-a', plan_key: 'pro', status: 'active', deleted_at: null }
    ],
    employees: [
      emp('e-a1', 'org-a', { name: 'Ana Ativa', email: 'ana@a.com', tax_id: '111' }),
      emp('e-a-term', 'org-a', { name: 'Bruno Desligado', termination_date: '2025-01-01' }),
      emp('e-a-fut', 'org-a', { name: 'Carla Futura', termination_date: '2099-01-01' }),
      emp('e-a-del', 'org-a', { name: 'Dora Deletada', email: 'dora@a.com', deleted_at: DELETED_AT, deleted_by: 'x@a.com' }),
      emp('e-a-link', 'org-a', { name: 'Edu Vinculado', email: 'edu@a.com' }),
      emp('e-a-noemail', 'org-a', { name: 'Fabio Sem Email', email: null }),
      emp('e-a-blank', 'org-a', { name: 'Gil Email Vazio', email: '   ' }),
      emp('e-a-case', 'org-a', { name: 'Hugo Caso', email: '  Caso@A.COM ' }),
      emp('e-b1', 'org-b', { name: 'Bia Org B', email: 'bia@b.com' }),
      emp('e-b-link', 'org-b', { name: 'Beto Vinculado B', email: 'beto@b.com' })
    ],
    user_preferences: [],
    notification_preferences: [],
    organizations: [{ id: 'org-a', name: 'Oficina A' }, { id: 'org-b', name: 'Oficina B' }],
    clients: [
      { id: 'c-a1', organization_id: 'org-a', name: 'Cliente Alfa', deleted_at: null },
      { id: 'c-b1', organization_id: 'org-b', name: 'Cliente B', deleted_at: null }
    ],
    // Ordens: 3 vivas de A (mar, mar, mai), 1 excluída (KF-32), 1 de outubro (bônus) e 1 de B.
    service_orders: [
      { id: 'so-1', organization_id: 'org-a', number: 101, status: 'completed', payment_status: 'paid', entry_date: '2026-03-10', client_id: 'c-a1', employee_responsible_id: 'e-a1', responsible_employees: [], total_amount: 400, total_cost_amount: 100, items: [], deleted_at: null },
      { id: 'so-2', organization_id: 'org-a', number: 102, status: 'completed', payment_status: 'pending', entry_date: '2026-03-20', client_id: 'c-a1', employee_responsible_id: 'e-a1', responsible_employees: [], total_amount: 300, total_cost_amount: 0, items: [], deleted_at: null },
      { id: 'so-3', organization_id: 'org-a', number: 103, status: 'completed', payment_status: 'pending', entry_date: '2026-05-01', client_id: 'c-a1', employee_responsible_id: 'e-a1', responsible_employees: [], total_amount: 200, total_cost_amount: 0, items: [], deleted_at: null },
      { id: 'so-del', organization_id: 'org-a', number: 104, status: 'completed', payment_status: 'pending', entry_date: '2026-03-12', client_id: 'c-a1', employee_responsible_id: 'e-a1', responsible_employees: [], total_amount: 500, total_cost_amount: 0, items: [], deleted_at: DELETED_AT },
      { id: 'so-oct', organization_id: 'org-a', number: 110, status: 'completed', payment_status: 'paid', entry_date: '2026-10-10', client_id: 'c-a1', employee_responsible_id: 'e-a1', responsible_employees: [], total_amount: 5000, total_cost_amount: 0, items: [], deleted_at: null },
      { id: 'so-b', organization_id: 'org-b', number: 201, status: 'completed', payment_status: 'paid', entry_date: '2026-03-10', client_id: 'c-b1', employee_responsible_id: 'e-b1', responsible_employees: [], total_amount: 900, total_cost_amount: 0, items: [], deleted_at: null }
    ],
    // e-a1 em março: 100 pago + 50,5 pendente = 150,5 (fr-3 é de maio, fr-4 é bônus). Os de e-a-term e de B nunca entram.
    employee_financial_records: [
      { id: 'fr-1', organization_id: 'org-a', employee_id: 'e-a1', service_order_id: 'so-1', record_type: 'commission', status: 'paid', amount: 100, reference_date: '2026-03-10', payment_date: '2026-03-15', description: 'OS 101 - Troca de óleo', item_name: 'Troca de óleo', item_amount: 400, item_cost: 100, commission_type: 'percentage', commission_percentage: 25, commission_base: 'revenue', deleted_at: null },
      { id: 'fr-2', organization_id: 'org-a', employee_id: 'e-a1', service_order_id: 'so-2', record_type: 'commission', status: 'pending', amount: 50.5, reference_date: '2026-03-20', payment_date: null, description: 'OS 102 - Alinhamento', item_name: 'Alinhamento', item_amount: 300, item_cost: 0, commission_type: 'percentage', commission_percentage: 16.83, commission_base: 'revenue', deleted_at: null },
      { id: 'fr-3', organization_id: 'org-a', employee_id: 'e-a1', service_order_id: 'so-3', record_type: 'commission', status: 'pending', amount: 30, reference_date: '2026-05-01', payment_date: null, description: 'OS 103 - Balanceamento', item_name: 'Balanceamento', item_amount: 200, item_cost: 0, commission_type: 'percentage', commission_percentage: 15, commission_base: 'revenue', deleted_at: null },
      { id: 'fr-4', organization_id: 'org-a', employee_id: 'e-a1', service_order_id: null, record_type: 'bonus', status: 'paid', amount: 200, reference_date: '2026-03-15', payment_date: '2026-03-16', description: 'Bônus Meta', deleted_at: null },
      { id: 'fr-5', organization_id: 'org-a', employee_id: 'e-a-term', service_order_id: 'so-1', record_type: 'commission', status: 'pending', amount: 999, reference_date: '2026-03-10', payment_date: null, description: 'OS 101 - outro funcionario', item_name: 'Outro', item_amount: 400, item_cost: 0, deleted_at: null },
      { id: 'fr-b', organization_id: 'org-b', employee_id: 'e-b1', service_order_id: 'so-b', record_type: 'commission', status: 'pending', amount: 777, reference_date: '2026-03-10', payment_date: null, description: 'OS 201 - B', item_name: 'Item B', item_amount: 900, item_cost: 0, deleted_at: null }
    ],
    product_categories: [{ id: 'cat-1', organization_id: 'org-a', name: 'Mecânica' }],
    // Planos: pl-a1 (vivo, e-a1), pl-a2 (excluído, e-a1), pl-a-other/pl-a3 (e-a-fut; pl-a3 inativo), pl-b (de B, atribuído a e-b1 e, cruzado, a e-a1).
    employee_commission_plans: [
      { id: 'pl-a1', organization_id: 'org-a', name: 'Plano Mecânico', description: null, active: true, deleted_at: null },
      { id: 'pl-a2', organization_id: 'org-a', name: 'Plano Excluído', description: null, active: true, deleted_at: DELETED_AT },
      { id: 'pl-a-other', organization_id: 'org-a', name: 'Plano Outro', description: null, active: true, deleted_at: null },
      { id: 'pl-a3', organization_id: 'org-a', name: 'Plano Inativo', description: null, active: false, deleted_at: null },
      { id: 'pl-b', organization_id: 'org-b', name: 'Plano B', description: null, active: true, deleted_at: null }
    ],
    employee_commission_plan_assignments: [
      { id: 'cas-1', plan_id: 'pl-a1', employee_id: 'e-a1', active: true, deleted_at: null },
      { id: 'cas-2', plan_id: 'pl-a2', employee_id: 'e-a1', active: true, deleted_at: null },
      { id: 'cas-3', plan_id: 'pl-a-other', employee_id: 'e-a-fut', active: true, deleted_at: null },
      { id: 'cas-4', plan_id: 'pl-a3', employee_id: 'e-a-fut', active: true, deleted_at: null },
      // atribuição removida (inativa e com deleted_at) de e-a1 ao plano de outro funcionário
      { id: 'cas-5', plan_id: 'pl-a-other', employee_id: 'e-a1', active: false, deleted_at: DELETED_AT },
      // atribuição cruzada: e-a1 apontando para plano de B (a org do plano é filtrada)
      { id: 'cas-6', plan_id: 'pl-b', employee_id: 'e-a1', active: true, deleted_at: null },
      { id: 'cas-b', plan_id: 'pl-b', employee_id: 'e-b1', active: true, deleted_at: null }
    ],
    employee_commission_rule_versions: [
      { id: 'cv-a1-old', plan_id: 'pl-a1', effective_from: '2026-01-01' },
      { id: 'cv-a1-new', plan_id: 'pl-a1', effective_from: '2026-05-01' },
      { id: 'cv-a2', plan_id: 'pl-a2', effective_from: '2026-01-01' },
      { id: 'cv-other', plan_id: 'pl-a-other', effective_from: '2026-01-01' },
      { id: 'cv-a3', plan_id: 'pl-a3', effective_from: '2026-01-01' },
      { id: 'cv-b', plan_id: 'pl-b', effective_from: '2026-01-01' }
    ],
    employee_commission_rules: [
      { id: 'ru-old', version_id: 'cv-a1-old', name: 'Regra antiga', commission_type: 'percentage', commission_amount: 5, commission_base: 'revenue', is_default: true, sort_order: 0 },
      { id: 'ru-new', version_id: 'cv-a1-new', name: 'Regra nova', commission_type: 'percentage', commission_amount: 10, commission_base: 'profit', is_default: false, sort_order: 0 },
      { id: 'ru-new-def', version_id: 'cv-a1-new', name: 'Padrão', commission_type: 'fixed_amount', commission_amount: 20, commission_base: null, is_default: true, sort_order: 1 },
      { id: 'ru-a2', version_id: 'cv-a2', name: 'Regra do excluído', commission_type: 'percentage', commission_amount: 99, commission_base: 'revenue', is_default: true, sort_order: 0 },
      { id: 'ru-other', version_id: 'cv-other', name: 'Regra outro', commission_type: 'percentage', commission_amount: 7, commission_base: 'revenue', is_default: true, sort_order: 0 },
      { id: 'ru-a3', version_id: 'cv-a3', name: 'Regra do inativo', commission_type: 'percentage', commission_amount: 8, commission_base: 'revenue', is_default: true, sort_order: 0 },
      { id: 'ru-b', version_id: 'cv-b', name: 'Regra B', commission_type: 'percentage', commission_amount: 50, commission_base: 'revenue', is_default: true, sort_order: 0 }
    ],
    employee_commission_rule_categories: [{ rule_id: 'ru-new', category_id: 'cat-1' }],
    // Bônus de e-a1: bo-live (com geração em out/2026), bo-nogen (sem geração, meta não batida),
    // bo-removed (atribuição removida), bo-deleted (bônus excluído), bo-inactive (bônus inativo), bo-b (de B, atribuído também a e-a1 por engano).
    bonuses: [
      { id: 'bo-live', organization_id: 'org-a', name: 'Meta Live', active: true, deleted_at: null },
      { id: 'bo-nogen', organization_id: 'org-a', name: 'Meta Sem Geração', active: true, deleted_at: null },
      { id: 'bo-removed', organization_id: 'org-a', name: 'Meta Removida', active: true, deleted_at: null },
      { id: 'bo-deleted', organization_id: 'org-a', name: 'Meta Excluída', active: true, deleted_at: DELETED_AT },
      { id: 'bo-inactive', organization_id: 'org-a', name: 'Meta Inativa', active: false, deleted_at: null },
      { id: 'bo-b', organization_id: 'org-b', name: 'Meta B', active: true, deleted_at: null }
    ],
    bonus_value_versions: [
      { id: 'bv-live', bonus_id: 'bo-live', commission_base: 'revenue', goal_amount: 3000, bonus_amount: 500, effective_from: '2026-01-01' },
      { id: 'bv-nogen', bonus_id: 'bo-nogen', commission_base: 'revenue', goal_amount: 6000, bonus_amount: 300, effective_from: '2026-01-01' },
      { id: 'bv-removed', bonus_id: 'bo-removed', commission_base: 'revenue', goal_amount: 1, bonus_amount: 1, effective_from: '2026-01-01' },
      { id: 'bv-deleted', bonus_id: 'bo-deleted', commission_base: 'revenue', goal_amount: 1, bonus_amount: 1, effective_from: '2026-01-01' },
      { id: 'bv-inactive', bonus_id: 'bo-inactive', commission_base: 'revenue', goal_amount: 1, bonus_amount: 1, effective_from: '2026-01-01' },
      { id: 'bv-b', bonus_id: 'bo-b', commission_base: 'revenue', goal_amount: 100, bonus_amount: 900, effective_from: '2026-01-01' }
    ],
    bonus_employee_assignments: [
      { id: 'ba-1', bonus_id: 'bo-live', employee_id: 'e-a1', active: true, deleted_at: null },
      { id: 'ba-2', bonus_id: 'bo-nogen', employee_id: 'e-a1', active: true, deleted_at: null },
      { id: 'ba-3', bonus_id: 'bo-removed', employee_id: 'e-a1', active: false, deleted_at: DELETED_AT },
      { id: 'ba-4', bonus_id: 'bo-deleted', employee_id: 'e-a1', active: true, deleted_at: null },
      { id: 'ba-5', bonus_id: 'bo-inactive', employee_id: 'e-a1', active: true, deleted_at: null },
      { id: 'ba-6', bonus_id: 'bo-b', employee_id: 'e-a1', active: true, deleted_at: null },
      { id: 'ba-b', bonus_id: 'bo-b', employee_id: 'e-b1', active: true, deleted_at: null }
    ],
    bonus_generations: [
      { id: 'bg-1', bonus_id: 'bo-live', employee_id: 'e-a1', reference_month: '2026-10-01', commission_base: 'revenue', goal_amount: 3000, bonus_amount: 500, achieved_amount: 3500, goal_met: true }
    ]
  }
}
