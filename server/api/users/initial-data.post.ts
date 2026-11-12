import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrgLicense } from '../../utils/license'

/**
 * POST /api/users/initial-data
 * Bootstrap endpoint for the workshop app.
 * Returns normalized user, organization, role and permissions data.
 * Migrated from: supabase/functions/getInitialUserData
 */
export default eventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', authUser.id)
    .maybeSingle()

  if (profileError || !profile) {
    throw createError({ statusCode: 404, statusMessage: 'Usuario nao encontrado' })
  }

  const organizationId = profile.organization_id ?? null

  const license = organizationId ? await resolveOrgLicense(organizationId) : { planKey: null, maxEmployees: null }

  const [orgResult, roleResult, employeeResult, rolesResult] = await Promise.all([
    organizationId
      ? supabase.from('organizations').select('*').eq('id', organizationId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    profile.role_id
      ? supabase.from('roles').select('*').eq('id', profile.role_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    profile.employee_id
      ? supabase.from('employees').select('*').eq('id', profile.employee_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    organizationId
      ? supabase.from('roles').select('*').eq('organization_id', organizationId)
      : Promise.resolve({ data: [], error: null })
  ])

  const organization = orgResult.data ?? null
  const userRole = roleResult.data ?? null
  const employee = employeeResult.data ?? null
  const roles = rolesResult.data ?? []
  const isOwner = profile.is_owner === true
  const isAdmin = isOwner || userRole?.name === 'admin' || userRole?.is_system_role === true
  const onboardingCompleted = organization ? (organization as Record<string, unknown>).onboarding_completed === true : false
  const employeeDeleted = employee ? Boolean((employee as Record<string, unknown>).deleted_at) : false
  const employeeTerminationDate = employee?.termination_date ? new Date(employee.termination_date) : null
  const employeeTerminated = Boolean(employeeTerminationDate && employeeTerminationDate <= new Date())
  const accessRevoked = profile.is_active === false || employeeDeleted || employeeTerminated

  if (accessRevoked) {
    return {
      currentUser: {
        ...profile,
        organization_id: null,
        role_id: null
      },
      userRole: null,
      organization: null,
      employee,
      roles: [],
      actions: [],
      roleActions: [],
      permissions: {},
      organizationId: null,
      isOwner,
      isAdmin: false,
      terminated: employeeTerminated,
      termination_date: employee?.termination_date ?? null,
      termination_reason: employee?.termination_reason ?? null,
      onboardingCompleted: false,
      user: {
        ...profile,
        organization_id: null,
        role_id: null
      },
      role: null
    }
  }

  let roleActions: { is_granted?: boolean | null, action_id?: string | null }[] = []
  let actions: { id?: string, code?: string | null }[] = []

  if (profile.role_id) {
    const [roleActionsResult, actionsResult] = await Promise.all([
      supabase.from('role_actions').select('*').eq('role_id', profile.role_id),
      supabase.from('actions').select('*')
    ])

    roleActions = roleActionsResult.data || []
    actions = actionsResult.data || []
  }

  const permissions = roleActions.reduce<Record<string, boolean>>((acc, roleAction) => {
    if (!roleAction.is_granted)
      return acc

    const action = actions.find(item => item.id === roleAction.action_id)
    if (action?.code)
      acc[action.code] = true
    return acc
  }, {})

  return {
    currentUser: profile,
    userRole,
    organization,
    employee,
    roles,
    actions,
    roleActions,
    permissions,
    organizationId,
    isOwner,
    isAdmin,
    terminated: false,
    termination_date: null,
    termination_reason: null,
    onboardingCompleted,
    user: profile,
    role: userRole,
    planKey: license.planKey,
    maxEmployees: license.maxEmployees
  }
})
