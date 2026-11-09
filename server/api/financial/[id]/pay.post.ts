import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import { recordAudit } from '../../../utils/audit/record'

/**
 * POST /api/financial/:id/pay
 * Mark a financial transaction as paid.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')

  const { data: existing } = await supabase
    .from('financial_transactions')
    .select('id, status')
    .eq('id', id!)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Lançamento não encontrado' })
  if (existing.status === 'paid') throw createError({ statusCode: 400, statusMessage: 'Lançamento já está marcado como pago' })

  const { data: item, error } = await supabase
    .from('financial_transactions')
    .update({ status: 'paid', updated_by: authUser.email })
    .eq('id', id!)
    .eq('organization_id', organizationId)
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  recordAudit(event, { before: { status: existing.status }, after: { status: 'paid' } })

  return item
})
