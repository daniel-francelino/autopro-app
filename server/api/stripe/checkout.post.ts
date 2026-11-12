import { getRequestHeader } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermissionIfMember } from '../../utils/require-org-permission-if-member'
import { getAllowedStripePriceIds, getStripe } from '../../utils/stripe'
import { getOrCreateStripeCustomer } from '../../utils/stripe-customer'

/**
 * POST /api/stripe/checkout
 * Creates a Stripe checkout session for a new subscription.
 * The organization is NOT created here — it is created by the webhook
 * after the payment is confirmed (checkout.session.completed).
 * This prevents orphaned organizations from abandoned checkouts.
 */
export default eventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermissionIfMember(authUser.id, 'subscription.manage', event)
  const supabase = getSupabaseAdminClient()
  const stripe = getStripe()

  const body = await readBody(event)
  const { priceId } = body || {}

  if (!priceId) {
    throw createError({ statusCode: 400, statusMessage: 'priceId é obrigatório' })
  }

  const allowedPriceIds = getAllowedStripePriceIds()
  if (allowedPriceIds && !allowedPriceIds.includes(priceId)) {
    throw createError({ statusCode: 400, statusMessage: 'priceId inválido' })
  }

  // Load user profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, display_name, stripe_customer_id, organization_id')
    .eq('user_id', authUser.id)
    .maybeSingle()

  if (!profile) {
    throw createError({ statusCode: 404, statusMessage: 'Usuário não encontrado' })
  }

  const customerId = await getOrCreateStripeCustomer({
    stripe,
    supabase,
    userId: authUser.id,
    email: authUser.email,
    displayName: profile.display_name as string | null,
    profileId: profile.id as string,
    knownCustomerId: profile.stripe_customer_id as string | null
  })

  const origin = getRequestHeader(event, 'origin') || getRequestHeader(event, 'referer')?.replace(/\/$/, '') || 'http://localhost:3000'

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    client_reference_id: authUser.id,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    allow_promotion_codes: true,
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/subscription`,
    metadata: {
      user_id: authUser.id,
      user_email: authUser.email ?? ''
    },
    subscription_data: {
      metadata: {
        user_id: authUser.id,
        user_email: authUser.email ?? ''
      }
    }
  })

  if (!session.url) {
    throw createError({ statusCode: 500, statusMessage: 'Stripe não retornou uma URL de checkout' })
  }

  return { url: session.url, sessionId: session.id }
})
