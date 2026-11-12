import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { getStripe } from '../../utils/stripe'
import { resolveOrganizationId } from '../../utils/organization'
import { deleteFocusNfeCompanyForOrg } from '../../utils/focus-nfe'

/**
 * POST /api/stripe/cancel-subscription
 * Cancels the user's Stripe subscription at end of period and deactivates organization.
 * Migrated from: supabase/functions/cancelarAssinatura
 */
export default eventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'subscription.manage', event)
  const supabase = getSupabaseAdminClient()
  const stripe = getStripe()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  // Find subscription
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_email', authUser.email!)
    .eq('organization_id', organizationId)
    .limit(1)

  if (!subscriptions || subscriptions.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Assinatura não encontrada' })
  }

  const subscription = subscriptions[0]

  if (!subscription.stripe_subscription_id) {
    throw createError({ statusCode: 400, statusMessage: 'ID da assinatura do Stripe não encontrado' })
  }

  // Cancel at period end in Stripe
  await stripe.subscriptions.update(subscription.stripe_subscription_id, {
    cancel_at_period_end: true
  })

  // Update subscription in database
  await supabase
    .from('subscriptions')
    .update({
      status: 'cancelled',
      cancellation_date: new Date().toISOString(),
      updated_by: authUser.email
    })
    .eq('id', subscription.id)

  // Deactivate organization
  const { data: org } = await supabase
    .from('organizations')
    .select('is_active')
    .eq('id', organizationId)
    .maybeSingle()

  if (org?.is_active) {
    await supabase
      .from('organizations')
      .update({ is_active: false, updated_by: authUser.email })
      .eq('id', organizationId)
  }

  // Remove company from FocusNFe if synced
  await deleteFocusNfeCompanyForOrg(organizationId)

  return {
    success: true,
    message: 'Assinatura cancelada com sucesso. Você terá acesso até o final do período pago.'
  }
})
