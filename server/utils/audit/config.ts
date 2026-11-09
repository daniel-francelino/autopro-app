// Regras do log de auditoria (docs/audit/audit-log-plan.md §5.2 e §5.6).
// Os padrões usam `:p` para qualquer parâmetro de rota (`[id]`, `[reference]`, ...).

/** Rotas ignoradas por completo (ruído de sessão, polling, coletor de métricas, a própria tela). */
export const IGNORED_ROUTES = new Set<string>([
  'GET /api/supabase/health',
  'GET /api/auth/me',
  'POST /api/auth/set-session',
  'POST /api/notifications/read',
  'POST /api/notifications/read-all',
  'POST /api/metrics/track',
  'GET /api/admin/audit-logs'
])

/** GETs de detalhe: registrados mesmo com sucesso, com a resposta (§5.2). */
export const DETAIL_GET_ROUTES = new Set<string>([
  'GET /api/service-orders/:p',
  'GET /api/service-orders/:p/edit-data',
  'GET /api/service-orders/:p/nfse',
  'GET /api/financial/:p',
  'GET /api/commissions/:p',
  'GET /api/commissions/:p/rules',
  'GET /api/commissions/:p/impact',
  'GET /api/bonuses/:p',
  'GET /api/bonuses/:p/progress',
  'GET /api/bonuses/:p/financial-records',
  'GET /api/reports/commissions/:p',
  'GET /api/employees/:p/commissions',
  'GET /api/employees/:p/commission-plans',
  'GET /api/employees/:p/commission-rules',
  'GET /api/employees/:p/bonuses',
  'GET /api/roles/:p',
  'GET /api/roles/:p/actions',
  'GET /api/fiscal/nfse/:p',
  'GET /api/feedback/:p',
  'GET /api/feedback/:p/responses'
])

/** GETs registrados sempre, mas sem guardar a resposta (quem abriu um detalhe do log fica rastreável). */
export const ALWAYS_AUDIT_GET_ROUTES = new Set<string>([
  'GET /api/admin/audit-logs/:p'
])

/** Rotas de autenticação: a resposta nunca é gravada (traz sessão/tokens). */
export const AUTH_ROUTE_PREFIX = '/api/auth/'

/** Verbos reconhecidos no último segmento estático (§5.6). */
export const KNOWN_VERBS = new Set<string>([
  'cancel', 'pay', 'authorize', 'reject', 'generate', 'generate-commissions', 'process-payment',
  'receive-extra-payment', 'down-payment', 'grant-access', 'migrate', 'extend-recurrence', 'email',
  'sync', 'hook', 'link', 'import', 'batch', 'preview', 'assignments', 'versions', 'value-versions',
  'suspend', 'reactivate', 'deactivate'
])

export interface DerivedAction {
  action: string
  resourceType?: string
  resourceId?: string
}

type Body = Record<string, unknown> | null

/** Overrides por rota (`MÉTODO padrão-com-:p`). Funções recebem o corpo e podem alterar o resource_id. */
export const ACTION_OVERRIDES: Record<string, string | ((body: Body) => { action: string, resourceId?: string })> = {
  'POST /api/service-orders': (body) => {
    const orderId = body && typeof body.orderId === 'string' ? body.orderId : null
    return orderId
      ? { action: 'service_order.update', resourceId: orderId }
      : { action: 'service_order.create' }
  },
  'POST /api/roles/:p/actions': 'role.permissions_update',
  'POST /api/users/update-role': 'user.role_change',
  'POST /api/users/update-fields': 'user.update_fields',
  'POST /api/financial/pay-entries-bulk': 'financial.pay_bulk',
  'POST /api/financial/pay-commissions-bulk': 'commission.pay_bulk',
  'POST /api/financial/update-recurring': 'financial.recurrence_update',
  'DELETE /api/fiscal/nfse/:p': 'nfse.cancel',
  'POST /api/fiscal/nfse/:p/hook': 'nfse.retry_hook',
  'POST /api/fiscal/nfse/:p/email': 'nfse.email',
  'POST /api/auth/login': 'auth.login',
  'POST /api/auth/logout': 'auth.logout',
  'POST /api/auth/signup': 'auth.signup',
  'POST /api/auth/forgot-password': 'auth.password_reset_request',
  'POST /api/auth/reset-password': 'auth.password_reset',
  'POST /api/auth/reset-password-with-tokens': 'auth.password_reset',
  'PUT /api/auth/password': 'auth.password_change',
  'DELETE /api/auth/account': 'auth.account_delete',
  'GET /api/admin/audit-logs/:p': 'audit.view'
}
