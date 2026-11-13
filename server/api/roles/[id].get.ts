import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { resolveOrgLicense, filterActionsByPlan } from '../../utils/license'
import { applyRoleScope } from '../../utils/role-scope'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'roles.read', event)
  const supabase = getSupabaseAdminClient()

  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  const { data: role, error: roleError } = await applyRoleScope(
    supabase
      .from('roles')
      .select('id, name, display_name, description, is_system_role, organization_id')
      .eq('id', id),
    organizationId
  )
    .is('deleted_at', null)
    .maybeSingle()

  if (roleError)
    throw createError({ statusCode: 500, statusMessage: roleError.message })

  if (!role)
    throw createError({ statusCode: 404, statusMessage: 'Perfil não encontrado' })

  const [{ data: actions, error: actionsError }, { data: roleActions, error: roleActionsError }, { data: users, error: usersError }, { planKey }] = await Promise.all([
    supabase
      .from('actions')
      .select('id, code, name, description, resource')
      .order('resource', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('role_actions')
      .select('id, role_id, action_id, is_granted')
      .eq('role_id', id),
    supabase
      .from('user_profiles')
      .select('id, email, display_name, employee_id, role_id, is_active')
      .eq('organization_id', organizationId)
      .eq('role_id', id)
      .order('display_name', { ascending: true }),
    resolveOrgLicense(organizationId)
  ])

  if (actionsError)
    throw createError({ statusCode: 500, statusMessage: actionsError.message })

  if (roleActionsError)
    throw createError({ statusCode: 500, statusMessage: roleActionsError.message })

  if (usersError)
    throw createError({ statusCode: 500, statusMessage: usersError.message })

  const employeeIds = (users ?? [])
    .map(user => user.employee_id)
    .filter((employeeId): employeeId is string => typeof employeeId === 'string' && employeeId.length > 0)

  let employeeNameMap = new Map<string, string>()

  if (employeeIds.length) {
    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select('id, name')
      .in('id', employeeIds)

    if (employeesError)
      throw createError({ statusCode: 500, statusMessage: employeesError.message })

    employeeNameMap = new Map((employees ?? []).map(employee => [employee.id as string, employee.name as string]))
  }

  const grantedActionIds = new Set((roleActions ?? [])
    .filter(roleAction => roleAction.is_granted)
    .map(roleAction => roleAction.action_id as string))

  const allowedActions = filterActionsByPlan(actions ?? [], planKey)

  const assignedUsers = (users ?? []).map(user => ({
    id: user.id as string,
    email: user.email as string | null,
    full_name: null,
    display_name: user.display_name as string | null,
    employee_id: user.employee_id as string | null,
    employee_name: user.employee_id ? (employeeNameMap.get(user.employee_id as string) ?? null) : null,
    active: user.is_active !== false
  }))

  return {
    item: {
      role,
      actions: allowedActions,
      role_actions: roleActions ?? [],
      assigned_users: assignedUsers,
      summary: {
        granted_actions_count: grantedActionIds.size,
        total_actions_count: allowedActions.length,
        assigned_users_count: assignedUsers.length
      }
    }
  }
})
