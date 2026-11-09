import type { H3Event } from 'h3'
import { getSupabaseAdminClient } from '../supabase'
import type { AuditRow } from './build'

const FLUSH_EVERY_MS = 2000
const FLUSH_AT_ROWS = 50
const ERROR_LOG_EVERY_MS = 60_000

let buffer: AuditRow[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let lastErrorLog = 0

function logFailure(rows: AuditRow[], message: string) {
  const now = Date.now()
  if (now - lastErrorLog < ERROR_LOG_EVERY_MS) return
  lastErrorLog = now
  // Sem corpos: o log de erro não pode vazar o que a sanitização protege.
  const summary = rows.slice(0, 5).map(r => `${r.request_id} ${r.action} ${r.status_code}`)
  console.error(`[audit] falha ao gravar ${rows.length} linha(s): ${message}`, summary)
}

/** Insere em lote; 1 nova tentativa; nunca lança. */
export async function insertAuditRows(rows: AuditRow[]): Promise<void> {
  if (!rows.length) return
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { error } = await getSupabaseAdminClient().from('audit_logs').insert(rows)
      if (!error) return
      if (attempt === 1) logFailure(rows, error.message)
    } catch (err) {
      if (attempt === 1) logFailure(rows, (err as Error)?.message ?? 'erro inesperado')
    }
  }
}

/** Descarrega o buffer agora (servidor persistente). */
export async function flushAudit(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const rows = buffer
  buffer = []
  await insertAuditRows(rows)
}

/**
 * Serverless (a plataforma fornece waitUntil): grava dentro dele, pois a função congela após a resposta.
 * Servidor Node persistente: acumula e descarrega a cada 2 s ou 50 linhas.
 */
export function enqueueAudit(event: H3Event, row: AuditRow): void {
  const platformWaitUntil = event.context?.waitUntil as ((p: Promise<unknown>) => void) | undefined
  if (typeof platformWaitUntil === 'function') {
    platformWaitUntil(insertAuditRows([row]))
    return
  }

  buffer.push(row)
  if (buffer.length >= FLUSH_AT_ROWS) {
    void flushAudit()
    return
  }
  if (!timer) {
    timer = setTimeout(() => void flushAudit(), FLUSH_EVERY_MS)
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
  }
}
