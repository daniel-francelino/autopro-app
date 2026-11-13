// Catálogo fechado de origens (telas) do histórico da OS. Compartilhado entre o front
// (x-origin) e o servidor (validação). Rótulos aprovados: docs/architecture/os-history-timeline.md §5.1.
// A origem é só informação de exibição e suporte; nunca concede nem retira acesso.

export const OS_HISTORY_SOURCES = {
  os_detail: 'Ordem de serviço (detalhe)',
  os_form: 'Ordem de serviço (cadastro/edição)',
  os_list: 'Ordem de serviço (lista)',
  financial_entries: 'Financeiro > Lançamentos',
  financial_bulk: 'Financeiro > Pagamento em lote',
  commission_report: 'Relatórios > Comissões',
  commission_bulk: 'Pagamento de comissões em lote',
  bonus_page: 'Financeiro > Bônus',
  appointments: 'Agenda',
  fiscal: 'Fiscal > NFS-e',
  system: 'Sistema',
  admin_support: 'Suporte AutoPro',
  api: 'Integração/API',
  unknown: 'Origem não identificada'
} as const

export type OsHistorySourceCode = keyof typeof OS_HISTORY_SOURCES

export const OS_HISTORY_ORIGIN_HEADER = 'x-origin'

export function isOsHistorySourceCode(value: unknown): value is OsHistorySourceCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(OS_HISTORY_SOURCES, value)
}

export function osHistorySourceLabel(code: OsHistorySourceCode): string {
  return OS_HISTORY_SOURCES[code]
}

/**
 * Mapa fixo rota da página -> origem (maior prefixo vence). Rota sem entrada: sem header,
 * o servidor cai na origem padrão do endpoint.
 * Limitação conhecida (F0): `/app/service-orders` declara `os_detail` para toda a tela; o refinamento
 * `os_form`/`os_list` fica para as fatias que instrumentarem esses eventos.
 */
const ROUTE_ORIGINS: Array<[prefix: string, code: OsHistorySourceCode]> = [
  ['/app/service-orders', 'os_detail'],
  ['/app/financial/bonuses', 'bonus_page'],
  ['/app/financial/commissions', 'commission_report'],
  ['/app/financial/service-invoices', 'fiscal'],
  ['/app/financial', 'financial_entries'],
  ['/app/reports/commissions', 'commission_report'],
  ['/app/appointments', 'appointments'],
  ['/admin', 'admin_support']
]

export function originForPath(path: string | null | undefined): OsHistorySourceCode | null {
  if (!path) return null
  const clean = path.split('?')[0]!.split('#')[0]!.replace(/\/+$/, '') || '/'
  let best: [string, OsHistorySourceCode] | null = null
  for (const entry of ROUTE_ORIGINS) {
    const [prefix] = entry
    if ((clean === prefix || clean.startsWith(`${prefix}/`)) && (!best || prefix.length > best[0].length)) best = entry
  }
  return best ? best[1] : null
}

export type SourceTrust = 'inferred' | 'declared' | 'mismatch'

export interface SourcePolicy {
  /** Origem inferida pelo endpoint (usada quando o header falta ou diverge). */
  defaultSource: OsHistorySourceCode
  /** Origens que o endpoint aceita declaradas; `defaultSource` é sempre aceita. */
  allowedSources?: readonly OsHistorySourceCode[]
}

export interface ResolvedSource {
  code: OsHistorySourceCode
  label: string
  declared: OsHistorySourceCode | null
  trust: SourceTrust
}

/** Regras 2 a 5 de §5.2: catálogo fechado, coerência com o endpoint, fallback e `source_trust`. */
export function resolveSource(headerValue: unknown, policy: SourcePolicy): ResolvedSource {
  const fallback = policy.defaultSource
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue
  const declared = typeof raw === 'string' ? raw.trim().toLowerCase() : ''

  // Ausente ou fora do catálogo: descartado, vale a origem do endpoint.
  if (!isOsHistorySourceCode(declared)) {
    return { code: fallback, label: OS_HISTORY_SOURCES[fallback], declared: null, trust: 'inferred' }
  }
  const allowed = new Set<OsHistorySourceCode>([fallback, ...(policy.allowedSources ?? [])])
  if (allowed.has(declared)) {
    return { code: declared, label: OS_HISTORY_SOURCES[declared], declared, trust: 'declared' }
  }
  return { code: fallback, label: OS_HISTORY_SOURCES[fallback], declared, trust: 'mismatch' }
}
