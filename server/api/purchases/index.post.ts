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
  if (!body.bank_account_id)
    throw createError({ statusCode: 400, statusMessage: 'O campo "bank_account_id" é obrigatório' })
  if (!body.purchase_date)
    throw createError({ statusCode: 400, statusMessage: 'O campo "purchase_date" é obrigatório' })
  if (body.total_amount == null)
    throw createError({ statusCode: 400, statusMessage: 'O campo "total_amount" é obrigatório' })

  const { data: item, error } = await supabase
    .from('purchases')
    .insert({
      organization_id: organizationId,
      supplier_id: body.supplier_id,
      bank_account_id: body.bank_account_id,
      financial_transaction_id: body.financial_transaction_id ?? null,
      purchase_date: body.purchase_date,
      total_amount: body.total_amount,
      payment_status: body.payment_status ?? 'pending',
      invoice_number: body.invoice_number ?? null,
      payment_date: body.payment_date ?? null,
      due_date: body.due_date ?? null,
      notes: body.notes ?? null,
      items: body.items ?? null,
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
