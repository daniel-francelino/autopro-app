import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'payment_machines.update', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)
  const {
    terminal_name,
    provider_company,
    bank_account_id,
    payment_receipt_days,
    is_active,
    rates
  } = body

  if (!terminal_name)
    throw createError({ statusCode: 400, statusMessage: 'terminal_name é obrigatório' })

  const { data: item, error } = await supabase
    .from('payment_terminals')
    .insert({
      organization_id: organizationId,
      terminal_name,
      provider_company,
      bank_account_id,
      payment_receipt_days,
      is_active,
      rates,
      created_by: authUser.email,
      updated_by: authUser.email
    })
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  return { item }
})
