import { createError, defineEventHandler, getRouterParam } from 'h3'
import { normalizeReportStatus, roundMoney, toNumber } from '../../../utils/report-helpers'
import { resolveOrganizationId } from '../../../utils/organization'
import { requireAuthUser } from '../../../utils/require-auth'
import { getSupabaseAdminClient } from '../../../utils/supabase'

function normalizeId(value: unknown) {
  const id = String(value ?? '').trim()
  return id.length > 0 ? id : null
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeCommissionType(value: unknown) {
  const type = String(value ?? '').trim().toLowerCase()
  if (['percentage', 'percentual'].includes(type))
    return 'percentage'
  if (['fixed', 'fixed_amount', 'valor_fixo'].includes(type))
    return 'fixed'
  return type || null
}

function normalizeCommissionBase(value: unknown) {
  const base = String(value ?? '').trim().toLowerCase()
  if (['profit', 'lucro'].includes(base))
    return 'profit'
  if (['revenue', 'faturamento'].includes(base))
    return 'revenue'
  return base || null
}

function getItemName(item: any, index: number) {
  return String(item?.name || item?.description || `Item ${index + 1}`)
}

function getItemQuantity(item: any) {
  return Math.max(1, toNumber(item?.quantity, 1))
}

function getItemSaleAmount(item: any, quantity: number) {
  const totalAmount = toNumber(item?.total_amount, Number.NaN)
  if (Number.isFinite(totalAmount) && totalAmount > 0)
    return roundMoney(totalAmount)

  const totalPrice = toNumber(item?.total_price, Number.NaN)
  if (Number.isFinite(totalPrice) && totalPrice > 0)
    return roundMoney(totalPrice)

  const salePrice = toNumber(item?.sale_price, Number.NaN)
  if (Number.isFinite(salePrice) && salePrice > 0)
    return roundMoney(salePrice * quantity)

  const unitPrice = toNumber(item?.unit_price, 0)
  return roundMoney(unitPrice * quantity)
}

function getItemCostAmount(item: any, quantity: number) {
  const totalCost = toNumber(item?.cost_amount, Number.NaN)
  if (Number.isFinite(totalCost) && totalCost > 0)
    return roundMoney(totalCost)

  const unitCost = toNumber(item?.cost_price, 0)
  return roundMoney(unitCost * quantity)
}

function getVehicleLabel(vehicle: any) {
  if (!vehicle)
    return null

  return [vehicle.brand, vehicle.model, vehicle.license_plate].filter(Boolean).join(' • ') || null
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Commission id is required' })
  }

  const { data: commission, error: commissionError } = await supabase
    .from('employee_financial_records')
    .select('*')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (commissionError || !commission) {
    throw createError({ statusCode: 404, statusMessage: 'Comissão não encontrada' })
  }

  const orderId = normalizeId(commission.service_order_id)

  const { data: order } = orderId
    ? await supabase
        .from('service_orders')
        .select('*')
        .eq('id', orderId)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .maybeSingle()
    : { data: null }

  const [clientResult, vehicleResult, orderCommissionsResult] = order
    ? await Promise.all([
        order.client_id
          ? supabase.from('clients').select('id, name, phone, email').eq('id', order.client_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        order.vehicle_id
          ? supabase.from('vehicles').select('id, brand, model, license_plate').eq('id', order.vehicle_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from('employee_financial_records')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('service_order_id', order.id)
          .eq('record_type', 'commission')
          .order('reference_date', { ascending: false })
      ])
    : [
        { data: null, error: null },
        { data: null, error: null },
        { data: [], error: null }
      ]

  const employeeIds = new Set<string>()
  const commissionEmployeeId = normalizeId(commission.employee_id)

  if (commissionEmployeeId)
    employeeIds.add(commissionEmployeeId)

  for (const related of orderCommissionsResult.data || []) {
    const employeeId = normalizeId(related.employee_id)
    if (employeeId)
      employeeIds.add(employeeId)
  }

  for (const responsible of Array.isArray(order?.responsible_employees) ? order.responsible_employees : []) {
    const employeeId = normalizeId(responsible?.employee_id)
    if (employeeId)
      employeeIds.add(employeeId)
  }

  const { data: employees } = employeeIds.size > 0
    ? await supabase
        .from('employees')
        .select('id, name, role')
        .eq('organization_id', organizationId)
        .in('id', Array.from(employeeIds))
        .is('deleted_at', null)
    : { data: [] }

  const employeesMap = new Map(
    (employees || [])
      .map((employee: any) => [normalizeId(employee.id), employee] as const)
      .filter((entry): entry is [string, any] => Boolean(entry[0]))
  )
  const currentEmployee = commissionEmployeeId ? employeesMap.get(commissionEmployeeId) ?? null : null

  const items = Array.isArray(order?.items) ? order.items : []
  let breakdown: any[] = items
    .map((item: any, index: number) => {
      const itemCommissions = Array.isArray(item?.commissions) ? item.commissions : []
      const matchedCommission = itemCommissions.find((entry: any) => normalizeId(entry?.employee_id) === commissionEmployeeId)

      if (!matchedCommission)
        return null

      const quantity = getItemQuantity(item)
      const saleAmount = getItemSaleAmount(item, quantity)
      const costAmount = getItemCostAmount(item, quantity)
      const itemName = getItemName(item, index)
      const commissionAmount = roundMoney(toNumber(matchedCommission?.amount, 0))

      return {
        itemKey: `${normalizeText(itemName)}-${index}`,
        itemName,
        quantity,
        unitPrice: quantity > 0 ? roundMoney(saleAmount / quantity) : 0,
        saleAmount,
        costAmount,
        profitAmount: roundMoney(saleAmount - costAmount),
        commissionAmount,
        commissionType: normalizeCommissionType(matchedCommission?.type || commission.commission_type),
        commissionBase: normalizeCommissionBase(matchedCommission?.base || commission.commission_base),
        commissionPercentage: matchedCommission?.percentage != null
          ? toNumber(matchedCommission.percentage, 0)
          : (normalizeCommissionType(commission.commission_type) === 'percentage'
              ? toNumber(commission.commission_percentage, 0)
              : null),
        isCurrentRecord: normalizeText(itemName) === normalizeText(commission.item_name)
          && Math.abs(commissionAmount - toNumber(commission.amount, 0)) < 0.01
      }
    })
    .filter(Boolean)

  if (breakdown.length === 0) {
    const fallbackAmount = roundMoney(toNumber(commission.item_amount, 0))
    const fallbackCost = roundMoney(toNumber(commission.item_cost, 0))

    breakdown = [{
      itemKey: String(commission.id),
      itemName: String(commission.item_name || 'Item da comissão'),
      quantity: 1,
      unitPrice: fallbackAmount,
      saleAmount: fallbackAmount,
      costAmount: fallbackCost,
      profitAmount: roundMoney(fallbackAmount - fallbackCost),
      commissionAmount: roundMoney(toNumber(commission.amount, 0)),
      commissionType: normalizeCommissionType(commission.commission_type),
      commissionBase: normalizeCommissionBase(commission.commission_base),
      commissionPercentage: normalizeCommissionType(commission.commission_type) === 'percentage'
        ? toNumber(commission.commission_percentage, 0)
        : null,
      isCurrentRecord: true
    }]
  } else if (!breakdown.some((item: any) => item.isCurrentRecord)) {
    const sameName = breakdown.find((item: any) => normalizeText(item.itemName) === normalizeText(commission.item_name))
    if (sameName) {
      sameName.isCurrentRecord = true
    } else if (breakdown.length === 1) {
      breakdown[0]!.isCurrentRecord = true
    }
  }

  const currentBreakdown = breakdown.find((item: any) => item.isCurrentRecord) || breakdown[0]
  const relatedCommissions = (orderCommissionsResult.data || []).map((record: any) => ({
    id: String(record.id),
    employeeId: normalizeId(record.employee_id),
    employeeName: String(employeesMap.get(normalizeId(record.employee_id) || '')?.name || 'Funcionário'),
    itemName: String(record.item_name || 'Item'),
    amount: roundMoney(toNumber(record.amount, 0)),
    status: normalizeReportStatus(record.status),
    referenceDate: record.reference_date || record.date || null,
    paymentDate: record.payment_date || null,
    isCurrent: String(record.id) === String(commission.id)
  }))

  const responsibleNames = (Array.isArray(order?.responsible_employees) ? order.responsible_employees : [])
    .map((responsible: any) => {
      const employeeId = normalizeId(responsible?.employee_id)
      return String((employeeId ? employeesMap.get(employeeId)?.name : '') || '').trim()
    })
    .filter(Boolean)

  return {
    data: {
      detail: {
        id: String(commission.id),
        amount: roundMoney(toNumber(commission.amount, 0)),
        status: normalizeReportStatus(commission.status),
        referenceDate: commission.reference_date || commission.date || null,
        paymentDate: commission.payment_date || null,
        description: commission.description || null,
        employee: {
          id: commissionEmployeeId,
          name: String(currentEmployee?.name || 'Funcionário'),
          role: currentEmployee?.role || null,
          commissionType: normalizeCommissionType(commission.commission_type),
          commissionBase: normalizeCommissionBase(commission.commission_base),
          // Snapshot of the rule applied to THIS commission, not the
          // employee's current configuration — a historical record must
          // keep explaining itself the same way even if the employee's
          // configuration later changes.
          commissionValue: commission.commission_amount_snapshot != null
            ? toNumber(commission.commission_amount_snapshot, 0)
            : null
        },
        order: {
          id: order ? String(order.id) : null,
          number: order?.number ? String(order.number) : null,
          status: order?.status || null,
          paymentStatus: order?.payment_status ? normalizeReportStatus(order.payment_status) : null,
          entryDate: order?.entry_date || null,
          completionDate: order?.completion_date || null,
          totalAmount: roundMoney(toNumber(order?.total_amount, 0)),
          discount: roundMoney(toNumber(order?.discount, 0)),
          paymentMethod: order?.payment_method || null,
          clientName: clientResult.data?.name || order?.client_name || null,
          clientPhone: clientResult.data?.phone || null,
          clientEmail: clientResult.data?.email || null,
          vehicleLabel: getVehicleLabel(vehicleResult.data),
          reportedDefect: order?.reported_defect || null,
          diagnosis: order?.diagnosis || null,
          commissionReleaseMode: order?.commission_release_mode || 'proportional',
          responsibleNames
        },
        calculation: {
          source: items.length > 0 ? 'order_items' : 'record_fields',
          note: items.length > 0
            ? 'Cálculo reconstruído com base nos itens e nas comissões persistidas na OS.'
            : 'Cálculo exibido a partir dos campos salvos diretamente no registro da comissão.',
          itemName: currentBreakdown?.itemName || String(commission.item_name || 'Item da comissão'),
          itemAmount: currentBreakdown?.saleAmount ?? roundMoney(toNumber(commission.item_amount, 0)),
          itemCost: currentBreakdown?.costAmount ?? roundMoney(toNumber(commission.item_cost, 0)),
          profitAmount: currentBreakdown?.profitAmount ?? roundMoney(toNumber(commission.item_amount, 0) - toNumber(commission.item_cost, 0)),
          baseAmount: currentBreakdown
            ? (currentBreakdown.commissionBase === 'profit' ? currentBreakdown.profitAmount : currentBreakdown.saleAmount)
            : (normalizeCommissionBase(commission.commission_base) === 'profit'
                ? roundMoney(toNumber(commission.item_amount, 0) - toNumber(commission.item_cost, 0))
                : roundMoney(toNumber(commission.item_amount, 0))),
          commissionType: currentBreakdown?.commissionType || normalizeCommissionType(commission.commission_type),
          commissionBase: currentBreakdown?.commissionBase || normalizeCommissionBase(commission.commission_base),
          commissionPercentage: currentBreakdown?.commissionPercentage
            ?? (normalizeCommissionType(commission.commission_type) === 'percentage'
              ? toNumber(commission.commission_percentage, 0)
              : null),
          breakdown,
          employeeOrderTotal: roundMoney(relatedCommissions
            .filter((record: any) => record.employeeId === commissionEmployeeId)
            .reduce((sum: number, record: any) => sum + toNumber(record.amount, 0), 0)),
          orderCommissionTotal: roundMoney(
            order?.commission_amount != null
              ? toNumber(order.commission_amount, 0)
              : relatedCommissions.reduce((sum: number, record: any) => sum + toNumber(record.amount, 0), 0)
          )
        },
        relatedCommissions
      }
    }
  }
})
