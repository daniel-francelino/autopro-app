import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireUuidParam } from '../../../utils/admin-params'

/**
 * GET /api/admin/organizations/:id
 * Cabeçalho da ficha da oficina: dados cadastrais, plano, assinatura, suspensão e onboarding.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = requireUuidParam(event)
  const supabase = getSupabaseAdminClient()

  const { data: org, error } = await supabase
    .from('organizations')
    .select('id, name, tax_id, email, phone, city, state, is_active, is_internal, onboarding_completed, created_at, suspended_at, suspended_reason, suspended_by')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: 'Erro ao carregar a oficina' })
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Oficina não encontrada' })

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('id, status, plan_key, plan_name, monthly_amount, start_date, next_payment_date, cancellation_date')
    .eq('organization_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return { ...org, subscription: subscription ?? null }
})
