import { z } from 'zod'
import { getRequestURL } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermissionIfMember } from '../../utils/require-org-permission-if-member'
import { getAllowedStripePriceIds, getStripe } from '../../utils/stripe'
import { getOrCreateStripeCustomer } from '../../utils/stripe-customer'

const schema = z.object({
  priceId: z.string().min(1),
  quantity: z.number().int().positive().optional(),
  successPath: z.string().min(1).optional(),
  cancelPath: z.string().min(1).optional()
})

export default eventHandler(async (event) => {
  const user = await requireAuthUser(event)
  await requireOrgPermissionIfMember(user.id, 'subscription.manage', event)
  const body = await readBody(event)
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid payload',
      data: parsed.error.flatten()
    })
  }

  const allowed = getAllowedStripePriceIds()
  if (allowed && !allowed.includes(parsed.data.priceId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid priceId'
    })
  }

  const stripe = getStripe()
  const supabase = getSupabaseAdminClient()
  const quantity = parsed.data.quantity ?? 1

  const successPath = parsed.data.successPath
  const cancelPath = parsed.data.cancelPath

  if (successPath && !successPath.startsWith('/')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid successPath'
    })
  }

  if (cancelPath && !cancelPath.startsWith('/')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid cancelPath'
    })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, display_name, stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle<{ id: string, display_name: string | null, stripe_customer_id: string | null }>()

  const customerId = await getOrCreateStripeCustomer({
    stripe,
    supabase,
    userId: user.id,
    email: user.email,
    displayName: profile?.display_name ?? null,
    profileId: profile?.id ?? null,
    knownCustomerId: profile?.stripe_customer_id ?? null
  })

  const origin = getRequestURL(event).origin
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: user.id,
    allow_promotion_codes: true,
    line_items: [{
      price: parsed.data.priceId,
      quantity
    }],
    success_url: `${origin}${successPath || '/app?checkout=success'}`,
    cancel_url: `${origin}${cancelPath || '/pricing?checkout=cancel'}`,
    subscription_data: {
      metadata: {
        supabase_user_id: user.id
      }
    },
    metadata: {
      supabase_user_id: user.id
    }
  })

  if (!session.url) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Stripe session did not return a URL'
    })
  }

  return { url: session.url }
})
