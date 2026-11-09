import type { H3Event } from 'h3'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Parâmetro de rota que precisa ser UUID (400 caso contrário, antes de tocar no banco). */
export function requireUuidParam(event: H3Event, name = 'id'): string {
  const value = getRouterParam(event, name) ?? ''
  if (!UUID.test(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Identificador inválido' })
  }
  return value
}

/** Motivo obrigatório (ações destrutivas do owner): mínimo de 5 caracteres, máximo de 500. */
export function requireReason(body: unknown): string {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).reason : undefined
  const reason = typeof raw === 'string' ? raw.trim() : ''
  if (reason.length < 5) {
    throw createError({ statusCode: 400, statusMessage: 'Informe o motivo (mínimo de 5 caracteres)' })
  }
  return reason.slice(0, 500)
}
