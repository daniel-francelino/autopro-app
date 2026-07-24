import type { SupabaseClient } from '@supabase/supabase-js'

type RecalculateServiceOrderPaymentStatusParams = {
  supabase: SupabaseClient
  organizationId: string
  orderId: string
  userEmail?: string | null
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
  userEmail
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

  await supabase
    .from('service_orders')
    .update({ payment_status: paymentStatus, updated_by: userEmail || null })
    .eq('id', orderId)
    .eq('organization_id', organizationId)

  return paymentStatus
}
