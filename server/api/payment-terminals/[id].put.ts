import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  const { data: existing } = await supabase
    .from('payment_terminals').select('id').eq('id', id).eq('organization_id', organizationId).is('deleted_at', null).maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Registro não encontrado' })

  const body = await readBody(event)
  const {
    terminal_name,
    provider_company,
    bank_account_id,
    payment_receipt_days,
    is_active,
    rates
  } = body

  const { data: item, error } = await supabase
    .from('payment_terminals')
    .update({
      ...(terminal_name !== undefined && { terminal_name }),
      ...(provider_company !== undefined && { provider_company }),
      ...(bank_account_id !== undefined && { bank_account_id }),
      ...(payment_receipt_days !== undefined && { payment_receipt_days }),
      ...(is_active !== undefined && { is_active }),
      ...(rates !== undefined && { rates }),
      updated_by: authUser.email
    })
    .eq('id', id)
    .eq('organization_id', organizationId)
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  return { item }
})
