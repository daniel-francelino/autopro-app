import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import { recordAudit } from '../../../utils/audit/record'

/**
 * POST /api/purchases/:id/pay
 * Confirms payment for a purchase, setting payment_status to 'paid' and recording the payment_date.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'purchases.update', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  const { data: existing, error: findError } = await supabase
    .from('purchases')
    .select('*')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (findError)
    throw createError({ statusCode: 500, statusMessage: findError.message })
  if (!existing)
    throw createError({ statusCode: 404, statusMessage: 'Compra não encontrada' })

  if (existing.payment_status === 'paid')
    throw createError({ statusCode: 400, statusMessage: 'Esta compra já foi paga' })

  const body = await readBody(event)
  const paymentDate = body.payment_date || new Date().toISOString().split('T')[0]

  const { data: item, error } = await supabase
    .from('purchases')
    .update({
      payment_status: 'paid',
      payment_date: paymentDate,
      updated_by: authUser.email
    })
    .eq('id', id)
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  recordAudit(event, { before: existing, after: item })

  return { item }
})
