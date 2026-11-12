import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { recordAudit } from '../../utils/audit/record'

const VALID_REASONS = ['warranty', 'wrong_part', 'manufacturing_defect', 'damaged_product', 'incompatible', 'other']
const VALID_STATUSES = ['pending', 'completed']

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'returns.create', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)
  const body = await readBody(event)

  if (!body.purchase_id)
    throw createError({ statusCode: 400, statusMessage: 'O campo "purchase_id" é obrigatório' })
  if (!body.supplier_id)
    throw createError({ statusCode: 400, statusMessage: 'O campo "supplier_id" é obrigatório' })
  if (!body.return_date)
    throw createError({ statusCode: 400, statusMessage: 'O campo "return_date" é obrigatório' })
  if (!body.reason || !VALID_REASONS.includes(body.reason))
    throw createError({ statusCode: 400, statusMessage: `O campo "reason" deve ser um de: ${VALID_REASONS.join(', ')}` })
  if (body.total_returned_amount == null)
    throw createError({ statusCode: 400, statusMessage: 'O campo "total_returned_amount" é obrigatório' })
  if (!body.returned_items || !Array.isArray(body.returned_items))
    throw createError({ statusCode: 400, statusMessage: 'O campo "returned_items" é obrigatório e deve ser uma lista' })

  const status = body.status && VALID_STATUSES.includes(body.status) ? body.status : 'pending'

  const { data: item, error } = await supabase
    .from('purchase_returns')
    .insert({
      organization_id: organizationId,
      purchase_id: body.purchase_id,
      supplier_id: body.supplier_id,
      financial_transaction_id: body.financial_transaction_id ?? null,
      bank_account_id: body.bank_account_id ?? null,
      return_date: body.return_date,
      reason: body.reason,
      status,
      total_returned_amount: body.total_returned_amount,
      returned_items: body.returned_items,
      generated_financial_credit: body.generated_financial_credit ?? false,
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
