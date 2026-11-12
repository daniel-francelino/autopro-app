import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'settings.update', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)

  const allowedFields = [
    'name',
    'business_type',
    'person_type',
    'tax_id',
    'state_registration',
    'phone',
    'whatsapp',
    'email',
    'website',
    'logo_url',
    'zip_code',
    'street',
    'address_number',
    'address_complement',
    'neighborhood',
    'city',
    'state',
    'municipality_code',
    'initial_service_order_number',
    'notes'
  ]

  const updates: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field]
    }
  }

  updates.updated_by = authUser.email

  const { data: organization, error } = await supabase
    .from('organizations')
    .update(updates)
    .eq('id', organizationId)
    .select()
    .single()

  if (error)
    throw createError({ statusCode: 500, statusMessage: error.message })

  return organization
})
