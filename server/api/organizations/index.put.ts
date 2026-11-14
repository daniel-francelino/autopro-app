import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { recordAudit } from '../../utils/audit/record'

const COMMISSION_RELEASE_MODES = ['proportional', 'full']

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
    'notes',
    'commission_release_mode'
  ]

  const updates: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field]
    }
  }

  if (
    updates.commission_release_mode !== undefined
    && !COMMISSION_RELEASE_MODES.includes(updates.commission_release_mode as string)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Modo de liberação de comissão inválido' })
  }

  // Read the current mode only when it is being changed, to audit before/after.
  let previousMode: string | null = null
  if (updates.commission_release_mode !== undefined) {
    const { data: current, error: currentError } = await supabase
      .from('organizations')
      .select('commission_release_mode')
      .eq('id', organizationId)
      .single()

    if (currentError || !current)
      throw createError({ statusCode: 500, statusMessage: currentError?.message || 'Não foi possível ler a organização' })
    previousMode = current.commission_release_mode
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

  if (previousMode !== null && previousMode !== organization.commission_release_mode) {
    recordAudit(event, {
      resourceType: 'organization',
      resourceId: organizationId,
      before: { commission_release_mode: previousMode },
      after: { commission_release_mode: organization.commission_release_mode }
    })
  }

  return organization
})
