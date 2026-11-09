import { requireOwner } from '../../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireUuidParam } from '../../../../utils/admin-params'

/** GET /api/admin/organizations/:id/billing — assinatura e últimas 12 faturas. */
export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = requireUuidParam(event)
  const supabase = getSupabaseAdminClient()

  const [subscription, invoices] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('id, status, plan_key, plan_name, monthly_amount, start_date, next_payment_date, cancellation_date, stripe_subscription_id')
      .eq('organization_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('billing_invoices')
      .select('id, invoice_number, amount, status, issue_date, due_date, payment_date, attempt_count, hosted_invoice_url')
      .eq('organization_id', id)
      .is('deleted_at', null)
      .order('issue_date', { ascending: false })
      .limit(12)
  ])

  if (subscription.error || invoices.error) {
    throw createError({ statusCode: 500, statusMessage: 'Erro ao carregar a cobrança' })
  }
  return { subscription: subscription.data ?? null, invoices: invoices.data ?? [] }
})
