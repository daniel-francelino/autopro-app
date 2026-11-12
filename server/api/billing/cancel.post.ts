import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { getStripe } from '../../utils/stripe'

type SubscriptionRow = {
  id: string
  stripe_subscription_id: string | null
  status: string
}

export default eventHandler(async (event) => {
  const user = await requireAuthUser(event)
  await requireOrgPermission(user.id, 'subscription.manage', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, user.id)

  const { data, error } = await supabase
    .from('subscriptions')
    .select('id,stripe_subscription_id,status')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionRow>()

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to load subscription'
    })
  }

  if (!data?.stripe_subscription_id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Subscription not found'
    })
  }

  const hasActive = data.status === 'active' || data.status === 'trial'
  if (!hasActive) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Subscription is not active'
    })
  }

  const stripe = getStripe()
  const updated = await stripe.subscriptions.update(data.stripe_subscription_id, {
    cancel_at_period_end: true
  })

  return { ok: true, cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end) }
})
