import { z } from 'zod'
import { getQuery } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermissionIfMember } from '../../utils/require-org-permission-if-member'
import { resolveOrganizationId } from '../../utils/organization'

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
})

type BillingInvoiceRow = {
  stripe_invoice_id: string
  status: string | null
  amount: number | null
  due_date: string | null
  hosted_invoice_url: string | null
  pdf_url: string | null
  invoice_number: string | null
  issue_date: string | null
  created_at: string
  period_start: string | null
  period_end: string | null
}

export default eventHandler(async (event) => {
  const user = await requireAuthUser(event)
  await requireOrgPermissionIfMember(user.id, 'subscription.view', event)

  const query = getQuery(event)
  const parsed = querySchema.safeParse(query)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid query',
      data: parsed.error.flatten()
    })
  }

  const { page, pageSize } = parsed.data
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, user.id)

  const { data, error, count } = await supabase
    .from('billing_invoices')
    .select('stripe_invoice_id,status,amount,due_date,hosted_invoice_url,pdf_url,invoice_number,issue_date,created_at,period_start,period_end', { count: 'exact' })
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false, nullsFirst: false })
    .range(from, to)
    .returns<BillingInvoiceRow[]>()

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to load invoices'
    })
  }

  // billing_invoices.amount is stored in currency units (e.g. 399.00 BRL).
  // The frontend formatMoney divides by 100 (Stripe convention), so multiply here.
  const items = (data ?? []).map(row => ({
    stripe_invoice_id: row.stripe_invoice_id,
    status: row.status,
    currency: 'brl',
    total: row.amount != null ? Math.round(Number(row.amount) * 100) : null,
    amount_due: row.amount != null ? Math.round(Number(row.amount) * 100) : null,
    amount_paid: row.status === 'paid' && row.amount != null ? Math.round(Number(row.amount) * 100) : 0,
    paid: row.status === 'paid',
    due_date: row.due_date,
    hosted_invoice_url: row.hosted_invoice_url,
    invoice_pdf: row.pdf_url,
    invoice_number: row.invoice_number,
    created: row.issue_date ?? row.created_at,
    period_start: row.period_start,
    period_end: row.period_end
  }))

  return {
    items,
    page,
    pageSize,
    total: count ?? 0
  }
})
