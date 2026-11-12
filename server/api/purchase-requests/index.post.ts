import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { recordAudit } from '../../utils/audit/record'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)
  const body = await readBody(event)

  if (!body.supplier_id)
    throw createError({ statusCode: 400, statusMessage: 'O campo "supplier_id" é obrigatório' })
  if (!body.items || !Array.isArray(body.items) || body.items.length === 0)
    throw createError({ statusCode: 400, statusMessage: 'O campo "items" é obrigatório e deve ter pelo menos um item' })

  // Generate request number
  const { count } = await supabase
    .from('purchase_requests')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)

  const nextNumber = String((count ?? 0) + 1).padStart(5, '0')
  const requestNumber = `SOL-${nextNumber}`

  const totalAmount = body.items.reduce((sum: number, item: { estimated_total_price?: string | number | null }) => sum + (parseFloat(String(item.estimated_total_price)) || 0), 0)

  const { data: item, error } = await supabase
    .from('purchase_requests')
    .insert({
      organization_id: organizationId,
      request_number: requestNumber,
      request_date: body.request_date ?? new Date().toISOString(),
      supplier_id: body.supplier_id,
      status: 'waiting',
      items: body.items,
      total_request_amount: body.total_request_amount ?? totalAmount,
      requester: body.requester ?? authUser.email,
      service_order_id: body.service_order_id ?? null,
      justification: body.justification ?? null,
      notes: body.notes ?? null,
      created_by: authUser.email,
      updated_by: authUser.email
    })
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  recordAudit(event, { after: item })

  return { item }
})
