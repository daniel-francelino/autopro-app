import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

/**
 * DELETE /api/suppliers/:id
 * Soft-deletes a supplier record.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'suppliers.delete', event)
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

  const { error } = await supabase
    .from('suppliers')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: authUser.email
    })
    .eq('id', id)
    .eq('organization_id', organizationId)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to delete supplier: ${error.message}` })
  }

  return { success: true }
})
