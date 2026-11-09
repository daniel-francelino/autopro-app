import type { H3Event } from 'h3'
import { getSupabaseAdminClient } from './supabase'
import { setAuditContext } from './audit/context'
import { isEmployeeAccessRevoked, syncEmployeeLinkedUserAccess } from './employee-access'

/**
 * Resolves the organization_id for the authenticated user.
 * Queries user_profiles to find the linked organization.
 */
export async function resolveOrganizationId(event: H3Event, userId: string) {
  const supabase = getSupabaseAdminClient()

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('organization_id, employee_id, is_active')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to fetch user profile' })
  }

  if (profile?.is_active === false) {
    throw createError({ statusCode: 403, statusMessage: 'Usuário sem acesso ativo à organização' })
  }

  if (profile?.employee_id && profile.organization_id) {
    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('id, name, termination_date, deleted_at')
      .eq('id', profile.employee_id)
      .maybeSingle()

    if (employeeError) {
      throw createError({ statusCode: 500, statusMessage: 'Failed to fetch linked employee' })
    }

    if (employee && isEmployeeAccessRevoked(employee.termination_date as string | null, employee.deleted_at as string | null)) {
      await syncEmployeeLinkedUserAccess(supabase, {
        employeeId: employee.id as string,
        organizationId: profile.organization_id as string,
        employeeName: employee.name as string | null,
        terminationDate: employee.termination_date as string | null,
        deletedAt: employee.deleted_at as string | null,
        updatedBy: 'access-guard'
      })

      throw createError({ statusCode: 403, statusMessage: 'Funcionário sem acesso ativo à organização' })
    }
  }

  if (!profile?.organization_id) {
    throw createError({ statusCode: 400, statusMessage: 'Usuário não vinculado a uma organização' })
  }

  setAuditContext(event, { organizationId: profile.organization_id as string, employeeId: (profile.employee_id as string | null) ?? null })

  return profile.organization_id as string
}

/**
 * Resolves the full user profile for the authenticated user.
 */
export async function getUserProfile(userId: string) {
  const supabase = getSupabaseAdminClient()

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to fetch user profile' })
  }

  return profile
}

/**
 * Resolves a user profile by email.
 */
export async function getUserProfileByEmail(email: string) {
  const supabase = getSupabaseAdminClient()

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to fetch user profile' })
  }

  return profile
}
