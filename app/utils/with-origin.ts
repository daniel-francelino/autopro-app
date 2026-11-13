import { OS_HISTORY_ORIGIN_HEADER, type OsHistorySourceCode } from '../../lib/utils/os-history-sources'

/**
 * Override de origem por ação (histórico da OS). Uso: `$fetch(url, withOrigin('financial_bulk', { method: 'POST', body }))`.
 * O plugin api-client.client.ts só define `x-origin` pela rota quando o header ainda não existe.
 * Só informativo: o servidor valida contra o catálogo e as origens aceitas pelo endpoint.
 */
export function withOrigin<const T extends object>(origin: OsHistorySourceCode, options: T): T & { headers: Record<string, string> } {
  const headers: Record<string, string> = {}
  new Headers((options as { headers?: HeadersInit }).headers).forEach((value, key) => { headers[key] = value })
  headers[OS_HISTORY_ORIGIN_HEADER] = origin
  return { ...options, headers }
}
