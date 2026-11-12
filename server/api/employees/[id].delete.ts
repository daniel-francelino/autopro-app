import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { syncEmployeeLinkedUserAccess } from '../../utils/employee-access'

/**
 * DELETE /api/employees/:id
 * Soft-deletes an employee record.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'employees.delete', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Employee id is required' })
  }

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('employees')
    .select('id, name, organization_id, termination_date, deleted_at')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (fetchError || !existing) {
    throw createError({ statusCode: 404, statusMessage: 'Employee not found or access denied' })
  }

  const { error } = await supabase
    .from('employees')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: authUser.email
    })
    .eq('id', id)
    .eq('organization_id', organizationId)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to delete employee: ${error.message}` })
  }

  await syncEmployeeLinkedUserAccess(supabase, {
    employeeId: id,
    organizationId,
    employeeName: existing.name as string | null,
    terminationDate: existing.termination_date as string | null,
    deletedAt: new Date().toISOString(),
    updatedBy: authUser.email
  })

  return { success: true }
})
