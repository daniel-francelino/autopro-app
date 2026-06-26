import type { H3Event } from 'h3'
import type Stripe from 'stripe'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { getStripe, getStripeWebhookSecret } from '../../utils/stripe'
import { deleteFocusNfeCompanyForOrg } from '../../utils/focus-nfe'
import { ensureDefaultFinancialCategories } from '../../utils/financial-category-defaults'

type SupabaseClient = ReturnType<typeof getSupabaseAdminClient>
type SubRow = { id: string, organization_id: string }

function getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  // New Stripe API (>= 2024-09-30.acacia)
  const parentSub = invoice.parent?.subscription_details?.subscription
  if (parentSub) {
    return typeof parentSub === 'string' ? parentSub : parentSub.id
  }

  // Fallback: older Stripe API versions use invoice.subscription directly
  const legacySub = (invoice as unknown as { subscription?: string | { id: string } }).subscription
  if (legacySub) {
    return typeof legacySub === 'string' ? legacySub : legacySub.id
  }

  return null
}

function getSubscriptionPeriodEnd(subscription: Stripe.Subscription) {
  return subscription.items.data[0]?.current_period_end ?? null
}

/**
 * POST /api/stripe/webhook
 * Receives and processes Stripe webhook events.
 *
 * Handled events:
 *   checkout.session.completed    → create org + link user + create subscription
 *   invoice.payment_succeeded     → ensure subscription/org is active
 *   invoice.payment_failed        → suspend subscription
 *   customer.subscription.updated → sync subscription status
 *   customer.subscription.deleted → cancel subscription + deactivate org
 *
 * Security: Stripe-Signature header is verified with STRIPE_WEBHOOK_SECRET.
 * The raw request body must NOT be parsed before signature verification.
 */
export default defineEventHandler(async (event: H3Event) => {
  // ── Read raw body before any parsing ──────────────────────────────────────
  const rawBody = await readRawBody(event)
  if (!rawBody) {
    throw createError({ statusCode: 400, statusMessage: 'Empty webhook body' })
  }

  const signature = getRequestHeader(event, 'stripe-signature')
  if (!signature) {
    throw createError({ statusCode: 400, statusMessage: 'Missing Stripe-Signature header' })
  }

  // ── Verify signature ──────────────────────────────────────────────────────
  const stripe = getStripe()
  const webhookSecret = getStripeWebhookSecret()

  let stripeEvent: Stripe.Event
  try {
    stripeEvent = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid Stripe webhook signature' })
  }

  const supabase = getSupabaseAdminClient()

  // ── Route events ──────────────────────────────────────────────────────────
  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(stripeEvent.data.object as Stripe.Checkout.Session, supabase, stripe)
        break

      case 'invoice.payment_succeeded':
      case 'invoice.paid':
        await handleInvoicePaid(stripeEvent.data.object as Stripe.Invoice, supabase)
        break

      case 'invoice.payment_failed':
        await handleInvoiceFailed(stripeEvent.data.object as Stripe.Invoice, supabase)
        break

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(stripeEvent.data.object as Stripe.Subscription, supabase)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(stripeEvent.data.object as Stripe.Subscription, supabase)
        break

      default:
        // Ignore unhandled event types
        break
    }
  } catch (err) {
    console.error(`[stripe/webhook] Error processing event ${stripeEvent.type}:`, err)
    throw createError({ statusCode: 500, statusMessage: 'Webhook processing failed' })
  }

  return { received: true }
})

// =============================================================================
// Handlers
// =============================================================================

/**
 * checkout.session.completed
 * Creates the organization for the user (if they don't have one yet),
 * assigns the admin role, and creates the subscription record.
 */
async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  stripe: ReturnType<typeof getStripe>
) {
  // Support multiple metadata key conventions:
  //   - user_id / user_email (explicit)
  //   - supabase_user_id (set by checkout.post.ts)
  //   - client_reference_id (Stripe standard field set by checkout.post.ts)
  const userId = session.metadata?.user_id
    || session.metadata?.supabase_user_id
    || session.client_reference_id
    || null
  const userEmail = session.metadata?.user_email || null

  if (!userId && !userEmail) {
    console.warn('[stripe/webhook] checkout.session.completed: no user identifier in metadata or client_reference_id')
    return
  }

  // ── Load user profile ────────────────────────────────────────────────────
  const profileQuery = supabase
    .from('user_profiles')
    .select('id, user_id, display_name, organization_id, role_id, email')

  const { data: profile } = userId
    ? await profileQuery.eq('user_id', userId).maybeSingle()
    : await profileQuery.eq('email', userEmail!).maybeSingle()

  if (!profile) {
    console.error(`[stripe/webhook] User profile not found for user_id=${userId} email=${userEmail}`)
    return
  }

  let organizationId = profile.organization_id as string | null

  // ── Create organization if the user doesn't have one yet ─────────────────
  if (!organizationId) {
    const orgName = `${(profile.display_name as string | null) || (profile.email as string | null) || userEmail || 'Oficina'}`

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: orgName,
        email: (profile.email as string | null) || userEmail || null,
        is_active: true,
        created_by: (profile.email as string | null) || userEmail || 'webhook'
      })
      .select('id')
      .single()

    if (orgError || !org) {
      console.error('[stripe/webhook] Failed to create organization:', orgError)
      return
    }

    organizationId = org.id
  }

  // ── Ensure default financial categories exist for this organization ─────
  await ensureDefaultFinancialCategories(
    supabase,
    organizationId,
    (profile.email as string | null) || userEmail || 'stripe-webhook'
  )

  // ── Ensure admin role exists for this organization ──────────────────────
  // roles.organization_id is NOT NULL, so every role must be org-scoped.
  // We upsert the admin role to avoid duplicates on retries.
  let roleId = profile.role_id as string | null

  const { data: existingAdminRole } = await supabase
    .from('roles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('name', 'admin')
    .maybeSingle()

  if (existingAdminRole) {
    roleId = existingAdminRole.id
  } else {
    const { data: newRole, error: roleError } = await supabase
      .from('roles')
      .insert({
        organization_id: organizationId,
        name: 'admin',
        display_name: 'Administrador',
        description: 'Acesso total ao sistema. Criado automaticamente na assinatura.',
        is_system_role: true,
        created_by: 'stripe-webhook'
      })
      .select('id')
      .single()

    if (roleError || !newRole) {
      console.error('[stripe/webhook] Failed to create admin role:', roleError)
    } else {
      roleId = newRole.id

      // Grant all existing actions to the admin role
      const { data: allActions } = await supabase.from('actions').select('id')
      if (allActions?.length) {
        await supabase.from('role_actions').insert(
          allActions.map(a => ({
            role_id: roleId!,
            action_id: a.id,
            is_granted: true,
            created_by: 'stripe-webhook'
          }))
        )
      }
    }
  }

  // ── Link org + role to user profile ─────────────────────────────────────
  await supabase
    .from('user_profiles')
    .update({
      organization_id: organizationId,
      role_id: roleId,
      updated_by: 'stripe-webhook'
    })
    .eq('id', profile.id)

  // ── Activate organization ────────────────────────────────────────────────
  await supabase
    .from('organizations')
    .update({ is_active: true })
    .eq('id', organizationId)

  // ── Resolve subscription details from Stripe ─────────────────────────────
  let stripeSubscriptionId: string | null = null
  let planName: string | null = null
  let monthlyAmount: number | null = null
  let nextPaymentDate: string | null = null
  let customerId = typeof session.customer === 'string' ? session.customer : null

  if (session.subscription) {
    const subId = typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription.id

    stripeSubscriptionId = subId

    try {
      const sub = await stripe.subscriptions.retrieve(subId, {
        expand: ['items.data.price.product']
      })

      const item = sub.items.data[0]
      const price = item?.price
      const product = price?.product

      planName = typeof product === 'object' && product !== null && 'name' in product
        ? (product as { name: string }).name
        : null

      monthlyAmount = price?.unit_amount ? price.unit_amount / 100 : null
      const periodEnd = getSubscriptionPeriodEnd(sub)
      nextPaymentDate = periodEnd
        ? new Date(periodEnd * 1000).toISOString()
        : null

      if (!customerId) {
        customerId = typeof sub.customer === 'string' ? sub.customer : null
      }
    } catch (err) {
      console.warn('[stripe/webhook] Could not retrieve subscription details:', err)
    }
  }

  // ── Create subscription record ────────────────────────────────────────────
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (existingSub) {
    await supabase
      .from('subscriptions')
      .update({
        status: 'active',
        stripe_customer_id: customerId,
        stripe_subscription_id: stripeSubscriptionId,
        plan_name: planName,
        monthly_amount: monthlyAmount,
        next_payment_date: nextPaymentDate,
        updated_by: 'stripe-webhook'
      })
      .eq('id', existingSub.id)
  } else {
    await supabase
      .from('subscriptions')
      .insert({
        organization_id: organizationId,
        user_email: (profile.email as string | null) || userEmail || '',
        status: 'active',
        stripe_customer_id: customerId,
        stripe_subscription_id: stripeSubscriptionId,
        plan_name: planName,
        monthly_amount: monthlyAmount,
        start_date: new Date().toISOString(),
        next_payment_date: nextPaymentDate,
        created_by: 'stripe-webhook'
      })
  }
}

// =============================================================================
// Subscription row resolver
// =============================================================================

function extractCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
): string | null {
  if (!customer) return null
  return typeof customer === 'string' ? customer : customer.id
}

/**
 * Resolves the subscriptions row for a given Stripe subscription / customer.
 * Lookup order:
 *   1. stripe_subscription_id  (fast path — normal flow)
 *   2. stripe_customer_id      (fallback when subscription wasn't yet recorded)
 *      → also patches stripe_subscription_id on the found row if it was missing
 *   3. user_profiles.stripe_customer_id → bootstraps a new subscription row
 *      so that subsequent events don't silently no-op either.
 */
async function resolveSubscriptionRow(
  supabase: SupabaseClient,
  stripeSubscriptionId: string | null,
  stripeCustomerId: string | null
): Promise<SubRow | null> {
  // 1. Exact match by subscription ID
  if (stripeSubscriptionId) {
    const { data } = await supabase
      .from('subscriptions')
      .select('id, organization_id')
      .eq('stripe_subscription_id', stripeSubscriptionId)
      .is('deleted_at', null)
      .maybeSingle<SubRow>()
    if (data) return data
  }

  // 2. Fallback by customer ID
  if (!stripeCustomerId) return null

  const { data: byCustomer } = await supabase
    .from('subscriptions')
    .select('id, organization_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<SubRow>()

  if (byCustomer) {
    // Patch the missing stripe_subscription_id so future lookups hit path 1
    if (stripeSubscriptionId) {
      await supabase
        .from('subscriptions')
        .update({ stripe_subscription_id: stripeSubscriptionId, updated_by: 'stripe-webhook' })
        .eq('id', byCustomer.id)
    }
    return byCustomer
  }

  // 3. Bootstrap from user_profiles — handles cases where checkout.session.completed
  //    was missed or failed before the subscription row was created.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id, email')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle<{ organization_id: string | null, email: string | null }>()

  if (!profile?.organization_id) {
    console.warn(`[stripe/webhook] resolveSubscriptionRow: no profile found for customer ${stripeCustomerId}`)
    return null
  }

  const { data: newSub, error: insertError } = await supabase
    .from('subscriptions')
    .insert({
      organization_id: profile.organization_id,
      user_email: profile.email || '',
      status: 'active',
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      start_date: new Date().toISOString(),
      created_by: 'stripe-webhook'
    })
    .select('id, organization_id')
    .single<SubRow>()

  if (insertError) {
    console.error('[stripe/webhook] resolveSubscriptionRow: failed to bootstrap subscription:', insertError)
    return null
  }

  return newSub ?? null
}

/**
 * invoice.payment_succeeded / invoice.paid
 * Ensures the organization stays active when a payment goes through.
 */
async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  supabase: SupabaseClient
) {
  const subscriptionId = getInvoiceSubscriptionId(invoice)
  const customerId = extractCustomerId(invoice.customer)

  const sub = await resolveSubscriptionRow(supabase, subscriptionId, customerId)
  if (!sub) return

  await Promise.all([
    supabase
      .from('subscriptions')
      .update({ status: 'active', updated_by: 'stripe-webhook' })
      .eq('id', sub.id),
    supabase
      .from('organizations')
      .update({ is_active: true, updated_by: 'stripe-webhook' })
      .eq('id', sub.organization_id)
  ])
}

/**
 * invoice.payment_failed
 * Suspends the subscription when a payment fails.
 */
async function handleInvoiceFailed(
  invoice: Stripe.Invoice,
  supabase: SupabaseClient
) {
  const subscriptionId = getInvoiceSubscriptionId(invoice)
  const customerId = extractCustomerId(invoice.customer)

  const sub = await resolveSubscriptionRow(supabase, subscriptionId, customerId)
  if (!sub) return

  await supabase
    .from('subscriptions')
    .update({ status: 'suspended', updated_by: 'stripe-webhook' })
    .eq('id', sub.id)
}

/**
 * customer.subscription.updated
 * Syncs subscription status and next payment date with Stripe.
 */
async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
  supabase: SupabaseClient
) {
  const customerId = extractCustomerId(subscription.customer)
  const sub = await resolveSubscriptionRow(supabase, subscription.id, customerId)
  if (!sub) return

  const statusMap: Record<string, string> = {
    active: 'active',
    trialing: 'active',
    past_due: 'suspended',
    unpaid: 'suspended',
    canceled: 'cancelled',
    incomplete: 'suspended',
    incomplete_expired: 'cancelled',
    paused: 'suspended'
  }

  const newStatus = statusMap[subscription.status] ?? 'suspended'
  const isActive = newStatus === 'active'
  const periodEnd = getSubscriptionPeriodEnd(subscription)

  await Promise.all([
    supabase
      .from('subscriptions')
      .update({
        status: newStatus,
        next_payment_date: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        updated_by: 'stripe-webhook'
      })
      .eq('id', sub.id),
    supabase
      .from('organizations')
      .update({ is_active: isActive, updated_by: 'stripe-webhook' })
      .eq('id', sub.organization_id)
  ])

  if (newStatus === 'cancelled') {
    await deleteFocusNfeCompanyForOrg(sub.organization_id)
  }
}

/**
 * customer.subscription.deleted
 * Marks subscription as cancelled and deactivates the organization.
 */
async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  supabase: SupabaseClient
) {
  const customerId = extractCustomerId(subscription.customer)
  const sub = await resolveSubscriptionRow(supabase, subscription.id, customerId)
  if (!sub) return

  await Promise.all([
    supabase
      .from('subscriptions')
      .update({
        status: 'cancelled',
        cancellation_date: new Date().toISOString(),
        updated_by: 'stripe-webhook'
      })
      .eq('id', sub.id),
    supabase
      .from('organizations')
      .update({ is_active: false, updated_by: 'stripe-webhook' })
      .eq('id', sub.organization_id)
  ])

  await deleteFocusNfeCompanyForOrg(sub.organization_id)
}
