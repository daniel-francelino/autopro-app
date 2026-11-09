// Checagens do /admin/system. Puras ou com dependências injetadas, para testar sem rede.

export type CheckStatus = 'ok' | 'warning' | 'error' | 'not_configured'

export interface CheckResult {
  key: string
  label: string
  status: CheckStatus
  detail: string | null
  duration_ms: number | null
}

/** Executa `fn` com tempo máximo; nunca lança (erro/timeout viram `error`). */
export async function runCheck(
  key: string,
  label: string,
  fn: () => Promise<{ status?: CheckStatus, detail?: string | null }>,
  timeoutMs = 3000
): Promise<CheckResult> {
  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`sem resposta em ${timeoutMs / 1000}s`)), timeoutMs)
    })
    const result = await Promise.race([fn(), timeout])
    return { key, label, status: result.status ?? 'ok', detail: result.detail ?? null, duration_ms: Date.now() - startedAt }
  } catch (err) {
    return { key, label, status: 'error', detail: (err as Error)?.message ?? 'falha', duration_ms: Date.now() - startedAt }
  } finally {
    clearTimeout(timer)
  }
}

export interface AuditRowLite {
  http_method: string
  route_pattern: string | null
  status_code: number
  outcome: string
  created_at: string
}

/** Rotas que mais falham: agrupa por método + padrão + status. 5xx primeiro (bug), depois 4xx (uso). */
export function topFailingRoutes(rows: AuditRowLite[], limit = 15) {
  const groups = new Map<string, { http_method: string, route_pattern: string, status_code: number, total: number, last_at: string }>()
  for (const row of rows) {
    if (row.outcome === 'success') continue
    const key = `${row.http_method} ${row.route_pattern ?? '?'} ${row.status_code}`
    const entry = groups.get(key) ?? { http_method: row.http_method, route_pattern: row.route_pattern ?? '?', status_code: row.status_code, total: 0, last_at: row.created_at }
    entry.total++
    if (row.created_at > entry.last_at) entry.last_at = row.created_at
    groups.set(key, entry)
  }
  return [...groups.values()]
    .sort((a, b) => Number(b.status_code >= 500) - Number(a.status_code >= 500) || b.total - a.total)
    .slice(0, limit)
}

/** Alerta de segurança operacional: com um único owner, perder a conta tranca a plataforma. */
export function ownerAlert(owners: number): string | null {
  if (owners === 0) return 'Nenhum owner cadastrado: ninguém acessa o painel.'
  if (owners === 1) return 'Só existe um owner. Mantenha ao menos dois para não trancar a plataforma.'
  return null
}
