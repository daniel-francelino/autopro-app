import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

/**
 * PUT /api/suppliers/:id
 * Updates an existing supplier record.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'suppliers.update', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Supplier id is required' })
  }

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('suppliers')
    .select('id')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (fetchError || !existing) {
    throw createError({ statusCode: 404, statusMessage: 'Supplier not found or access denied' })
  }

  const body = await readBody(event)

  const UPDATABLE_FIELDS = [
    'name', 'person_type', 'phone', 'trade_name', 'tax_id', 'state_registration',
    'whatsapp', 'email', 'website',
    'zip_code', 'street', 'address_number', 'address_complement',
    'neighborhood', 'city', 'state',
    'contact_name', 'contact_role', 'contact_phone', 'contact_email',
    'category', 'payment_term_days', 'credit_limit', 'is_active', 'notes'
  ] as const

  const updates: Record<string, unknown> = { updated_by: authUser.email }

  for (const field of UPDATABLE_FIELDS) {
    if (body[field] !== undefined) {
      updates[field] = body[field]
    }
  }

  const { data, error } = await supabase
    .from('suppliers')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', organizationId)
    .select()
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to update supplier: ${error.message}` })
  }

  return { item: data }
})
