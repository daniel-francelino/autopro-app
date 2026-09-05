import Stripe from 'npm:stripe@20.4.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

type Env = {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
}

type OrgSubscriptionRow = {
  id: string
  organization_id: string
  user_email: string | null
  stripe_customer_id: string | null
}

type StripeInvoicePaymentLike = {
  id?: string
  invoice?: string | { id?: string | null } | null
}

const SUBSCRIPTION_STATUS_MAP: Record<string, string> = {
  active: 'active',
  trialing: 'active',
  past_due: 'suspended',
  unpaid: 'suspended',
  canceled: 'cancelled',
  incomplete: 'suspended',
  incomplete_expired: 'cancelled',
  paused: 'suspended'
}

const INVOICE_STATUS_MAP: Record<string, string | null> = {
  'invoice.created': 'draft',
  'invoice.finalized': 'open',
  'invoice.finalization_failed': 'finalization_failed',
  'invoice.paid': 'paid',
  'invoice.payment_succeeded': 'paid',
  'invoice.payment_failed': 'failed',
  'invoice.payment_action_required': 'action_required',
  'invoice.payment_attempt_required': 'pending',
  'invoice.overdue': 'overdue',
  'invoice.overpaid': 'paid',
  'invoice.marked_uncollectible': 'uncollectible',
  'invoice.voided': 'voided',
  'invoice.sent': 'open',
  'invoice.updated': null,
  'invoice.will_be_due': null
}

const STRIPE_INVOICE_STATUS_FALLBACK_MAP: Record<string, string> = {
  draft: 'draft',
  open: 'open',
  paid: 'paid',
  uncollectible: 'uncollectible',
  void: 'voided'
}

const ORG_ACTIVATING_INVOICE_STATUSES = new Set(['paid'])
const ORG_SUSPENDING_INVOICE_STATUSES = new Set(['failed', 'overdue', 'action_required'])
const ORG_CANCELLING_INVOICE_STATUSES = new Set(['uncollectible'])
const BILLING_LINK_PATH = '/app/settings/subscription'

const PLAN_KEY_BY_PRICE_ID: Record<string, string> = {
  [Deno.env.get('STRIPE_PRICE_ID_STARTER') ?? '']: 'starter',
  [Deno.env.get('STRIPE_PRICE_ID_PRO') ?? '']: 'pro',
  [Deno.env.get('STRIPE_PRICE_ID_FISCAL') ?? '']: 'fiscal'
}

function resolvePlanKey(priceId: string | null | undefined): string | null {
  if (!priceId) return null
  return PLAN_KEY_BY_PRICE_ID[priceId] ?? null
}

function getEnv(): Env {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')
  const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET)
    throw new Error('Missing required environment variables')

  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET }
}

function toIso(seconds: number | null | undefined): string | null {
  if (!seconds)
    return null

  return new Date(seconds * 1000).toISOString()
}

function toCurrencyAmount(amount: number | null | undefined): number | null {
  if (amount === null || amount === undefined)
    return null

  return amount / 100
}

function resolveLocalSubscriptionStatus(status: string | null | undefined) {
  if (!status)
    return 'suspended'

  return SUBSCRIPTION_STATUS_MAP[status] ?? 'suspended'
}

function resolveInvoiceLifecycleStatus(eventType: string, invoice: Stripe.Invoice) {
  const explicitStatus = INVOICE_STATUS_MAP[eventType]
  if (explicitStatus)
    return explicitStatus

  if (explicitStatus === null && invoice.status)
    return STRIPE_INVOICE_STATUS_FALLBACK_MAP[invoice.status] ?? invoice.status

  if (invoice.status)
    return STRIPE_INVOICE_STATUS_FALLBACK_MAP[invoice.status] ?? invoice.status

  return null
}

function getInvoiceIdFromPayment(payment: StripeInvoicePaymentLike) {
  if (!payment.invoice)
    return null

  return typeof payment.invoice === 'string'
    ? payment.invoice
    : payment.invoice.id ?? null
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  const subscription = invoice.parent?.subscription_details?.subscription
  if (!subscription)
    return null

  return typeof subscription === 'string'
    ? subscription
    : subscription.id
}

function getSubscriptionPeriodStart(subscription: Stripe.Subscription) {
  return subscription.items.data[0]?.current_period_start ?? null
}

function getSubscriptionPeriodEnd(subscription: Stripe.Subscription) {
  return subscription.items.data[0]?.current_period_end ?? null
}

async function resolveUserId(
  supabase: ReturnType<typeof createClient>,
  opts: { clientReferenceId?: string | null, userIdMeta?: string | null, stripeCustomerId?: string | null }
): Promise<string | null> {
  const explicit = opts.clientReferenceId || opts.userIdMeta
  if (explicit)
    return explicit

  if (opts.stripeCustomerId) {
    const { data } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('stripe_customer_id', opts.stripeCustomerId)
      .maybeSingle<{ user_id: string }>()

    if (data?.user_id)
      return data.user_id

    const { data: sc } = await supabase
      .from('stripe_customers')
      .select('user_id')
      .eq('stripe_customer_id', opts.stripeCustomerId)
      .maybeSingle<{ user_id: string }>()

    if (sc?.user_id)
      return sc.user_id
  }

  return null
}

async function resolveUserEmail(
  supabase: ReturnType<typeof createClient>,
  userId: string | null
) {
  if (!userId)
    return null

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('user_id', userId)
    .maybeSingle<{ email: string | null }>()

  return profile?.email ?? null
}

async function syncLegacyCustomerMapping(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  customerId: string
) {
  await supabase
    .from('user_profiles')
    .update({ stripe_customer_id: customerId })
    .eq('user_id', userId)

  await supabase
    .from('stripe_customers')
    .upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: 'user_id' })
    .then(() => {})
    .catch(() => {})
}

async function findOrgSubscriptionByStripeRefs(
  supabase: ReturnType<typeof createClient>,
  opts: { stripeSubscriptionId?: string | null, stripeCustomerId?: string | null }
) {
  if (opts.stripeSubscriptionId) {
    const { data } = await supabase
      .from('subscriptions')
      .select('id, organization_id, user_email, stripe_customer_id')
      .eq('stripe_subscription_id', opts.stripeSubscriptionId)
      .maybeSingle<OrgSubscriptionRow>()

    if (data)
      return data
  }

  if (opts.stripeCustomerId) {
    const { data } = await supabase
      .from('subscriptions')
      .select('id, organization_id, user_email, stripe_customer_id')
      .eq('stripe_customer_id', opts.stripeCustomerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<OrgSubscriptionRow>()

    if (data)
      return data
  }

  return null
}

async function setOrganizationStateFromInvoice(
  supabase: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice,
  localStatus: string | null
) {
  if (!localStatus)
    return

  const stripeSubscriptionId = getInvoiceSubscriptionId(invoice)
  const stripeCustomerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id ?? null

  const orgSub = await findOrgSubscriptionByStripeRefs(supabase, {
    stripeSubscriptionId,
    stripeCustomerId
  })

  if (!orgSub)
    return

  if (ORG_ACTIVATING_INVOICE_STATUSES.has(localStatus)) {
    await Promise.all([
      supabase
        .from('subscriptions')
        .update({
          status: 'active',
          cancellation_date: null,
          updated_by: 'stripe-webhook'
        })
        .eq('id', orgSub.id),
      supabase
        .from('organizations')
        .update({
          is_active: true,
          updated_by: 'stripe-webhook'
        })
        .eq('id', orgSub.organization_id)
    ])
    return
  }

  if (ORG_SUSPENDING_INVOICE_STATUSES.has(localStatus)) {
    await Promise.all([
      supabase
        .from('subscriptions')
        .update({
          status: 'suspended',
          updated_by: 'stripe-webhook'
        })
        .eq('id', orgSub.id),
      supabase
        .from('organizations')
        .update({
          is_active: false,
          updated_by: 'stripe-webhook'
        })
        .eq('id', orgSub.organization_id)
    ])
    return
  }

  if (ORG_CANCELLING_INVOICE_STATUSES.has(localStatus)) {
    await Promise.all([
      supabase
        .from('subscriptions')
        .update({
          status: 'cancelled',
          cancellation_date: new Date().toISOString(),
          updated_by: 'stripe-webhook'
        })
        .eq('id', orgSub.id),
      supabase
        .from('organizations')
        .update({
          is_active: false,
          updated_by: 'stripe-webhook'
        })
        .eq('id', orgSub.organization_id)
    ])
  }
}

// The 9 default category rows seeded per organization (8 names — 'Outros'
// exists once per type). Kept in sync by hand with
// server/utils/financial-category-defaults.ts (the Nuxt route's copy) since
// this Deno function can't import a Node module — see
// docs/finance/financial-categories-crud.md, sections 2.7/3.5/3.6.
const DEFAULT_FINANCIAL_CATEGORIES = [
  { name: 'Vendas', type: 'income', icon: 'i-lucide-shopping-cart', color: '#22c55e' },
  { name: 'Serviços', type: 'income', icon: 'i-lucide-wrench', color: '#3b82f6' },
  { name: 'Outros', type: 'income', icon: 'i-lucide-circle-dollar-sign', color: '#64748b' },
  { name: 'Aluguel', type: 'expense', icon: 'i-lucide-building-2', color: '#8b5cf6' },
  { name: 'Salários', type: 'expense', icon: 'i-lucide-users', color: '#f97316' },
  { name: 'Fornecedores', type: 'expense', icon: 'i-lucide-package', color: '#22c55e' },
  { name: 'Impostos', type: 'expense', icon: 'i-lucide-landmark', color: '#ef4444' },
  { name: 'Marketing', type: 'expense', icon: 'i-lucide-megaphone', color: '#ec4899' },
  { name: 'Outros', type: 'expense', icon: 'i-lucide-folder-open', color: '#64748b' }
]

async function ensureDefaultFinancialCategories(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  createdBy: string
) {
  const { count } = await supabase
    .from('financial_categories')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('is_default', true)

  if (count) return

  const { error } = await supabase.from('financial_categories').insert(
    DEFAULT_FINANCIAL_CATEGORIES.map(category => ({
      organization_id: organizationId,
      name: category.name,
      type: category.type,
      icon: category.icon,
      color: category.color,
      is_default: true,
      created_by: createdBy
    }))
  )

  if (error)
    console.error('[stripe-webhook] Failed to create default financial categories:', error.message)
}

async function ensureOrganization(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  userEmail: string | null
): Promise<string | null> {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, organization_id, role_id, display_name, email')
    .eq('user_id', userId)
    .maybeSingle<{
    id: string
    organization_id: string | null
    role_id: string | null
    display_name: string | null
    email: string | null
  }>()

  if (!profile) {
    console.error(`[stripe-webhook] User profile not found for user_id=${userId}`)
    return null
  }

  if (profile.organization_id)
    return profile.organization_id

  const email = profile.email || userEmail || null
  const displayName = profile.display_name || email?.split('@')[0] || 'Oficina'

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .insert({
      name: displayName,
      email,
      is_active: true,
      created_by: 'stripe-webhook'
    })
    .select('id')
    .single<{ id: string }>()

  if (orgErr || !org) {
    console.error('[stripe-webhook] Failed to create organization:', orgErr?.message)
    return null
  }

  await ensureDefaultFinancialCategories(supabase, org.id, 'stripe-webhook')

  let roleId = profile.role_id

  // 1. Org-specific admin role (already exists for this org)
  const { data: existingOrgRole } = await supabase
    .from('roles')
    .select('id')
    .eq('organization_id', org.id)
    .eq('name', 'admin')
    .maybeSingle<{ id: string }>()

  if (existingOrgRole) {
    roleId = existingOrgRole.id
  } else {
    // 2. Global admin role (organization_id IS NULL) — preferred, no duplication needed
    const { data: globalAdminRole } = await supabase
      .from('roles')
      .select('id')
      .is('organization_id', null)
      .eq('name', 'admin')
      .maybeSingle<{ id: string }>()

    if (globalAdminRole) {
      roleId = globalAdminRole.id
    } else {
      // 3. Fallback: create an org-scoped admin role with all permissions
      const { data: newRole, error: roleErr } = await supabase
        .from('roles')
        .insert({
          organization_id: org.id,
          name: 'admin',
          display_name: 'Administrador',
          description: 'Acesso total ao sistema. Criado automaticamente na assinatura.',
          is_system_role: true,
          created_by: 'stripe-webhook'
        })
        .select('id')
        .single<{ id: string }>()

      if (roleErr || !newRole) {
        console.error('[stripe-webhook] Failed to create admin role:', roleErr?.message)
      } else {
        roleId = newRole.id

        const { data: allActions } = await supabase.from('actions').select('id')
        if (allActions?.length) {
          await supabase.from('role_actions').insert(
            (allActions as { id: string }[]).map(action => ({
              role_id: roleId!,
              action_id: action.id,
              is_granted: true,
              created_by: 'stripe-webhook'
            }))
          )
        }
      }
    }
  }

  await supabase
    .from('user_profiles')
    .update({
      organization_id: org.id,
      role_id: roleId,
      updated_by: 'stripe-webhook'
    })
    .eq('id', profile.id)

  console.log(`[stripe-webhook] Organization created and linked: ${org.id} -> user ${userId}`)
  return org.id
}

async function upsertOrgSubscription(
  supabase: ReturnType<typeof createClient>,
  opts: {
    organizationId: string
    userEmail: string | null
    status: string
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    planName: string | null
    planKey: string | null
    monthlyAmount: number | null
    startDate: string | null
    nextPaymentDate: string | null
    cancellationDate?: string | null
  }
) {
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('organization_id', opts.organizationId)
    .maybeSingle<{ id: string }>()

  if (existing) {
    await supabase
      .from('subscriptions')
      .update({
        status: opts.status,
        stripe_customer_id: opts.stripeCustomerId,
        stripe_subscription_id: opts.stripeSubscriptionId,
        plan_name: opts.planName,
        plan_key: opts.planKey,
        monthly_amount: opts.monthlyAmount,
        start_date: opts.startDate,
        next_payment_date: opts.nextPaymentDate,
        cancellation_date: opts.cancellationDate ?? null,
        updated_by: 'stripe-webhook'
      })
      .eq('id', existing.id)
  } else {
    await supabase
      .from('subscriptions')
      .insert({
        organization_id: opts.organizationId,
        user_email: opts.userEmail || '',
        status: opts.status,
        stripe_customer_id: opts.stripeCustomerId,
        stripe_subscription_id: opts.stripeSubscriptionId,
        plan_name: opts.planName,
        plan_key: opts.planKey,
        monthly_amount: opts.monthlyAmount,
        start_date: opts.startDate,
        next_payment_date: opts.nextPaymentDate,
        cancellation_date: opts.cancellationDate ?? null,
        created_by: 'stripe-webhook'
      })
  }
}

async function upsertStripeSubscription(
  supabase: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription,
  userId: string | null
) {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id ?? null

  const resolvedUserId = userId
    || subscription.metadata?.user_id
    || subscription.metadata?.supabase_user_id
    || null

  if (!resolvedUserId)
    return

  if (customerId)
    await syncLegacyCustomerMapping(supabase, resolvedUserId, customerId)

  const item = subscription.items.data?.[0]

  await supabase
    .from('stripe_subscriptions')
    .upsert({
      user_id: resolvedUserId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      price_id: item?.price?.id ?? null,
      quantity: item?.quantity ?? null,
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      current_period_start: toIso(getSubscriptionPeriodStart(subscription)),
      current_period_end: toIso(getSubscriptionPeriodEnd(subscription)),
      canceled_at: toIso(subscription.canceled_at),
      metadata: subscription.metadata ?? {}
    }, { onConflict: 'stripe_subscription_id' })
}

async function upsertStripeInvoice(
  supabase: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice,
  explicitStatus?: string | null
) {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id ?? null

  if (!customerId)
    return null

  const userId = await resolveUserId(supabase, { stripeCustomerId: customerId })
  if (!userId)
    return null

  const subId = getInvoiceSubscriptionId(invoice)
  const line = invoice.lines?.data?.[0]

  await supabase
    .from('stripe_invoices')
    .upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subId,
      stripe_invoice_id: invoice.id,
      status: explicitStatus ?? invoice.status ?? null,
      currency: invoice.currency ?? null,
      total: invoice.total ?? null,
      amount_due: invoice.amount_due ?? null,
      amount_paid: invoice.amount_paid ?? null,
      amount_remaining: invoice.amount_remaining ?? null,
      invoice_number: invoice.number ?? null,
      hosted_invoice_url: invoice.hosted_invoice_url ?? null,
      invoice_pdf: invoice.invoice_pdf ?? null,
      collection_method: invoice.collection_method ?? null,
      due_date: toIso(invoice.due_date),
      period_start: toIso(line?.period?.start),
      period_end: toIso(line?.period?.end),
      paid: explicitStatus === 'paid' ? true : invoice.paid ?? null,
      created: toIso(invoice.created),
      data: invoice as unknown as Record<string, unknown>
    }, { onConflict: 'stripe_invoice_id' })

  return userId
}

async function upsertBillingInvoice(
  supabase: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice,
  eventType: string,
  localStatus: string | null,
  userId: string | null
) {
  if (!invoice.id)
    return

  const stripeSubscriptionId = getInvoiceSubscriptionId(invoice)
  const stripeCustomerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id ?? null

  const orgSub = await findOrgSubscriptionByStripeRefs(supabase, {
    stripeSubscriptionId,
    stripeCustomerId
  })

  if (!orgSub)
    return

  const resolvedUserEmail = orgSub.user_email
    || invoice.customer_email
    || await resolveUserEmail(supabase, userId)

  if (!resolvedUserEmail)
    return

  const line = invoice.lines?.data?.[0]
  const now = new Date().toISOString()
  const payload: Record<string, unknown> = {
    organization_id: orgSub.organization_id,
    user_email: resolvedUserEmail,
    stripe_invoice_id: invoice.id,
    amount: toCurrencyAmount(invoice.total) ?? 0,
    status: localStatus ?? 'pending',
    subscription_id: orgSub.id,
    stripe_subscription_id: stripeSubscriptionId,
    stripe_customer_id: stripeCustomerId,
    invoice_number: invoice.number ?? null,
    issue_date: toIso(invoice.status_transitions?.finalized_at) ?? toIso(invoice.created),
    due_date: toIso(invoice.due_date),
    payment_date: toIso(invoice.status_transitions?.paid_at) ?? (localStatus === 'paid' ? now : null),
    pdf_url: invoice.invoice_pdf ?? null,
    description: line?.description ?? null,
    amount_overpaid: toCurrencyAmount(invoice.amount_overpaid),
    collection_method: invoice.collection_method ?? null,
    period_start: toIso(line?.period?.start),
    period_end: toIso(line?.period?.end),
    attempt_count: invoice.attempt_count ?? 0,
    next_payment_attempt: toIso(invoice.next_payment_attempt),
    hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    raw_data: invoice as unknown as Record<string, unknown>,
    updated_by: 'stripe-webhook',
    created_by: 'stripe-webhook'
  }

  if (eventType === 'invoice.sent')
    payload.sent_at = now

  const { data: existing, error: existingError } = await supabase
    .from('billing_invoices')
    .select('id')
    .eq('stripe_invoice_id', invoice.id)
    .maybeSingle<{ id: string }>()

  if (existingError) {
    console.warn('[stripe-webhook] Failed to look up billing_invoices row:', existingError.message)
    return
  }

  if (existing) {
    const { error } = await supabase
      .from('billing_invoices')
      .update(payload)
      .eq('id', existing.id)

    if (error)
      console.warn('[stripe-webhook] Failed to update billing_invoices row:', error.message)

    return
  }

  const { error } = await supabase
    .from('billing_invoices')
    .insert(payload)

  if (error)
    console.warn('[stripe-webhook] Failed to insert billing_invoices row:', error.message)
}

async function softDeleteBillingInvoice(
  supabase: ReturnType<typeof createClient>,
  stripeInvoiceId: string
) {
  const { error } = await supabase
    .from('billing_invoices')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: 'stripe-webhook',
      updated_by: 'stripe-webhook'
    })
    .eq('stripe_invoice_id', stripeInvoiceId)

  if (error)
    console.warn('[stripe-webhook] Failed to soft-delete billing invoice:', error.message)
}

async function sendNotification(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: string,
  linkPath: string,
  metadata: Record<string, unknown> = {}
) {
  try {
    await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type: 'system',
        body,
        link_path: linkPath,
        sender_name: 'beenk',
        metadata
      })
  } catch {
    // Best effort only.
  }
}

async function sendInvoiceEventNotification(
  supabase: ReturnType<typeof createClient>,
  eventType: string,
  invoice: Stripe.Invoice,
  userId: string | null
) {
  if (!userId)
    return

  let body: string | null = null

  switch (eventType) {
    case 'invoice.paid':
      body = 'Pagamento confirmado. Sua fatura esta disponivel.'
      break
    case 'invoice.payment_failed':
      body = 'Falha no pagamento. Atualize sua forma de pagamento.'
      break
    case 'invoice.payment_action_required':
      body = 'Sua cobranca exige autenticacao adicional para continuar.'
      break
    case 'invoice.payment_attempt_required':
      body = 'A cobranca precisa de uma nova tentativa. Revise seu metodo de pagamento.'
      break
    case 'invoice.upcoming':
      body = 'Sua proxima fatura sera gerada em breve.'
      break
    case 'invoice.will_be_due':
      body = 'Sua fatura vence em breve.'
      break
    case 'invoice.overdue':
      body = 'Sua fatura esta vencida. Regularize o pagamento para evitar bloqueio.'
      break
    case 'invoice.marked_uncollectible':
      body = 'Sua fatura foi marcada como incobravel. Fale com o suporte para regularizar.'
      break
    default:
      break
  }

  if (!body)
    return

  await sendNotification(supabase, userId, body, BILLING_LINK_PATH, {
    event_type: eventType,
    stripe_invoice_id: invoice.id,
    stripe_customer_id: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null,
    stripe_subscription_id: getInvoiceSubscriptionId(invoice)
  })
}

async function onCheckoutCompleted(
  session: Stripe.Checkout.Session,
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe
) {
  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id ?? null
  const subId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id ?? null

  const userId = await resolveUserId(supabase, {
    clientReferenceId: session.client_reference_id,
    userIdMeta: session.metadata?.user_id || session.metadata?.supabase_user_id,
    stripeCustomerId: customerId
  })

  if (!userId) {
    console.error('[stripe-webhook] checkout.session.completed: could not resolve user_id')
    return
  }

  const userEmail = session.metadata?.user_email ?? session.customer_email ?? null

  if (customerId)
    await syncLegacyCustomerMapping(supabase, userId, customerId)

  const organizationId = await ensureOrganization(supabase, userId, userEmail)
  if (!organizationId)
    return

  await supabase
    .from('organizations')
    .update({
      is_active: true,
      updated_by: 'stripe-webhook'
    })
    .eq('id', organizationId)

  if (subId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subId, {
        expand: ['items.data.price.product']
      })

      await upsertStripeSubscription(supabase, sub, userId)

      const item = sub.items.data[0]
      const price = item?.price
      const product = price?.product
      const planName = typeof product === 'object' && product !== null && 'name' in product
        ? (product as { name: string }).name
        : null
      const planKey = resolvePlanKey(price?.id)

      await upsertOrgSubscription(supabase, {
        organizationId,
        userEmail,
        status: 'active',
        stripeCustomerId: customerId,
        stripeSubscriptionId: subId,
        planName,
        planKey,
        monthlyAmount: price?.unit_amount ? price.unit_amount / 100 : null,
        startDate: toIso(getSubscriptionPeriodStart(sub)),
        nextPaymentDate: toIso(getSubscriptionPeriodEnd(sub)),
        cancellationDate: null
      })
    } catch (err) {
      console.warn('[stripe-webhook] Could not retrieve subscription details:', err)
    }
  }

  await sendNotification(supabase, userId, 'Sua assinatura foi ativada. Bem-vindo!', BILLING_LINK_PATH, {
    stripe_subscription_id: subId,
    stripe_customer_id: customerId
  })
}

async function onSubscriptionEvent(
  subscription: Stripe.Subscription,
  eventType: string,
  supabase: ReturnType<typeof createClient>
) {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id ?? null

  const userId = await resolveUserId(supabase, {
    userIdMeta: subscription.metadata?.user_id || subscription.metadata?.supabase_user_id,
    stripeCustomerId: customerId
  })

  await upsertStripeSubscription(supabase, subscription, userId)

  let orgSub = await findOrgSubscriptionByStripeRefs(supabase, {
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId
  })

  if (!orgSub && userId && eventType === 'customer.subscription.created') {
    const userEmail = await resolveUserEmail(supabase, userId)
    const organizationId = await ensureOrganization(supabase, userId, userEmail)

    if (organizationId) {
      const item = subscription.items.data?.[0]
      const price = item?.price
      const product = price?.product
      const planName = typeof product === 'object' && product !== null && 'name' in product
        ? (product as { name: string }).name
        : null
      const planKey = resolvePlanKey(price?.id)

      await upsertOrgSubscription(supabase, {
        organizationId,
        userEmail,
        status: resolveLocalSubscriptionStatus(subscription.status),
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        planName,
        planKey,
        monthlyAmount: price?.unit_amount ? price.unit_amount / 100 : null,
        startDate: toIso(getSubscriptionPeriodStart(subscription)),
        nextPaymentDate: toIso(getSubscriptionPeriodEnd(subscription)),
        cancellationDate: subscription.status === 'canceled'
          ? toIso(subscription.canceled_at) ?? new Date().toISOString()
          : null
      })

      orgSub = await findOrgSubscriptionByStripeRefs(supabase, {
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: customerId
      })
    }
  }

  if (orgSub) {
    const newStatus = resolveLocalSubscriptionStatus(subscription.status)
    const isActive = newStatus === 'active'

    await Promise.all([
      supabase
        .from('subscriptions')
        .update({
          status: newStatus,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
          next_payment_date: toIso(getSubscriptionPeriodEnd(subscription)),
          cancellation_date: newStatus === 'cancelled' ? toIso(subscription.canceled_at) ?? new Date().toISOString() : null,
          updated_by: 'stripe-webhook'
        })
        .eq('id', orgSub.id),
      supabase
        .from('organizations')
        .update({
          is_active: isActive,
          updated_by: 'stripe-webhook'
        })
        .eq('id', orgSub.organization_id)
    ])
  }

  if (!userId)
    return

  if (eventType === 'customer.subscription.deleted') {
    await sendNotification(supabase, userId, 'Sua assinatura foi cancelada.', BILLING_LINK_PATH, {
      stripe_subscription_id: subscription.id
    })
  }

  if (eventType === 'customer.subscription.updated' && subscription.cancel_at_period_end) {
    await sendNotification(supabase, userId, 'Cancelamento agendado para o fim do periodo de cobranca.', BILLING_LINK_PATH, {
      stripe_subscription_id: subscription.id
    })
  }

  if (eventType === 'customer.subscription.pending_update_expired') {
    await sendNotification(supabase, userId, 'Uma alteracao pendente da assinatura expirou antes da confirmacao.', BILLING_LINK_PATH, {
      stripe_subscription_id: subscription.id
    })
  }
}

async function onInvoiceEvent(
  invoice: Stripe.Invoice,
  eventType: string,
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe
) {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id ?? null
  const userId = await resolveUserId(supabase, { stripeCustomerId: customerId })

  if (eventType === 'invoice.upcoming') {
    await sendInvoiceEventNotification(supabase, eventType, invoice, userId)
    return
  }

  if (eventType === 'invoice.deleted') {
    await softDeleteBillingInvoice(supabase, invoice.id)
    return
  }

  const localStatus = resolveInvoiceLifecycleStatus(eventType, invoice)
  const resolvedUserId = await upsertStripeInvoice(supabase, invoice, localStatus) ?? userId

  await upsertBillingInvoice(supabase, invoice, eventType, localStatus, resolvedUserId)

  const subId = getInvoiceSubscriptionId(invoice)

  if (subId && (eventType === 'invoice.paid' || eventType === 'invoice.payment_succeeded')) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subId)
      const subscriptionUserId = await resolveUserId(supabase, {
        userIdMeta: subscription.metadata?.user_id || subscription.metadata?.supabase_user_id,
        stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id ?? null
      })
      await upsertStripeSubscription(supabase, subscription, subscriptionUserId)
    } catch (err) {
      console.warn('[stripe-webhook] Could not refresh subscription after invoice payment:', err)
    }
  }

  await setOrganizationStateFromInvoice(supabase, invoice, localStatus)
  await sendInvoiceEventNotification(supabase, eventType, invoice, resolvedUserId)
}

async function confirmInvoicePayment(
  supabase: ReturnType<typeof createClient>,
  payment: StripeInvoicePaymentLike
) {
  const invoiceId = getInvoiceIdFromPayment(payment)
  if (!invoiceId)
    return

  await supabase
    .from('stripe_invoices')
    .update({
      status: 'paid',
      paid: true
    })
    .eq('stripe_invoice_id', invoiceId)

  await supabase
    .from('billing_invoices')
    .update({
      status: 'paid',
      payment_date: new Date().toISOString(),
      updated_by: 'stripe-webhook'
    })
    .eq('stripe_invoice_id', invoiceId)

  const { data: invoiceRow } = await supabase
    .from('stripe_invoices')
    .select('stripe_subscription_id, stripe_customer_id')
    .eq('stripe_invoice_id', invoiceId)
    .maybeSingle<{ stripe_subscription_id: string | null, stripe_customer_id: string | null }>()

  const orgSub = await findOrgSubscriptionByStripeRefs(supabase, {
    stripeSubscriptionId: invoiceRow?.stripe_subscription_id,
    stripeCustomerId: invoiceRow?.stripe_customer_id
  })

  if (!orgSub)
    return

  await Promise.all([
    supabase
      .from('subscriptions')
      .update({
        status: 'active',
        cancellation_date: null,
        updated_by: 'stripe-webhook'
      })
      .eq('id', orgSub.id),
    supabase
      .from('organizations')
      .update({
        is_active: true,
        updated_by: 'stripe-webhook'
      })
      .eq('id', orgSub.organization_id)
  ])
}

Deno.serve(async (req) => {
  try {
    const env = getEnv()
    const cryptoProvider = Stripe.createSubtleCryptoProvider()

    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient()
    })

    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

    const signature = req.headers.get('stripe-signature')
    if (!signature)
      return new Response('Missing stripe-signature', { status: 400 })

    const payload = await req.text()
    let event: Stripe.Event

    try {
      event = await stripe.webhooks.constructEventAsync(
        payload,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
        undefined,
        cryptoProvider
      )
    } catch {
      return new Response('Invalid signature', { status: 400 })
    }

    console.log(`[stripe-webhook] Event: ${event.type} (${event.id})`)

    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session, supabase, stripe)
        break

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.pending_update_expired':
        await onSubscriptionEvent(event.data.object as Stripe.Subscription, event.type, supabase)
        break

      case 'invoice.created':
      case 'invoice.finalized':
      case 'invoice.finalization_failed':
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed':
      case 'invoice.payment_action_required':
      case 'invoice.payment_attempt_required':
      case 'invoice.upcoming':
      case 'invoice.will_be_due':
      case 'invoice.overdue':
      case 'invoice.overpaid':
      case 'invoice.marked_uncollectible':
      case 'invoice.voided':
      case 'invoice.deleted':
      case 'invoice.sent':
      case 'invoice.updated':
        await onInvoiceEvent(event.data.object as Stripe.Invoice, event.type, supabase, stripe)
        break

      case 'invoice_payment.paid':
        await confirmInvoicePayment(supabase, event.data.object as StripeInvoicePaymentLike)
        break

      case 'invoiceitem.created':
      case 'invoiceitem.deleted':
        console.log(`[stripe-webhook] Audit event: ${event.type}`)
        break

      default:
        if (event.type.startsWith('invoice.'))
          await onInvoiceEvent(event.data.object as Stripe.Invoice, event.type, supabase, stripe)
        break
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'content-type': 'application/json' }
    })
  } catch (err) {
    console.error('[stripe-webhook] Unhandled error:', err)
    return new Response('Internal error', { status: 500 })
  }
})
