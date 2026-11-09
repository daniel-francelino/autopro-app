import type { getSupabaseAdminClient } from './supabase'

type Supabase = ReturnType<typeof getSupabaseAdminClient>

export type WebhookClaim
  = | { kind: 'process', tracked: boolean }
    | { kind: 'duplicate' }

/**
 * Idempotência do webhook do Stripe. A reentrega do mesmo `evt_...` já processado vira no-op; evento que ficou
 * `received`/`failed` (queda no meio ou erro anterior) é reprocessado. Se a tabela não existir (migration 102 não
 * aplicada) o webhook segue como antes, sem idempotência — nunca bloqueia o processamento de pagamento.
 */
export async function claimStripeEvent(
  supabase: Supabase,
  event: { id: string, type: string },
  payload: unknown
): Promise<WebhookClaim> {
  try {
    const { data: inserted, error } = await supabase
      .from('stripe_webhook_events')
      .upsert({ id: event.id, type: event.type, payload, status: 'received' }, { onConflict: 'id', ignoreDuplicates: true })
      .select('id')

    if (error) {
      console.warn('[stripe/webhook] registro de evento indisponível:', error.message)
      return { kind: 'process', tracked: false }
    }
    if (inserted && inserted.length > 0) return { kind: 'process', tracked: true }

    const { data: existing } = await supabase
      .from('stripe_webhook_events')
      .select('status')
      .eq('id', event.id)
      .maybeSingle()

    if (existing && (existing.status === 'processed' || existing.status === 'ignored')) {
      return { kind: 'duplicate' }
    }
    await supabase.from('stripe_webhook_events').update({ status: 'received', error_message: null }).eq('id', event.id)
    return { kind: 'process', tracked: true }
  } catch (err) {
    console.warn('[stripe/webhook] registro de evento falhou:', (err as Error)?.message)
    return { kind: 'process', tracked: false }
  }
}

export async function finishStripeEvent(
  supabase: Supabase,
  eventId: string,
  result: { status: 'processed' | 'ignored' | 'failed', errorMessage?: string, organizationId?: string | null }
): Promise<void> {
  try {
    await supabase
      .from('stripe_webhook_events')
      .update({
        status: result.status,
        processed_at: new Date().toISOString(),
        error_message: result.errorMessage?.slice(0, 1000) ?? null,
        organization_id: result.organizationId ?? null
      })
      .eq('id', eventId)
  } catch (err) {
    console.warn('[stripe/webhook] não foi possível fechar o registro do evento:', (err as Error)?.message)
  }
}
