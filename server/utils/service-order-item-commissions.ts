import {
  computeEmployeeOrderCommission,
  toCommissionOrderItemInput,
  type ResolvedCommissionRule
} from '../../shared/utils/employee-commission-engine'

export type ServiceOrderCommissionEmployee = {
  id: string
}

export type ServiceOrderCommissionItem = Record<string, unknown>

type ServiceOrderResponsibleEmployeeRef = {
  employee_id?: string | null
}

function toNumber(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2))
}

/**
 * Snapshot per item, called from POST /api/service-orders on both create and
 * edit. `rulesByEmployeeId` is pre-fetched once per order (not per item) by
 * the caller via resolveEmployeeCommissionRulesForEmployees() — this
 * function stays synchronous/pure given that data.
 *
 * Step 10 (docs/finance/commissions-configuration-architecture.md): the
 * legacy employees.has_commission/commission_type/commission_amount/
 * commission_base/commission_categories fallback (for employees with no
 * plan assigned in the new model) was removed along with those columns —
 * every responsible employee is now resolved exclusively through
 * `rulesByEmployeeId`. An employee with no entry (or an empty one) there
 * simply earns no commission on this order; see
 * docs/finance/commissions-step8-engine-cutover.md §6 for how the Step 8
 * cutover reached this point via a fallback that's no longer needed.
 */
export function computeServiceOrderItemsWithCommissionSnapshots({
  items,
  responsibleEmployees,
  discount,
  totalTaxesAmount,
  rulesByEmployeeId
}: {
  items: ServiceOrderCommissionItem[]
  responsibleEmployees: ServiceOrderResponsibleEmployeeRef[]
  discount: unknown
  totalTaxesAmount: unknown
  rulesByEmployeeId: Map<string, ResolvedCommissionRule[]>
}) {
  const itemEntries = items.map(item => ({
    ...item,
    commission_total: 0,
    total_commission: 0,
    commissions: [] as Record<string, unknown>[]
  }))
  const discountAmount = toNumber(discount)
  const taxesAmount = toNumber(totalTaxesAmount)

  for (const responsible of responsibleEmployees) {
    const employeeId = responsible.employee_id
    if (!employeeId) continue

    const rules = rulesByEmployeeId.get(employeeId) ?? []
    if (rules.length === 0) continue

    const commissionOrderItems = itemEntries.map(item => toCommissionOrderItemInput({
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

    result.perItem.forEach((matched, index) => {
      if (!matched || matched.amount <= 0) return
      const item = itemEntries[index]!

      item.commission_total = roundCurrency(toNumber(item.commission_total) + matched.amount)
      item.total_commission = item.commission_total
      item.commissions.push({
        employee_id: employeeId,
        amount: matched.amount,
        commission_type: matched.rule.commission_type,
        commission_base: matched.rule.commission_base,
        commission_percentage: matched.rule.commission_type === 'percentage' ? matched.rule.commission_amount : null,
        commission_plan_id: matched.rule.plan_id,
        commission_rule_id: matched.rule.id,
        commission_rule_version_id: matched.rule.version_id
      })
    })
  }

  return {
    items: itemEntries,
    commissionAmount: roundCurrency(itemEntries.reduce((sum, item) => sum + toNumber(item.commission_total), 0))
  }
}
