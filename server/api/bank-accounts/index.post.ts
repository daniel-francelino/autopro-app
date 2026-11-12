import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { recordAudit } from '../../utils/audit/record'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'bank_accounts.create', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)
  const {
    account_name,
    account_type,
    initial_balance = 0,
    preferred_payment_method,
    bank_name,
    branch,
    account_number,
    current_balance,
    is_active,
    notes,
    change_history
  } = body

  if (!account_name || !account_type)
    throw createError({ statusCode: 400, statusMessage: 'account_name e account_type são obrigatórios' })

  const { data: item, error } = await supabase
    .from('bank_accounts')
    .insert({
      organization_id: organizationId,
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
      change_history,
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
