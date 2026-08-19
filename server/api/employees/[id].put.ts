import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { syncEmployeeLinkedUserAccess } from '../../utils/employee-access'

/**
 * PUT /api/employees/:id
 * Updates an existing employee record.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Employee id is required' })
  }

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('employees')
    .select('id, name, email, organization_id, termination_date, deleted_at')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (fetchError || !existing) {
    throw createError({ statusCode: 404, statusMessage: 'Employee not found or access denied' })
  }

  const body = await readBody(event)

  const { data: linkedProfiles, error: linkedProfilesError } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('employee_id', id)
    .limit(1)

  if (linkedProfilesError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to inspect linked user: ${linkedProfilesError.message}` })
  }

  const hasLinkedUser = (linkedProfiles?.length ?? 0) > 0

  if (hasLinkedUser && body.email !== undefined) {
    const currentEmail = typeof existing.email === 'string' ? existing.email.trim().toLowerCase() : ''
    const nextEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

    if (nextEmail !== currentEmail) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Não é possível alterar o e-mail após o funcionário já possuir um usuário vinculado.'
      })
    }
  }

  const UPDATABLE_FIELDS = [
    'name', 'person_type', 'tax_id', 'phone', 'email', 'role',
    'zip_code', 'street', 'address_number', 'address_complement',
    'neighborhood', 'city', 'state',
    'has_salary', 'salary_amount', 'payment_day', 'salary_installments',
    'has_minimum_guarantee', 'minimum_guarantee_amount',
    'minimum_guarantee_installments', 'pix_key_type', 'pix_key',
    'termination_date', 'termination_reason'
  ] as const

  const updates: Record<string, unknown> = { updated_by: authUser.email }

  for (const field of UPDATABLE_FIELDS) {
    if (body[field] !== undefined) {
      updates[field] = body[field]
    }
  }

  const { data, error } = await supabase
    .from('employees')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', organizationId)
    .select()
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to update employee: ${error.message}` })
  }

  if (body.role_id !== undefined && hasLinkedUser) {
    const { error: roleUpdateError } = await supabase
      .from('user_profiles')
      .update({ role_id: body.role_id || null })
      .eq('employee_id', id)

    if (roleUpdateError) {
      throw createError({ statusCode: 500, statusMessage: `Failed to update role: ${roleUpdateError.message}` })
    }
  }

  await syncEmployeeLinkedUserAccess(supabase, {
    employeeId: id,
    organizationId,
    employeeName: (data as Record<string, unknown>).name as string | null,
    terminationDate: (data as Record<string, unknown>).termination_date as string | null,
    deletedAt: (data as Record<string, unknown>).deleted_at as string | null,
    updatedBy: authUser.email
  })

  return { item: data }
})
