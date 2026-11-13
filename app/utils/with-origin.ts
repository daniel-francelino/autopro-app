import { OS_HISTORY_ORIGIN_HEADER, type OsHistorySourceCode } from '../../lib/utils/os-history-sources'

/**
 * Override de origem por ação (histórico da OS). Uso: `$fetch(url, withOrigin('financial_bulk', { method: 'POST', body }))`.
 * O plugin api-client.client.ts só define `x-origin` pela rota quando o header ainda não existe.
 * Só informativo: o servidor valida contra o catálogo e as origens aceitas pelo endpoint.
 */
export function withOrigin<T extends { headers?: HeadersInit }>(origin: OsHistorySourceCode, options: T): T {
  const headers = new Headers(options.headers)
  headers.set(OS_HISTORY_ORIGIN_HEADER, origin)
  return { ...options, headers }
}
