import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { computeChurnSeries, computeMrr, type SubscriptionRow } from '../../../utils/billing-metrics'

const PROBLEM_STATUSES = ['failed', 'overdue', 'uncollectible', 'action_required', 'pending', 'open']

/**
 * GET /api/admin/billing/summary
 * MRR (total e por plano), churn/novas em 12 meses e faturas que pedem ação. Só owner.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const supabase = getSupabaseAdminClient()

  const [subscriptions, invoices] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('status, plan_key, monthly_amount, start_date, cancellation_date, created_at')
      .is('deleted_at', null)
      .limit(20000),
    supabase
      .from('billing_invoices')
      .select('id, organization_id, invoice_number, amount, status, due_date, issue_date, attempt_count, next_payment_attempt, hosted_invoice_url, user_email')
      .is('deleted_at', null)
      .in('status', PROBLEM_STATUSES)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(100)
  ])

  if (subscriptions.error) throw createError({ statusCode: 500, statusMessage: 'Erro ao carregar assinaturas' })
  if (invoices.error) throw createError({ statusCode: 500, statusMessage: 'Erro ao carregar faturas' })

  const rows = (subscriptions.data ?? []) as SubscriptionRow[]
  const now = new Date()
  const series = computeChurnSeries(rows, now, 12)

  return {
    ...computeMrr(rows),
    current_month: series[series.length - 1] ?? null,
    series,
    invoices_needing_action: invoices.data ?? []
  }
})
