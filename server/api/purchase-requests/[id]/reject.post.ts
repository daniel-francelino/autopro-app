import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import { recordAudit } from '../../../utils/audit/record'

/**
 * POST /api/purchase-requests/:id/reject
 * Rejects a purchase request (status: waiting → rejected).
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  const { data: existing, error: findError } = await supabase
    .from('purchase_requests')
    .select('*')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (findError)
    throw createError({ statusCode: 500, statusMessage: findError.message })
  if (!existing)
    throw createError({ statusCode: 404, statusMessage: 'Solicitação não encontrada' })

  if (existing.status !== 'waiting')
    throw createError({ statusCode: 400, statusMessage: 'Somente solicitações com status "aguardando" podem ser recusadas' })

  const body = await readBody(event)

  const { data: item, error } = await supabase
    .from('purchase_requests')
    .update({
      status: 'rejected',
      rejection_reason: body.rejection_reason ?? null,
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
