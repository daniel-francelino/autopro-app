// =============================================================================
// TEMPORARY data-cleanup utility — NOT part of the permanent commission
// engine. Lets an admin remove an employee who was wrongly marked
// responsible on a service order, deleting their (necessarily still-pending
// — see the paid check below) commission records for that order and
// recomputing what's left.
//
// To remove this feature later, delete:
//   - this file
//   - server/api/service-orders/[id]/remove-responsible.post.ts
//   - the "Remover responsável" button + confirm modal block in
//     app/components/service-orders/detail/OSResponsiblesCard.vue (each
//     marked with a matching "TEMPORARY" comment)
// Nothing else in the codebase imports from this file.
// =============================================================================

import { createError } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { releaseServiceOrderCommissions, type CommissionManualAdjustmentLogEntry } from './service-order-commissions'

type RemoveServiceOrderResponsibleParams = {
  supabase: SupabaseClient
  organizationId: string
  orderId: string
  employeeId: string
  reason: string
  userEmail?: string | null
  userName?: string | null
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2))
}

/**
 * Removes one employee from a service order's responsible_employees,
 * deletes their commission records for that order, and reuses
 * releaseServiceOrderCommissions (unscoped) to refresh the items snapshot
 * and commission_amount for whoever remains — removing one employee doesn't
 * change anyone else's entitlement math, this just keeps persisted state
 * consistent the same way any other recalculation trigger does.
 *
 * Blocks (same rule as the "Recalcular" action in
 * releaseServiceOrderCommissions) when the employee already has a PAID
 * commission record on this order — a paid record is never deleted here.
 */
export async function removeServiceOrderResponsible({
  supabase,
  organizationId,
  orderId,
  employeeId,
  reason,
  userEmail,
  userName
}: RemoveServiceOrderResponsibleParams) {
  const trimmedReason = String(reason || '').trim()
  if (!trimmedReason) {
    throw createError({ statusCode: 400, statusMessage: 'Informe o motivo da remoção.' })
  }

  const { data: order } = await supabase
    .from('service_orders')
    .select('id, responsible_employees, commission_manual_adjustments_log')
    .eq('id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!order) {
    throw createError({ statusCode: 404, statusMessage: 'Service order not found' })
  }

  const responsibleEmployees = Array.isArray(order.responsible_employees)
    ? order.responsible_employees as { employee_id: string }[]
    : []

  if (!responsibleEmployees.some(entry => entry.employee_id === employeeId)) {
    throw createError({ statusCode: 400, statusMessage: 'Este funcionário não é responsável nesta OS.' })
  }

  const { data: existingRecords } = await supabase
    .from('employee_financial_records')
    .select('id, amount, status')
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)
    .eq('employee_id', employeeId)
    .eq('record_type', 'commission')

  const records = existingRecords || []

  if (records.some(record => record.status === 'paid')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Não é possível remover: este funcionário já possui comissão paga nesta OS.'
    })
  }

  const { data: employee } = await supabase
    .from('employees')
    .select('name')
    .eq('id', employeeId)
    .maybeSingle()

  const previousAmount = roundCurrency(records.reduce((sum, record) => sum + Number(record.amount || 0), 0))

  // Pending records for this employee on this order no longer apply — same
  // hard-delete already used for claw-back in releaseServiceOrderCommissions.
  for (const record of records) {
    await supabase.from('employee_financial_records').delete().eq('id', record.id)
  }

  const nextResponsibleEmployees = responsibleEmployees.filter(entry => entry.employee_id !== employeeId)

  const existingLog = Array.isArray(order.commission_manual_adjustments_log)
    ? order.commission_manual_adjustments_log as CommissionManualAdjustmentLogEntry[]
    : []

  const removedLogEntry: CommissionManualAdjustmentLogEntry = {
    employee_id: employeeId,
    employee_name: employee?.name || null,
    reason: trimmedReason,
    previous_amount: previousAmount,
    new_amount: 0,
    recalculated_by_email: userEmail || null,
    recalculated_by_name: userName || null,
    recalculated_at: new Date().toISOString()
  }

  await supabase
    .from('service_orders')
    .update({
      responsible_employees: nextResponsibleEmployees,
      commission_manual_adjustments_log: [...existingLog, removedLogEntry],
      updated_by: userEmail || null
    })
    .eq('id', orderId)

  const result = await releaseServiceOrderCommissions({
    supabase,
    organizationId,
    orderId,
    userEmail
  })

  return { ...result, removedLogEntry }
}
