import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import { recordAudit } from '../../../utils/audit/record'
import { OS_EVENT_KEYS, OS_SOURCE_POLICIES, commissionRemovedPayload, historyContext, loadEmployeeNames, osEvent, recordWithContext } from '../../../utils/os-history/events'

/**
 * DELETE /api/reports/commissions/:id
 * Delete a single employee_financial_record (commission).
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'financial.delete', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const history = historyContext(event, OS_SOURCE_POLICIES.commissionDelete)
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

  // Histórico da OS: o apagamento é físico (não sobra rastro na linha), então este evento é o único registro.
  if (existing.service_order_id && existing.record_type === 'commission') {
    await recordWithContext(history, supabase, async () => {
      const names = await loadEmployeeNames(supabase, organizationId, [existing.employee_id])
      return [osEvent('commission.removed', {
        organizationId,
        serviceOrderId: String(existing.service_order_id),
        entityType: 'employee_financial_record',
        entityId: String(id),
        idempotencyKey: OS_EVENT_KEYS.commissionRemoved(String(id))
      }, commissionRemovedPayload(existing, names.get(String(existing.employee_id)) ?? null, 'manual_delete'))]
    })
  }

  recordAudit(event, { resourceType: 'employee_financial_record', resourceId: id, before: existing })

  return { success: true }
})
