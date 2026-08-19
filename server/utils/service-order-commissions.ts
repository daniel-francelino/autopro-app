import { createError } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computeEmployeeOrderCommission,
  toCommissionOrderItemInput,
  toMonthStart,
  type ResolvedCommissionRule
} from '../../shared/utils/employee-commission-engine'
import { resolveEmployeeCommissionRulesForEmployees } from './employee-commission-plans'

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
  /** Set only when every item contributing to totalAmount matched the SAME rule (see the doc comment on computeEmployeeEntitlements). Null otherwise — an aggregate across multiple rules/categories can't be attributed to one. */
  commissionPlanId: string | null
  commissionRuleId: string | null
  commissionRuleVersionId: string | null
  commissionRuleName: string | null
  commissionAmountSnapshot: number | null
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
    'item_cost',
    'commission_plan_id',
    'commission_rule_id',
    'commission_rule_version_id',
    'commission_rule_name',
    'commission_amount_snapshot'
  ].some(column => message.includes(`'${column}'`) || message.includes(`"${column}"`))
}

/**
 * Computes, per responsible employee, the *total* commission they're
 * entitled to for this order — independent of how much of the order has
 * actually been paid. Pure calculation, no DB writes.
 *
 * Step 8 cutover (docs/finance/commissions-step8-engine-cutover.md): an
 * employee with a non-empty entry in `rulesByEmployeeId` is resolved
 * EXCLUSIVELY through the new commission-plan model — never falls back to
 * the legacy employees.* columns for this order, even if no item matches
 * any of their rules. Only employees with no resolved rules at all use the
 * legacy calculation, unchanged from before this cutover.
 *
 * The new model can attribute different items to different rules (a
 * category-specific rule at one rate, a catch-all at another) — something
 * the legacy model never had to represent, since it only ever had one rate
 * per employee. employee_financial_records still holds one aggregate row
 * per employee per release event (that ledger's pending/paid/received-ratio
 * reconciliation logic, see releaseServiceOrderCommissions below, is
 * unchanged and deliberately NOT re-derived per rule — too risky to touch
 * for this cutover). So the per-rule traceability columns
 * (commissionRuleId/RuleVersionId/RuleName/AmountSnapshot) are only filled
 * in when every item contributing to this employee's total matched the SAME
 * single rule; left null when more than one distinct rule contributed
 * (commissionPlanId is still filled in when every contributing rule shares
 * the same plan, even if the rules themselves differ).
 */
function computeEmployeeEntitlements({
  order,
  employeeMap,
  rulesByEmployeeId
}: {
  order: Record<string, unknown>
  employeeMap: Map<string, EmployeeWithCommission>
  rulesByEmployeeId?: Map<string, ResolvedCommissionRule[]>
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
    if (!employee) continue

    const rules = rulesByEmployeeId?.get(employeeId) ?? []

    if (rules.length > 0) {
      const commissionOrderItems = items.map(item => toCommissionOrderItemInput({
        category_id: item.category_id as string | null,
        quantity: item.quantity as number | string | null,
        total_price: item.total_price as number | string | null,
        total_amount: item.total_amount as number | string | null,
        unit_price: item.unit_price as number | string | null,
        cost_price: item.cost_price as number | string | null,
        cost_amount: item.cost_amount as number | string | null
      }))

      const result = computeEmployeeOrderCommission(rules, commissionOrderItems, {
        discount: discountAmount,
        totalTaxesAmount: taxesAmount
      })

      if (result.total <= 0) continue

      const matchedEntries = result.perItem.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      const distinctRuleIds = new Set(matchedEntries.map(entry => entry.rule.id))
      const distinctPlanIds = new Set(matchedEntries.map(entry => entry.rule.plan_id))
      const singleRule = distinctRuleIds.size === 1 ? matchedEntries[0]!.rule : null

      let eligibleItemAmount = 0
      let eligibleItemCost = 0
      result.perItem.forEach((entry, index) => {
        if (!entry) return
        const item = items[index]!
        eligibleItemAmount += getItemTotal(item)
        eligibleItemCost += getItemCost(item)
      })

      entitlements.push({
        employeeId,
        totalAmount: result.total,
        commissionType: singleRule?.commission_type ?? null,
        commissionPercentage: singleRule?.commission_type === 'percentage' ? singleRule.commission_amount : null,
        commissionBase: singleRule?.commission_base ?? null,
        itemAmount: roundCurrency(eligibleItemAmount),
        itemCost: roundCurrency(eligibleItemCost),
        commissionPlanId: distinctPlanIds.size === 1 ? [...distinctPlanIds][0]! : null,
        commissionRuleId: singleRule?.id ?? null,
        commissionRuleVersionId: singleRule?.version_id ?? null,
        commissionRuleName: singleRule?.name ?? null,
        commissionAmountSnapshot: singleRule ? result.total : null
      })

      continue
    }

    if (!employee.has_commission) continue

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
      itemCost: roundCurrency(eligibleItemCost),
      commissionPlanId: null,
      commissionRuleId: null,
      commissionRuleVersionId: null,
      commissionRuleName: null,
      commissionAmountSnapshot: null
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

  const responsibleEmployeeIds = Array.isArray(order.responsible_employees)
    ? (order.responsible_employees as { employee_id?: string | null }[]).map(entry => String(entry.employee_id || ''))
    : []
  const referenceDate = toMonthStart(String(order.entry_date || new Date().toISOString().split('T')[0]))
  const rulesByEmployeeId = await resolveEmployeeCommissionRulesForEmployees(
    supabase,
    organizationId,
    responsibleEmployeeIds,
    referenceDate
  )

  const entitlements = computeEmployeeEntitlements({ order, employeeMap, rulesByEmployeeId })
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
        item_cost: entitlement.itemCost,
        // New-model traceability (20240101000085) — only set when the whole
        // entitlement came from one single rule (see computeEmployeeEntitlements'
        // doc comment); null for legacy-path entitlements and for
        // multi-rule entitlements that can't be attributed to one rule.
        commission_plan_id: entitlement.commissionPlanId,
        commission_rule_id: entitlement.commissionRuleId,
        commission_rule_version_id: entitlement.commissionRuleVersionId,
        commission_rule_name: entitlement.commissionRuleName,
        commission_amount_snapshot: entitlement.commissionAmountSnapshot
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
