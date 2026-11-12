import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { recordAudit } from '../../utils/audit/record'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'authorizations.update', event)
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

  const body = await readBody(event)
  const updates: Record<string, unknown> = { updated_by: authUser.email }

  const updatableFields = [
    'supplier_id', 'items', 'total_request_amount', 'requester',
    'service_order_id', 'justification', 'notes', 'purchase_id'
  ]

  for (const field of updatableFields) {
    if (body[field] !== undefined)
      updates[field] = body[field]
  }

  const { data: item, error } = await supabase
    .from('purchase_requests')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  recordAudit(event, { before: existing, after: item })

  return { item }
})
