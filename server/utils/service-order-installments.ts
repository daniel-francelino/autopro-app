import type { SupabaseClient } from '@supabase/supabase-js'

type GetNextInstallmentNumberParams = {
  supabase: SupabaseClient
  organizationId: string
  orderId: string
}

/**
 * `service_order_installments_service_order_id_number_key` (migration
 * 20240101000077) is a partial unique index scoped to non-deleted rows, so a
 * soft-deleted installment's number is free to be reused. Counting only
 * active rows here is therefore safe and keeps numbering contiguous.
 */
export async function getNextInstallmentNumber({
  supabase,
  organizationId,
  orderId
}: GetNextInstallmentNumberParams): Promise<number> {
  const { count } = await supabase
    .from('service_order_installments')
    .select('id', { count: 'exact', head: true })
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)

  return (count || 0) + 1
}
