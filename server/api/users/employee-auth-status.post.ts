import { readBody } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'

/**
 * POST /api/users/employee-auth-status
 * Checks if an employee has a linked auth user.
 * Migrated from: supabase/functions/getEmployeeAuthStatus
 */
export default eventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'employees.read', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)
  const { employee_id } = body || {}

  if (!employee_id) {
    throw createError({ statusCode: 400, statusMessage: 'employee_id é obrigatório' })
  }

  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('id, email')
    .eq('id', employee_id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (employeeError || !employee) {
    throw createError({ statusCode: 404, statusMessage: 'Funcionário não encontrado' })
  }

  const { data: users } = await supabase
    .from('user_profiles')
    .select('id, user_id, is_active, role_id')
    .eq('employee_id', employee_id)
    .eq('organization_id', organizationId)
    .limit(1)

  if (users && users.length > 0) {
    const firstUser = users[0]

    if (!firstUser) {
      return { hasAuthUser: false, user_id: null, active: false, role_id: null }
    }

    return {
      hasAuthUser: true,
      user_id: firstUser.user_id,
      active: firstUser.is_active ?? true,
      role_id: firstUser.role_id ?? null
    }
  }

  const normalizedEmail = String(employee.email ?? '').trim().toLowerCase()
  if (!normalizedEmail) {
    return { hasAuthUser: false, user_id: null, active: false, role_id: null }
  }

  const { data: profileByEmail } = await supabase
    .from('user_profiles')
    .select('id, user_id, is_active, role_id, employee_id, organization_id')
    .eq('email', normalizedEmail)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (profileByEmail?.user_id) {
    // Auto-heal legacy profiles that were created by email but not linked to employee_id.
    if (!profileByEmail.employee_id) {
      await supabase
        .from('user_profiles')
        .update({ employee_id })
        .eq('id', profileByEmail.id)
        .eq('organization_id', organizationId)
    }

    return {
      hasAuthUser: true,
      user_id: profileByEmail.user_id,
      active: profileByEmail.is_active ?? true,
      role_id: profileByEmail.role_id ?? null
    }
  }

  return { hasAuthUser: false, user_id: null, active: false, role_id: null }
})
