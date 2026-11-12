import { getRequestURL, getRouterParam } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { getSupabaseAnonClient } from '../../../utils/supabase-anon'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import { ensureUserProvisioned } from '../../../utils/user-provisioning'

/**
 * POST /api/employees/:id/grant-access
 * Provisions the employee's app access in one step:
 *   1. Creates the auth user if needed
 *   2. Ensures required app tables exist (profile + preferences)
 *   3. Links the user to the organization, employee, and role
 *   4. Sends the password setup email
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'members.invite', event)
  const supabase = getSupabaseAdminClient()
  const supabaseAnon = getSupabaseAnonClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Employee id is required' })
  }

  // 1. Load the employee
  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('id, email, name')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (employeeError || !employee) {
    throw createError({ statusCode: 404, statusMessage: 'Funcionário não encontrado' })
  }

  if (!employee.email?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Funcionário não tem email cadastrado. Adicione um email antes de gerar acesso.' })
  }

  const normalizedEmail = employee.email.trim().toLowerCase()

  // 2. Check if already linked to this employee
  const { data: existingEmployeeProfile } = await supabase
    .from('user_profiles')
    .select('id, user_id, organization_id')
    .eq('employee_id', id)
    .maybeSingle()

  if (existingEmployeeProfile && existingEmployeeProfile.organization_id !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Funcionário já está vinculado a outra organização.' })
  }

  // 3. Find the 'employee' system role for this org
  const { data: systemRole } = await supabase
    .from('roles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('name', 'employee')
    .eq('is_system_role', true)
    .maybeSingle()

  if (!systemRole) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Role de funcionário não encontrada. Acesse Permissões e verifique se o papel "employee" de sistema existe.'
    })
  }

  // 4. Find the user profile by email when it already exists.
  // Using limit(1) + order instead of maybeSingle() to handle the case where
  // duplicate profiles exist for the same email (orphaned rows from deleted auth users).
  // We prefer the profile already linked to this organization, otherwise the most recent.
  const { data: profileRows } = await supabase
    .from('user_profiles')
    .select('id, user_id, organization_id')
    .eq('email', normalizedEmail)
    .order('created_at', { ascending: false })

  const targetProfile = profileRows?.find(p => p.organization_id === organizationId)
    ?? profileRows?.[0]
    ?? null

  if (targetProfile?.organization_id && targetProfile.organization_id !== organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Este usuário já está vinculado a outra organização.' })
  }

  let userId = targetProfile?.user_id ?? existingEmployeeProfile?.user_id ?? null

  if (!userId) {
    const temporaryPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`
    const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        name: employee.name
      }
    })

    if (createUserError || !createdUser.user) {
      throw createError({
        statusCode: 500,
        statusMessage: createUserError?.message || 'Não foi possível criar o usuário do funcionário.'
      })
    }

    userId = createdUser.user.id
  }

  // 5. Ensure all required app records exist and are linked
  await ensureUserProvisioned(supabase, {
    userId,
    email: normalizedEmail,
    displayName: employee.name,
    organizationId,
    roleId: systemRole.id,
    employeeId: id,
    isActive: true,
    updatedBy: authUser.email,
    createdBy: authUser.email
  })

  // 6. Send password setup email using the existing reset-password flow
  const redirectTo = `${getRequestURL(event).origin}/reset-password`
  const { error: resetPasswordError } = await supabaseAnon.auth.resetPasswordForEmail(normalizedEmail, {
    redirectTo
  })

  if (resetPasswordError) {
    throw createError({
      statusCode: 500,
      statusMessage: 'A conta foi criada e vinculada, mas não foi possível enviar o email para definir a senha.'
    })
  }

  return {
    success: true,
    message: 'Acesso criado com sucesso. O funcionário receberá um email para definir a senha.'
  }
})
