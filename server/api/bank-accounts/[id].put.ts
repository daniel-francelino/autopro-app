import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { recordAudit } from '../../utils/audit/record'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  const { data: existing } = await supabase
    .from('bank_accounts').select('*').eq('id', id).eq('organization_id', organizationId).is('deleted_at', null).maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Registro não encontrado' })

  const body = await readBody(event)
  const {
    account_name,
    account_type,
    initial_balance,
    preferred_payment_method,
    bank_name,
    branch,
    account_number,
    current_balance,
    is_active,
    notes,
    change_history
  } = body

  const { data: item, error } = await supabase
    .from('bank_accounts')
    .update({
      ...(account_name !== undefined && { account_name }),
      ...(account_type !== undefined && { account_type }),
      ...(initial_balance !== undefined && { initial_balance }),
      ...(preferred_payment_method !== undefined && { preferred_payment_method }),
      ...(bank_name !== undefined && { bank_name }),
      ...(branch !== undefined && { branch }),
      ...(account_number !== undefined && { account_number }),
      ...(current_balance !== undefined && { current_balance }),
      ...(is_active !== undefined && { is_active }),
      ...(notes !== undefined && { notes }),
      ...(change_history !== undefined && { change_history }),
      updated_by: authUser.email
    })
    .eq('id', id)
    .eq('organization_id', organizationId)
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  recordAudit(event, { before: existing, after: item })

  return { item }
})
