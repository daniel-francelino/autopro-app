export interface AuditContext {
  requestId: string
  startedAt: number
  /** Preenchidos pelos utilitários de auth (requireAuthUser, resolveOrganizationId, ...). */
  userId?: string
  email?: string | null
  organizationId?: string
  employeeId?: string | null
  role?: string
  actorType?: 'user' | 'owner' | 'system' | 'webhook' | 'anonymous'
  /** Sobrescreve a `action` derivada da rota (ex.: webhook do Stripe). */
  action?: string
  resourceType?: string
  resourceId?: string
  /** Camada 2: diff antes/depois (ver recordAudit). */
  changes?: Record<string, unknown>
  /** Erro lançado pelo handler (hook `error`). */
  error?: { statusCode: number, message: string, data?: unknown }
  /** Corpo da resposta de um GET de detalhe (hook `beforeResponse`). */
  responseBody?: unknown
  logged?: boolean
}

declare module 'h3' {
  interface H3EventContext {
    audit?: AuditContext
  }
}
