import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermissionIfMember } from '../../utils/require-org-permission-if-member'
import { resolveOrganizationId } from '../../utils/organization'
import { getStripe } from '../../utils/stripe'

type SubscriptionRow = {
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  status: string
  start_date: string | null
  next_payment_date: string | null
  cancellation_date: string | null
}

function mapStatus(s: string | null): string {
  switch (s) {
    case 'active': return 'active'
    case 'trial': return 'trialing'
    case 'suspended': return 'past_due'
    case 'cancelled': return 'canceled'
    default: return s ?? 'unknown'
  }
}

export default eventHandler(async (event) => {
  const user = await requireAuthUser(event)
  await requireOrgPermissionIfMember(user.id, 'subscription.view', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, user.id)

  const { data, error } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id, stripe_subscription_id, status, start_date, next_payment_date, cancellation_date')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionRow>()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to load subscription' })
  }

  const mappedStatus = data ? mapStatus(data.status) : null
  const hasAccess = mappedStatus === 'active' || mappedStatus === 'trialing'

  let priceId: string | null = null
  let quantity: number | null = null
  let cancelAtPeriodEnd = false

  if (data?.stripe_subscription_id) {
    try {
      const stripe = getStripe()
      const stripeSub = await stripe.subscriptions.retrieve(data.stripe_subscription_id, {
        expand: ['items.data.price']
      })
      const item = stripeSub.items.data[0]
      priceId = item?.price?.id ?? null
      quantity = item?.quantity ?? null
      cancelAtPeriodEnd = stripeSub.cancel_at_period_end
    } catch {
      // non-fatal: fall back to null values
    }
  }

  return {
    hasAccess,
    subscription: data
      ? {
          stripe_customer_id: data.stripe_customer_id,
          stripe_subscription_id: data.stripe_subscription_id ?? '',
          status: mappedStatus,
          price_id: priceId,
          quantity,
          current_period_start: data.start_date,
          current_period_end: data.next_payment_date,
          cancel_at_period_end: cancelAtPeriodEnd,
          canceled_at: data.cancellation_date
        }
      : null
  }
})
