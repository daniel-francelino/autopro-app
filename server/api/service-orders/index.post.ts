import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { computeNextOsNumber, normalizeOsNumber } from '../../utils/service-order-number'
import {
  computeServiceOrderItemsWithCommissionSnapshots,
  type ServiceOrderCommissionItem
} from '../../utils/service-order-item-commissions'
import { resolveEmployeeCommissionRulesForEmployees, resolveCommissionPlanRules } from '../../utils/employee-commission-plans'
import {
  toCommissionMonthStart,
  resolveEffectiveCommissionRules,
  getActiveOverridePlanIds,
  type ResolvedCommissionRule,
  type CommissionManualAdjustmentLogEntry
} from '../../../lib/utils/employee-commission-engine'

/**
 * POST /api/service-orders
 * Creates or updates a service order with items and related data.
 */

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)
  const orderId = body?.orderId || null
  const orderData = body?.orderData || null
  const appointmentData = body?.appointmentData || null

  if (!orderData) {
    throw createError({ statusCode: 400, statusMessage: 'orderData is required' })
  }

  const warnings: string[] = []
  const isUpdate = !!orderId
  let existingOrder: Record<string, unknown> | null = null
  type SavedOrderRecord = {
    id: string
    client_id: string | null
    vehicle_id: string | null
    entry_date: string | null
    reported_defect: string | null
    appointment_id?: string | null
  }

  if (isUpdate) {
    const { data, error } = await supabase
      .from('service_orders')
      .select('*')
      .eq('id', orderId)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle()

    if (error || !data) {
      throw createError({ statusCode: 404, statusMessage: 'Service order not found' })
    }

    existingOrder = data
  }

  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(orderData, key)
  const pickValue = <T>(key: string, fallback: T) => (hasOwn(key) ? orderData[key] : fallback) as T
  const keepExisting = <T>(key: string, fallback: T) => pickValue(key, (existingOrder?.[key] as T | undefined) ?? fallback)

  // Normalize OS number
  const hasNumberInput = hasOwn('number')
  let osNumber = normalizeOsNumber(hasNumberInput ? orderData.number : existingOrder?.number)

  if (!isUpdate && !osNumber) {
    // Auto-generate number for new orders
    const { data: existingOrders } = await supabase
      .from('service_orders')
      .select('number')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)

    osNumber = computeNextOsNumber(existingOrders || [])
  }

  // Check for duplicate number
  if (osNumber && (!isUpdate || hasNumberInput)) {
    const duplicateQuery = supabase
      .from('service_orders')
      .select('id, number')
      .eq('organization_id', organizationId)
      .eq('number', osNumber)
      .is('deleted_at', null)

    if (isUpdate) {
      duplicateQuery.neq('id', orderId)
    }

    const { data: duplicates } = await duplicateQuery

    if (duplicates && duplicates.length > 0) {
      const { data: allOrders } = await supabase
        .from('service_orders')
        .select('number')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)

      const suggested = computeNextOsNumber(allOrders || [])
      return {
        duplicateNumber: true,
        currentNumber: osNumber,
        suggestedNumber: suggested
      }
    }
  }

  // Prepare order payload
  const orderPayload: Record<string, unknown> = {
    organization_id: organizationId,
    number: osNumber || keepExisting('number', null),
    client_id: keepExisting('client_id', null),
    vehicle_id: keepExisting('vehicle_id', null),
    master_product_id: keepExisting('master_product_id', null),
    employee_responsible_id: keepExisting('employee_responsible_id', null),
    responsible_employees: keepExisting('responsible_employees', []),
    appointment_id: keepExisting('appointment_id', null),
    status: keepExisting('status', 'open'),
    payment_status: keepExisting('payment_status', 'pending'),
    entry_date: keepExisting('entry_date', new Date().toISOString().split('T')[0]),
    expected_date: keepExisting('expected_date', null),
    expected_payment_date: keepExisting('expected_payment_date', null),
    completion_date: keepExisting('completion_date', null),
    reported_defect: keepExisting('reported_defect', null),
    diagnosis: keepExisting('diagnosis', null),
    items: keepExisting('items', []),
    apply_taxes: keepExisting('apply_taxes', false),
    selected_taxes: keepExisting('selected_taxes', []),
    total_taxes_amount: keepExisting('total_taxes_amount', 0),
    total_amount: keepExisting('total_amount', 0),
    total_cost_amount: keepExisting('total_cost_amount', 0),
    discount: keepExisting('discount', 0),
    commission_amount: keepExisting('commission_amount', 0),
    terminal_fee_amount: keepExisting('terminal_fee_amount', 0),
    payment_method: keepExisting('payment_method', null),
    is_installment: keepExisting('is_installment', false),
    installment_count: keepExisting('installment_count', 0),
    notes: keepExisting('notes', null),
    updated_by: authUser.email
  }

  const itemsForCommission = Array.isArray(orderPayload.items) ? orderPayload.items as ServiceOrderCommissionItem[] : []
  const responsiblesForCommission = Array.isArray(orderPayload.responsible_employees)
    ? orderPayload.responsible_employees as Array<{ employee_id?: string | null }>
    : []

  if (itemsForCommission.length > 0 && responsiblesForCommission.length > 0) {
    // Resolve the commission-plan model's rules for every responsible
    // employee, at the order's own entry_date (not "today") — a past-dated
    // OS must resolve the version that was vigente back then, same as the
    // frontend preview and the reports engine already do for their own
    // reads. See docs/finance/commissions-step8-engine-cutover.md.
    const referenceDate = toCommissionMonthStart(String(orderPayload.entry_date || new Date().toISOString().split('T')[0]))
    const rulesByEmployeeId = await resolveEmployeeCommissionRulesForEmployees(
      supabase,
      organizationId,
      responsiblesForCommission.map(responsible => String(responsible.employee_id || '')),
      referenceDate
    )

    // Editing an order (items, discount, taxes, responsibles...) must not
    // silently drop a standing manual commission override (docs/finance/
    // commissions-manual-override.md) — without this, saving any edit to an
    // order that has one active would recompute items[].commissions[] from
    // the employee's standard plan only, until the next "Recalcular" or
    // payment-triggered release papered back over it.
    const existingLog = Array.isArray(existingOrder?.commission_manual_adjustments_log)
      ? existingOrder!.commission_manual_adjustments_log as CommissionManualAdjustmentLogEntry[]
      : []
    const planRulesByPlanId = new Map<string, ResolvedCommissionRule[]>()
    await Promise.all(getActiveOverridePlanIds(existingLog).map(async (planId) => {
      planRulesByPlanId.set(planId, await resolveCommissionPlanRules(supabase, organizationId, planId, referenceDate))
    }))
    const effectiveRulesByEmployeeId = resolveEffectiveCommissionRules(rulesByEmployeeId, existingLog, planRulesByPlanId)

    const commissionSnapshot = computeServiceOrderItemsWithCommissionSnapshots({
      items: itemsForCommission,
      responsibleEmployees: responsiblesForCommission,
      discount: orderPayload.discount,
      totalTaxesAmount: orderPayload.total_taxes_amount,
      rulesByEmployeeId: effectiveRulesByEmployeeId
    })

    orderPayload.items = commissionSnapshot.items
    orderPayload.commission_amount = commissionSnapshot.commissionAmount
  } else {
    orderPayload.items = itemsForCommission.map(item => ({
      ...item,
      commission_total: 0,
      total_commission: 0,
      commissions: []
    }))
    orderPayload.commission_amount = 0
  }

  let savedOrder: SavedOrderRecord

  if (isUpdate) {
    // Update existing order
    const { data, error } = await supabase
      .from('service_orders')
      .update(orderPayload)
      .eq('id', orderId)
      .eq('organization_id', organizationId)
      .select()
      .single()

    if (error) {
      throw createError({ statusCode: 500, statusMessage: `Failed to update service order: ${error.message}` })
    }
    savedOrder = data as SavedOrderRecord
  } else {
    // Create new order
    orderPayload.created_by = authUser.email

    const { data, error } = await supabase
      .from('service_orders')
      .insert(orderPayload)
      .select()
      .single()

    if (error) {
      throw createError({ statusCode: 500, statusMessage: `Failed to create service order: ${error.message}` })
    }
    savedOrder = data as SavedOrderRecord
  }

  // Handle appointment creation if provided
  if (appointmentData && !isUpdate) {
    try {
      const appointmentPayload = {
        organization_id: organizationId,
        client_id: savedOrder.client_id,
        vehicle_id: savedOrder.vehicle_id,
        appointment_date: appointmentData.appointment_date || savedOrder.entry_date,
        time: appointmentData.time || '08:00',
        service_type: appointmentData.service_type || savedOrder.reported_defect || 'Service',
        priority: appointmentData.priority || 'medium',
        status: 'scheduled',
        service_order_id: savedOrder.id,
        notes: appointmentData.notes || null,
        created_by: authUser.email
      }

      const { data: appointment } = await supabase
        .from('appointments')
        .insert(appointmentPayload)
        .select()
        .single()

      if (appointment) {
        // Link appointment to the order
        await supabase
          .from('service_orders')
          .update({ appointment_id: appointment.id })
          .eq('id', savedOrder.id)

        savedOrder.appointment_id = appointment.id
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown appointment creation error'
      warnings.push(`Failed to create appointment: ${message}`)
    }
  }

  return {
    duplicateNumber: false,
    order: savedOrder,
    warnings
  }
})
