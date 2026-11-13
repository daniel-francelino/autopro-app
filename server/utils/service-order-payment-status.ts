import type { SupabaseClient } from '@supabase/supabase-js'
import { OS_EVENT_KEYS, osEvent, recordWithContext, requestScope, type OsHistoryContext } from './os-history/events'

type RecalculateServiceOrderPaymentStatusParams = {
  supabase: SupabaseClient
  organizationId: string
  orderId: string
  userEmail?: string | null
  /** Histórico da OS (opcional): grava `payment.status_changed` só quando a situação muda. */
  history?: OsHistoryContext | null
}

/**
 * Single source of truth for service_orders.payment_status. Recomputes it
 * from the persisted state of service_order_installments instead of trusting
 * whatever the caller submitted, and writes the result.
 *
 * An order with no installment rows (e.g. payment was just wiped) is
 * `pending`. Once at least one row exists, it's `paid` only if every row is
 * fully paid, `partial` if any row is fully or partially paid (a single
 * installment settled across more than one receipt counts here too), and
 * `pending` otherwise.
 */
export async function recalculateServiceOrderPaymentStatus({
  supabase,
  organizationId,
  orderId,
  userEmail,
  history
}: RecalculateServiceOrderPaymentStatusParams): Promise<'pending' | 'partial' | 'paid'> {
  const { data: installments } = await supabase
    .from('service_order_installments')
    .select('status')
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)

  const rows = installments || []
  const allPaid = rows.length > 0 && rows.every(row => row.status === 'paid')
  const anyPaidOrPartial = rows.some(row => row.status === 'paid' || row.status === 'partial')
  const paymentStatus = allPaid ? 'paid' : anyPaidOrPartial ? 'partial' : 'pending'

  let previousStatus: string | null = null
  if (history) {
    try {
      const { data: current } = await supabase.from('service_orders').select('payment_status').eq('id', orderId).eq('organization_id', organizationId).maybeSingle()
      previousStatus = typeof current?.payment_status === 'string' ? current.payment_status : null
    } catch { /* histórico é best-effort */ }
  }

  await supabase
    .from('service_orders')
    .update({ payment_status: paymentStatus, updated_by: userEmail || null })
    .eq('id', orderId)
    .eq('organization_id', organizationId)

  if (history && previousStatus && previousStatus !== paymentStatus) {
    const from = previousStatus
    await recordWithContext(history, supabase, () => [osEvent('payment.status_changed', {
      organizationId,
      serviceOrderId: orderId,
      entityType: 'service_order',
      entityId: orderId,
      idempotencyKey: OS_EVENT_KEYS.paymentStatus(orderId, history.scope ?? requestScope(history.event), from, paymentStatus)
    }, { from, to: paymentStatus })])
  }

  return paymentStatus
}
