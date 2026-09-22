import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const { data: number, error } = await supabase
    .rpc('next_service_order_number', { p_organization_id: organizationId })

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { number }
})
