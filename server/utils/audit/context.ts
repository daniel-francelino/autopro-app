import type { H3Event } from 'h3'
import type { AuditContext } from '../../types/audit'

/**
 * Anexa dados ao contexto de auditoria da requisição (autor, organização, papel, ...).
 * Não faz nada fora de /api/** (sem contexto) e ignora valores indefinidos, então é seguro
 * chamar de qualquer utilitário de auth sem condicionais.
 */
export function setAuditContext(event: H3Event | null | undefined, patch: Partial<Omit<AuditContext, 'requestId' | 'startedAt'>>) {
  const ctx = event?.context?.audit
  if (!ctx) return
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (ctx as unknown as Record<string, unknown>)[key] = value
  }
}
