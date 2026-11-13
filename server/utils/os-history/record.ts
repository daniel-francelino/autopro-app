import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OS_HISTORY_ORIGIN_HEADER, resolveSource, type SourcePolicy } from '../../../lib/utils/os-history-sources'

export type OsEventCategory = 'order' | 'items' | 'status' | 'payment' | 'commission' | 'fiscal'
export type OsEventVisibility = 'general' | 'financial' | 'commission'

export interface OsEventInput {
  organizationId: string
  serviceOrderId: string
  eventType: string
  category: OsEventCategory
  visibility: OsEventVisibility
  /** Valores já legíveis (snapshot do momento do fato). Nunca dados pessoais além de nomes. */
  payload: Record<string, unknown>
  entityType?: string
  entityId?: string
  /** Obrigatória: única por organização, torna reenvio/retry seguro (ON CONFLICT DO NOTHING). */
  idempotencyKey: string
  schemaVersion?: number
}

const TABLE = 'service_order_events'
const ACTOR_NAME_MAX = 200

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

async function resolveActorName(supabase: SupabaseClient, userId: string | undefined) {
  if (userId) {
    try {
      const { data } = await supabase.from('user_profiles').select('display_name').eq('user_id', userId).maybeSingle()
      const name = typeof data?.display_name === 'string' ? data.display_name.trim() : ''
      if (name) return name.slice(0, ACTOR_NAME_MAX)
    } catch { /* cai para o e-mail */ }
  }
  // Sem nome cadastrado: rótulo neutro (não grava parte do e-mail de forma imutável).
  return 'Usuário'
}

/**
 * Grava eventos do histórico da OS (docs/architecture/os-history-timeline.md §4).
 * Chamar com `await` DEPOIS do último passo de negócio que deu certo. NUNCA lança: se o insert falhar
 * (após 1 retry) só registra o erro com o request_id, para não derrubar uma operação financeira já feita.
 * Ator, origem e correlation_id vêm do servidor (contexto da requisição), nunca do corpo.
 */
export async function recordOsEvents(
  event: H3Event | null | undefined,
  supabase: SupabaseClient,
  events: OsEventInput[],
  sourcePolicy: SourcePolicy
): Promise<void> {
  if (!events.length) return
  const ctx = event?.context?.audit
  const requestId = ctx?.requestId
  try {
    const correlationId = isUuid(requestId) ? requestId : randomUUID()
    const source = resolveSource(event ? getHeader(event, OS_HISTORY_ORIGIN_HEADER) : undefined, sourcePolicy)
    const actorType = ctx?.actorType === 'owner' ? 'owner' : 'user'
    const actorName = await resolveActorName(supabase, ctx?.userId)

    const rows = events.map(e => ({
      organization_id: e.organizationId,
      service_order_id: e.serviceOrderId,
      event_type: e.eventType,
      schema_version: e.schemaVersion ?? 1,
      category: e.category,
      visibility: e.visibility,
      actor_type: actorType,
      actor_user_id: isUuid(ctx?.userId) ? ctx!.userId : null,
      actor_name: actorName,
      entity_type: e.entityType ?? null,
      entity_id: isUuid(e.entityId) ? e.entityId : null,
      payload: e.payload,
      correlation_id: correlationId,
      source_code: source.code,
      source_label: source.label,
      source_declared: source.declared,
      source_trust: source.trust,
      idempotency_key: e.idempotencyKey,
      origin: 'live'
    }))

    let lastError: unknown = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { error } = await supabase
          .from(TABLE)
          .upsert(rows, { onConflict: 'organization_id,idempotency_key', ignoreDuplicates: true })
        if (!error) return
        lastError = error
      } catch (err) {
        lastError = err
      }
    }
    console.error('[os-history] falha ao gravar evento', { requestId, types: events.map(e => e.eventType), error: (lastError as { message?: string })?.message ?? lastError })
  } catch (err) {
    console.error('[os-history] erro inesperado ao montar evento', { requestId, error: (err as Error)?.message })
  }
}
