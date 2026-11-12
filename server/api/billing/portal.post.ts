import { getRequestURL } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { getStripe } from '../../utils/stripe'

export default eventHandler(async (event) => {
  const user = await requireAuthUser(event)
  await requireOrgPermission(user.id, 'subscription.manage', event)
  const supabase = getSupabaseAdminClient()

  const { data: existingCustomer, error } = await supabase
    .from('stripe_customers')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle<{ stripe_customer_id: string }>()

  if (error || !existingCustomer?.stripe_customer_id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Stripe customer not found'
    })
  }

  const stripe = getStripe()
  const config = useRuntimeConfig()
  const origin = getRequestURL(event).origin

  const session = await stripe.billingPortal.sessions.create({
    customer: existingCustomer.stripe_customer_id,
    return_url: `${origin}/app/settings`,
    configuration: config.stripeBillingPortalConfigurationId || undefined
  })

  return { url: session.url }
})
