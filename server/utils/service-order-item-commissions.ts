import {
  computeEmployeeOrderCommission,
  toCommissionOrderItemInput,
  type ResolvedCommissionRule
} from '../../shared/utils/employee-commission-engine'

export type ServiceOrderCommissionEmployee = {
  id: string
  has_commission?: boolean | null
  commission_type?: string | null
  commission_amount?: number | string | null
  commission_base?: string | null
  commission_categories?: string[] | null
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

function getItemQuantity(item: ServiceOrderCommissionItem) {
  return toNumber(item.quantity || 1) || 1
}

function getItemTotal(item: ServiceOrderCommissionItem) {
  const quantity = getItemQuantity(item)
  const rawTotal = item.total_price ?? item.total_amount
  return rawTotal != null
    ? toNumber(rawTotal)
    : toNumber(item.unit_price) * quantity
}

function getItemCost(item: ServiceOrderCommissionItem) {
  return toNumber(item.cost_price ?? item.cost_amount) * getItemQuantity(item)
}

/**
 * Step 8 cutover (docs/finance/commissions-step8-engine-cutover.md): snapshot
 * per item, called from POST /api/service-orders on both create and edit.
 * `rulesByEmployeeId` is pre-fetched once per order (not per item) by the
 * caller via resolveEmployeeCommissionRulesForEmployees() —
 * this function stays synchronous/pure given that data.
 *
 * Per responsible employee: an employee with a non-empty entry in
 * `rulesByEmployeeId` uses the new commission-plan model exclusively for
 * this order — never falls back to the legacy employees.* columns, even if
 * no item on this order matches any of their rules (see
 * computeEmployeeOrderCommission()'s own doc comment). Only employees with
 * NO resolved rules at all (no plan assigned covering this order's
 * reference date) use the legacy calculation below, unchanged from before
 * this cutover.
 */
export function computeServiceOrderItemsWithCommissionSnapshots({
  items,
  responsibleEmployees,
  employees,
  discount,
  totalTaxesAmount,
  rulesByEmployeeId
}: {
  items: ServiceOrderCommissionItem[]
  responsibleEmployees: ServiceOrderResponsibleEmployeeRef[]
  employees: ServiceOrderCommissionEmployee[]
  discount: unknown
  totalTaxesAmount: unknown
  rulesByEmployeeId?: Map<string, ResolvedCommissionRule[]>
}) {
  const itemEntries = items.map(item => ({
    ...item,
    commission_total: 0,
    total_commission: 0,
    commissions: [] as Record<string, unknown>[]
  }))
  const subtotal = itemEntries.reduce((sum, item) => sum + getItemTotal(item), 0)
  const discountAmount = toNumber(discount)
  const taxesAmount = toNumber(totalTaxesAmount)

  for (const responsible of responsibleEmployees) {
    const employee = employees.find(item => item.id === responsible.employee_id)
    if (!employee) continue

    const rules = rulesByEmployeeId?.get(employee.id) ?? []

    if (rules.length > 0) {
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
          employee_id: employee.id,
          amount: matched.amount,
          commission_type: matched.rule.commission_type,
          commission_base: matched.rule.commission_base,
          commission_percentage: matched.rule.commission_type === 'percentage' ? matched.rule.commission_amount : null,
          commission_plan_id: matched.rule.plan_id,
          commission_rule_id: matched.rule.id,
          commission_rule_version_id: matched.rule.version_id
        })
      })

      continue
    }

    if (!employee.has_commission) continue

    const commissionType = employee.commission_type ?? null
    const commissionBase = employee.commission_base ?? null
    const commissionAmount = toNumber(employee.commission_amount)
    const commissionCategories = Array.isArray(employee.commission_categories) ? employee.commission_categories : []
    const eligibleEntries = itemEntries
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (commissionCategories.length === 0) return true

        const itemCategoryId = item.category_id
        return !itemCategoryId || commissionCategories.includes(String(itemCategoryId))
      })

    if (!eligibleEntries.length) continue

    const eligibleSale = eligibleEntries.reduce((sum, { item }) => sum + getItemTotal(item), 0)
    const eligibleRatio = subtotal > 0 ? eligibleSale / subtotal : 0
    const eligibleDiscount = discountAmount * eligibleRatio
    const eligibleTaxes = taxesAmount * eligibleRatio

    if (commissionType === 'percentage') {
      for (const { item } of eligibleEntries) {
        const itemTotal = getItemTotal(item)
        const fraction = eligibleSale > 0 ? itemTotal / eligibleSale : 1 / eligibleEntries.length
        const itemDiscount = eligibleDiscount * fraction
        const itemTaxes = eligibleTaxes * fraction
        let baseAmount = itemTotal - itemDiscount

        if (commissionBase === 'profit') {
          baseAmount = Math.max(0, baseAmount - getItemCost(item) - itemTaxes)
        }

        const amount = roundCurrency((baseAmount * commissionAmount) / 100)
        if (amount <= 0) continue

        item.commission_total = roundCurrency(toNumber(item.commission_total) + amount)
        item.total_commission = item.commission_total
        item.commissions.push({
          employee_id: employee.id,
          amount,
          commission_type: commissionType,
          commission_base: commissionBase,
          commission_percentage: commissionAmount
        })
      }
      continue
    }

    const perItem = roundCurrency(commissionAmount / eligibleEntries.length)
    const distributed = roundCurrency(perItem * eligibleEntries.length)
    const remainder = roundCurrency(commissionAmount - distributed)

    eligibleEntries.forEach(({ item }, index) => {
      const amount = index === 0 ? roundCurrency(perItem + remainder) : perItem
      if (amount <= 0) return

      item.commission_total = roundCurrency(toNumber(item.commission_total) + amount)
      item.total_commission = item.commission_total
      item.commissions.push({
        employee_id: employee.id,
        amount,
        commission_type: commissionType,
        commission_base: commissionBase,
        commission_percentage: null
      })
    })
  }

  return {
    items: itemEntries,
    commissionAmount: roundCurrency(itemEntries.reduce((sum, item) => sum + toNumber(item.commission_total), 0))
  }
}
