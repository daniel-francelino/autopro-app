import { createError } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'

type ReleaseServiceOrderCommissionsParams = {
  supabase: SupabaseClient
  organizationId: string
  orderId: string
  userEmail?: string | null
  // The specific installment/receipt that triggered this call, when known
  // (e.g. paying one installment). Recorded on any commission row created
  // by this call so it's traceable which receipt justified it. Left out
  // when a single call could release commission off more than one receipt
  // at once (e.g. creating a plan with several lines already paid) — there
  // isn't one right answer to link to in that case.
  triggeringInstallmentId?: string | null
}

type EmployeeWithCommission = {
  id: string
  has_commission?: boolean | null
  commission_type?: string | null
  commission_amount?: number | string | null
  commission_base?: string | null
  commission_categories?: string[] | null
}

type EmployeeEntitlement = {
  employeeId: string
  totalAmount: number
  commissionType: string | null
  commissionPercentage: number | null
  commissionBase: string | null
  itemAmount: number
  itemCost: number
}

function asNumber(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2))
}

function getItemQuantity(item: Record<string, unknown>) {
  return asNumber(item.quantity || 1) || 1
}

function getItemTotal(item: Record<string, unknown>) {
  const quantity = getItemQuantity(item)
  const rawTotal = item.total_price ?? item.total_amount
  return rawTotal != null
    ? asNumber(rawTotal)
    : asNumber(item.unit_price) * quantity
}

function getItemCost(item: Record<string, unknown>) {
  return asNumber(item.cost_price ?? item.cost_amount) * getItemQuantity(item)
}

function isMissingCommissionSnapshotColumn(error: { message?: string } | null | undefined) {
  const message = String(error?.message || '')
  if (!message) return false

  return [
    'commission_type',
    'commission_percentage',
    'commission_base',
    'item_name',
    'item_amount',
    'item_cost'
  ].some(column => message.includes(`'${column}'`) || message.includes(`"${column}"`))
}

/**
 * Computes, per responsible employee, the *total* commission they're
 * entitled to for this order — independent of how much of the order has
 * actually been paid. Pure calculation, no DB writes.
 */
function computeEmployeeEntitlements({
  order,
  employeeMap
}: {
  order: Record<string, unknown>
  employeeMap: Map<string, EmployeeWithCommission>
}): EmployeeEntitlement[] {
  const items = Array.isArray(order.items) ? order.items as Record<string, unknown>[] : []
  const responsibleEmployees = Array.isArray(order.responsible_employees)
    ? order.responsible_employees as { employee_id: string }[]
    : []

  if (responsibleEmployees.length === 0 || items.length === 0) return []

  const subtotal = items.reduce((sum, item) => sum + getItemTotal(item), 0)
  const discountAmount = asNumber(order.discount)
  const taxesAmount = asNumber(order.total_taxes_amount)

  const entitlements: EmployeeEntitlement[] = []

  for (const responsible of responsibleEmployees) {
    const employeeId = responsible.employee_id
    const employee = employeeMap.get(employeeId)

    if (!employee || !employee.has_commission) continue

    const commissionType = employee.commission_type
    const commissionValue = asNumber(employee.commission_amount)
    const commissionBase = employee.commission_base
    const commissionCategories = Array.isArray(employee.commission_categories)
      ? employee.commission_categories
      : []

    const eligibleItems = items.filter((item) => {
      if (commissionCategories.length === 0) return true

      const itemCategoryId = item.category_id
      return !itemCategoryId || commissionCategories.includes(itemCategoryId as string)
    })

    if (eligibleItems.length === 0) continue

    const eligibleItemAmount = eligibleItems.reduce((sum, item) => sum + getItemTotal(item), 0)
    const eligibleItemCost = eligibleItems.reduce((sum, item) => sum + getItemCost(item), 0)
    let employeeCommissionAmount = 0

    if (commissionType === 'percentage') {
      const eligibleRatio = subtotal > 0 ? eligibleItemAmount / subtotal : 0
      const eligibleDiscount = discountAmount * eligibleRatio
      const eligibleTaxes = taxesAmount * eligibleRatio

      for (const item of eligibleItems) {
        const itemTotal = getItemTotal(item)
        const fraction = eligibleItemAmount > 0 ? itemTotal / eligibleItemAmount : 1 / eligibleItems.length
        const itemDiscount = eligibleDiscount * fraction
        const itemTaxes = eligibleTaxes * fraction
        let baseAmount = itemTotal - itemDiscount

        if (commissionBase === 'profit') {
          baseAmount = Math.max(0, baseAmount - getItemCost(item) - itemTaxes)
        }

        employeeCommissionAmount += roundCurrency((baseAmount * commissionValue) / 100)
      }
    } else {
      employeeCommissionAmount = commissionValue
    }

    if (employeeCommissionAmount <= 0) continue

    entitlements.push({
      employeeId,
      totalAmount: roundCurrency(employeeCommissionAmount),
      commissionType,
      commissionPercentage: commissionType === 'percentage' ? commissionValue : null,
      commissionBase,
      itemAmount: roundCurrency(eligibleItemAmount),
      itemCost: roundCurrency(eligibleItemCost)
    })
  }

  return entitlements
}

/**
 * Releases commission proportionally to how much of the order has actually
 * been received so far — never the calculated total upfront. Every call
 * (triggered whenever a receipt against the order is confirmed) recomputes
 * each employee's entitlement and how much of it is now justified, and tops
 * up with a brand new `pending` record for the difference. Existing records
 * — pending or already paid — are never edited or deleted, so a commission
 * that's already been paid out can't be silently erased or reduced; if a
 * later recalculation would imply paying back something already paid, that
 * is surfaced as a warning for manual reconciliation instead.
 *
 * When `order.commission_release_mode === 'full'` (set once, on the order,
 * when the payment plan is generated — see process-payment.post.ts), the
 * received ratio is pinned at 1 regardless of what's actually been paid, so
 * the whole entitlement is released immediately instead of proportionally.
 */
export async function releaseServiceOrderCommissions({
  supabase,
  organizationId,
  orderId,
  userEmail,
  triggeringInstallmentId
}: ReleaseServiceOrderCommissionsParams) {
  const warnings: string[] = []

  const { data: order } = await supabase
    .from('service_orders')
    .select('*')
    .eq('id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!order) {
    throw createError({ statusCode: 404, statusMessage: 'Service order not found' })
  }

  const { data: employees } = await supabase
    .from('employees')
    .select('*')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)

  const employeeMap = new Map(
    ((employees || []) as EmployeeWithCommission[]).map(employee => [employee.id, employee])
  )

  const entitlements = computeEmployeeEntitlements({ order, employeeMap })
  const totalCommission = roundCurrency(entitlements.reduce((sum, entitlement) => sum + entitlement.totalAmount, 0))

  await supabase
    .from('service_orders')
    .update({ commission_amount: totalCommission, updated_by: userEmail || null })
    .eq('id', orderId)

  if (entitlements.length === 0) {
    return {
      orderId,
      commissions: [],
      totalCommission: 0,
      warnings: ['No responsible employees with commission, or no items, on this service order']
    }
  }

  const { data: paidInstallments } = await supabase
    .from('service_order_installments')
    .select('amount')
    .eq('service_order_id', orderId)
    .eq('organization_id', organizationId)
    .eq('status', 'paid')
    .is('deleted_at', null)

  const receivedTotal = (paidInstallments || []).reduce((sum, row) => sum + asNumber(row.amount), 0)
  const totalAmount = asNumber(order.total_amount)
  const receivedRatio = order.commission_release_mode === 'full'
    ? 1
    : totalAmount > 0 ? Math.min(1, Math.max(0, receivedTotal / totalAmount)) : 0

  const { data: existingRecords } = await supabase
    .from('employee_financial_records')
    .select('id, employee_id, amount, status, created_at')
    .eq('service_order_id', orderId)
    .eq('record_type', 'commission')
    .eq('organization_id', organizationId)

  const recordsByEmployee = new Map<string, { id: string, amount: number, status: string, created_at: string }[]>()
  for (const record of existingRecords || []) {
    const key = String(record.employee_id)
    const list = recordsByEmployee.get(key) || []
    list.push({ id: record.id, amount: asNumber(record.amount), status: record.status, created_at: record.created_at })
    recordsByEmployee.set(key, list)
  }

  const createdCommissions: unknown[] = []

  for (const entitlement of entitlements) {
    const released = roundCurrency(Math.min(entitlement.totalAmount, entitlement.totalAmount * receivedRatio))
    const existingForEmployee = recordsByEmployee.get(entitlement.employeeId) || []
    const existingSum = roundCurrency(existingForEmployee.reduce((sum, record) => sum + record.amount, 0))
    const delta = roundCurrency(released - existingSum)

    if (delta >= 0.01) {
      const basePayload = {
        organization_id: organizationId,
        employee_id: entitlement.employeeId,
        service_order_id: orderId,
        service_order_installment_id: triggeringInstallmentId || null,
        record_type: 'commission',
        amount: delta,
        status: 'pending',
        description: `Comissão - #${order.number}`,
        reference_date: order.entry_date || new Date().toISOString().split('T')[0],
        created_by: userEmail || null,
        updated_by: userEmail || null
      }

      const snapshotPayload = {
        commission_type: entitlement.commissionType,
        commission_percentage: entitlement.commissionPercentage,
        commission_base: entitlement.commissionBase,
        item_name: `#${order.number}`,
        item_amount: entitlement.itemAmount,
        item_cost: entitlement.itemCost
      }

      let { data: commissionRecord, error: commissionError } = await supabase
        .from('employee_financial_records')
        .insert({ ...basePayload, ...snapshotPayload })
        .select()
        .single()

      if (commissionError && isMissingCommissionSnapshotColumn(commissionError)) {
        ({ data: commissionRecord, error: commissionError } = await supabase
          .from('employee_financial_records')
          .insert(basePayload)
          .select()
          .single())
      }

      if (commissionError) {
        throw createError({ statusCode: 500, statusMessage: commissionError.message })
      }

      if (commissionRecord) createdCommissions.push(commissionRecord)
    } else if (delta <= -0.01) {
      // Receipts were reversed since the last release — claw back from
      // pending records first (most recent first), never from ones already
      // paid out.
      let remainingToRemove = Math.abs(delta)
      const pendingRecords = existingForEmployee
        .filter(record => record.status === 'pending')
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

      for (const record of pendingRecords) {
        if (remainingToRemove <= 0.01) break

        if (record.amount <= remainingToRemove + 0.01) {
          await supabase.from('employee_financial_records').delete().eq('id', record.id)
          remainingToRemove = roundCurrency(remainingToRemove - record.amount)
        } else {
          await supabase
            .from('employee_financial_records')
            .update({ amount: roundCurrency(record.amount - remainingToRemove), updated_by: userEmail || null })
            .eq('id', record.id)
          remainingToRemove = 0
        }
      }

      if (remainingToRemove > 0.01) {
        warnings.push(
          `Funcionário ${entitlement.employeeId}: comissão já paga (${remainingToRemove.toFixed(2)}) excede o valor agora liberado. Requer reconciliação manual.`
        )
      }
    }
  }

  return {
    orderId,
    commissions: createdCommissions,
    totalCommission,
    warnings
  }
}
