// =============================================================================
// TEMPORARY data-cleanup utilities — NOT part of the permanent commission
// engine. Let an admin fix a service order's responsible_employees by hand
// (add someone who was missed, or remove someone assigned by mistake),
// reusing releaseServiceOrderCommissions (unmodified) to recompute
// entitlements/records for the affected employee afterward — including its
// "consolidate this employee's pending records into one on manual
// recalculation" behavior and its "zero entitlement still runs the paid
// check + claw-back" behavior (server/utils/service-order-commissions.ts),
// so removing someone with an already-PAID commission on this order is
// blocked, same as the ordinary "Recalcular" action.
//
// To remove this feature later, delete:
//   - this file
//   - server/api/service-orders/[id]/add-responsible.post.ts
//   - server/api/service-orders/[id]/remove-responsible.post.ts
//   - the "Adicionar responsável" / "Remover responsável" button + modal
//     blocks in app/components/service-orders/detail/OSResponsiblesCard.vue
//     (each marked with a matching "TEMPORARY" comment), and the `employees`
//     prop added there for the add-responsible picker (also marked)
//   - the `:employees="detail.employees"` line passed to
//     ServiceOrdersDetailOSResponsiblesCard in
//     app/components/service-orders/detail/Modal.vue (also marked)
// Nothing else in the codebase imports from this file.
// =============================================================================

import { createError } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { releaseServiceOrderCommissions } from './service-order-commissions'

type ResponsibleAdminParams = {
  supabase: SupabaseClient
  organizationId: string
  orderId: string
  employeeId: string
  reason: string
  userEmail?: string | null
  userName?: string | null
}

async function loadResponsibleEmployees(
  supabase: SupabaseClient,
  organizationId: string,
  orderId: string
): Promise<{ employee_id: string }[]> {
  const { data: order } = await supabase
    .from('service_orders')
    .select('id, responsible_employees')
    .eq('id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!order) {
    throw createError({ statusCode: 404, statusMessage: 'Service order not found' })
  }

  return Array.isArray(order.responsible_employees)
    ? order.responsible_employees as { employee_id: string }[]
    : []
}

/**
 * Adds one employee to a service order's responsible_employees, then calls
 * releaseServiceOrderCommissions scoped to them — computes their entitlement
 * from the order's current items/rules and creates a fresh pending record
 * for it (there's nothing to consolidate yet, so this is just a normal
 * "new employee, new record" pass through the shared engine).
 */
export async function addServiceOrderResponsible({
  supabase,
  organizationId,
  orderId,
  employeeId,
  reason,
  userEmail,
  userName
}: ResponsibleAdminParams) {
  const trimmedReason = String(reason || '').trim()
  if (!trimmedReason) {
    throw createError({ statusCode: 400, statusMessage: 'Informe o motivo da adição.' })
  }

  const responsibleEmployees = await loadResponsibleEmployees(supabase, organizationId, orderId)

  if (responsibleEmployees.some(entry => entry.employee_id === employeeId)) {
    throw createError({ statusCode: 400, statusMessage: 'Este funcionário já é responsável nesta OS.' })
  }

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!employee) {
    throw createError({ statusCode: 400, statusMessage: 'Funcionário inválido.' })
  }

  await supabase
    .from('service_orders')
    .update({
      responsible_employees: [...responsibleEmployees, { employee_id: employeeId }],
      updated_by: userEmail || null
    })
    .eq('id', orderId)

  return releaseServiceOrderCommissions({
    supabase,
    organizationId,
    orderId,
    userEmail,
    userName,
    employeeId,
    reason: trimmedReason
  })
}

/**
 * Removes one employee from a service order's responsible_employees, then
 * calls releaseServiceOrderCommissions scoped to them. With no items left
 * matching their (now absent) responsibility, their entitlement resolves to
 * zero — releaseServiceOrderCommissions's own zero-entitlement handling
 * takes it from there: blocks if they already have a PAID record on this
 * order, otherwise consolidates/deletes their pending record(s) down to
 * zero.
 */
export async function removeServiceOrderResponsible({
  supabase,
  organizationId,
  orderId,
  employeeId,
  reason,
  userEmail,
  userName
}: ResponsibleAdminParams) {
  const trimmedReason = String(reason || '').trim()
  if (!trimmedReason) {
    throw createError({ statusCode: 400, statusMessage: 'Informe o motivo da remoção.' })
  }

  const responsibleEmployees = await loadResponsibleEmployees(supabase, organizationId, orderId)

  if (!responsibleEmployees.some(entry => entry.employee_id === employeeId)) {
    throw createError({ statusCode: 400, statusMessage: 'Este funcionário não é responsável nesta OS.' })
  }

  await supabase
    .from('service_orders')
    .update({
      responsible_employees: responsibleEmployees.filter(entry => entry.employee_id !== employeeId),
      updated_by: userEmail || null
    })
    .eq('id', orderId)

  return releaseServiceOrderCommissions({
    supabase,
    organizationId,
    orderId,
    userEmail,
    userName,
    employeeId,
    reason: trimmedReason
  })
}
