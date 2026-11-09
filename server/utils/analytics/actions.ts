import type { ActionEvent, LifecycleEvent } from '../../../lib/analytics/events'

// Mapa "método + rota" → evento de negócio. É consultado DEPOIS da resposta, só para 2xx.
// Nunca grava IDs, corpo ou texto: só o nome do evento. Fonte única das ações no servidor.
// Mantenha em sincronia com docs/metrics/usage-metrics-plan.md §5.3 e com ACTION_EVENTS.

type Name = ActionEvent | LifecycleEvent

interface Rule {
  method: 'POST' | 'PUT' | 'DELETE'
  path: RegExp
  /** Nome fixo, ou função que decide pelo corpo (ex.: criar × editar uma OS). */
  event: Name | ((body: Record<string, unknown> | null) => Name)
  needsBody?: boolean
}

const ID = '[^/]+'
const re = (pattern: string) => new RegExp(`^/api/${pattern}$`)

const RULES: Rule[] = [
  // Operação — esta rota CRIA e EDITA (body.orderId): só conta como criação sem orderId.
  {
    method: 'POST',
    path: re('service-orders'),
    needsBody: true,
    event: body => (body && body.orderId ? 'service_order_updated' : 'service_order_created')
  },
  { method: 'POST', path: re(`service-orders/${ID}/cancel`), event: 'service_order_cancelled' },
  { method: 'POST', path: re('appointments'), event: 'appointment_created' },
  { method: 'POST', path: re('clients'), event: 'client_created' },
  { method: 'POST', path: re('vehicles'), event: 'vehicle_created' },

  // Financeiro
  { method: 'POST', path: re('financial'), event: 'financial_entry_created' },
  { method: 'POST', path: re(`financial/${ID}/pay`), event: 'financial_entry_paid' },
  { method: 'POST', path: re('financial/pay-entries-bulk'), event: 'financial_entry_paid' },
  { method: 'POST', path: re(`service-orders/${ID}/installments/${ID}/pay`), event: 'installment_paid' },
  { method: 'POST', path: re(`service-orders/${ID}/(?:process-payment|down-payment|receive-extra-payment)`), event: 'payment_processed' },
  { method: 'POST', path: re(`reports/commissions/${ID}/pay`), event: 'commission_paid' },
  { method: 'POST', path: re('financial/pay-commissions-bulk'), event: 'commission_paid' },
  { method: 'POST', path: re('bonuses'), event: 'bonus_created' },
  { method: 'POST', path: re('commissions'), event: 'commission_plan_created' },

  // Estoque e compras
  { method: 'POST', path: re('products'), event: 'product_created' },
  { method: 'POST', path: re('purchases'), event: 'purchase_created' },
  { method: 'POST', path: re('purchase-requests'), event: 'purchase_request_created' },
  { method: 'POST', path: re('purchase-returns'), event: 'purchase_return_created' },
  { method: 'POST', path: re('(?:products|suppliers)/import'), event: 'catalog_imported' },

  // Fiscal
  { method: 'POST', path: re('fiscal/nfse'), event: 'nfse_issued' },
  { method: 'POST', path: re('fiscal/company/sync'), event: 'fiscal_company_synced' },

  // Gestão
  { method: 'POST', path: re('employees'), event: 'employee_created' },
  { method: 'POST', path: re(`employees/${ID}/grant-access`), event: 'access_granted' },
  { method: 'POST', path: re('roles'), event: 'role_changed' },
  { method: 'PUT', path: re(`roles/${ID}`), event: 'role_changed' },
  { method: 'POST', path: re(`roles/${ID}/actions`), event: 'role_changed' },
  { method: 'POST', path: re('users/update-role'), event: 'role_changed' },
  { method: 'POST', path: new RegExp(`^/api/(?:.+/)?export[^/]*$`), event: 'report_exported' },

  // Conversão (login/signup são gravados no próprio handler, onde o usuário é conhecido)
  { method: 'POST', path: re('organizations/complete-onboarding'), event: 'onboarding_completed' }
]

export function actionRuleFor(method: string, rawPath: string): Rule | null {
  const path = (rawPath.split('?')[0] ?? '').replace(/\/+$/, '')
  const upper = method.toUpperCase()
  for (const rule of RULES) {
    if (rule.method === upper && rule.path.test(path)) return rule
  }
  return null
}

export function resolveActionEvent(rule: Rule, body: Record<string, unknown> | null): Name {
  return typeof rule.event === 'function' ? rule.event(body) : rule.event
}
