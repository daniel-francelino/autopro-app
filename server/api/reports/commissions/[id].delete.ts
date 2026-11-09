import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import { recordAudit } from '../../../utils/audit/record'

/**
 * DELETE /api/reports/commissions/:id
 * Delete a single employee_financial_record (commission).
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')

  const { data: existing } = await supabase
    .from('employee_financial_records')
    .select('*')
    .eq('id', id!)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Comissão não encontrada' })

  const { error } = await supabase
    .from('employee_financial_records')
    .delete()
    .eq('id', id!)
    .eq('organization_id', organizationId)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  recordAudit(event, { resourceType: 'employee_financial_record', resourceId: id, before: existing })

  return { success: true }
})
