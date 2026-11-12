import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { resolveOrganizationId } from '../../../utils/organization'
import { getEmployeeCommissionReport } from '../../../utils/employee-commission-report'

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'employees.read', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)
  const employeeId = getRouterParam(event, 'id')
  const query = getQuery(event)

  if (!employeeId) {
    throw createError({ statusCode: 400, statusMessage: 'Employee id is required' })
  }

  try {
    const report = await getEmployeeCommissionReport({
      supabase,
      organizationId,
      employeeId,
      dateFrom: query.dateFrom ? String(query.dateFrom) : null,
      dateTo: query.dateTo ? String(query.dateTo) : null
    })

    return { data: report }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load employee details'

    if (message === 'Employee not found') {
      throw createError({ statusCode: 404, statusMessage: 'Funcionário não encontrado' })
    }

    throw createError({ statusCode: 500, statusMessage: message })
  }
})
