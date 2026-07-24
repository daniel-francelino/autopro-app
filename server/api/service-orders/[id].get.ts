import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'

/**
 * GET /api/service-orders/:id
 * Fetches full service order details with related data.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const orderId = getRouterParam(event, 'id')

  if (!orderId) {
    throw createError({ statusCode: 400, statusMessage: 'orderId is required' })
  }

  // Fetch order and verify organization
  const { data: order, error: orderError } = await supabase
    .from('service_orders')
    .select('*')
    .eq('id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (orderError || !order) {
    throw createError({ statusCode: 404, statusMessage: 'Service order not found' })
  }

  // Fetch related data in parallel
  const [clientResult, vehicleResult, masterProductResult, employeesResult, installmentsResult, paidTransactionsResult, commissionsResult, editLogsResult] = await Promise.all([
    order.client_id
      ? supabase.from('clients').select('*').eq('id', order.client_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    order.vehicle_id
      ? supabase.from('vehicles').select('*').eq('id', order.vehicle_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    order.master_product_id
      ? supabase.from('master_products').select('*').eq('id', order.master_product_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('employees').select('*').eq('organization_id', organizationId).is('deleted_at', null),
    supabase.from('service_order_installments').select('*').eq('service_order_id', orderId).eq('organization_id', organizationId).is('deleted_at', null),
    supabase.from('financial_transactions').select('id, service_order_installment_id, amount, due_date, payment_method, bank_account_id').eq('service_order_id', orderId).eq('organization_id', organizationId).eq('type', 'income').eq('status', 'paid').is('deleted_at', null),
    supabase.from('employee_financial_records').select('*').eq('service_order_id', orderId).eq('organization_id', organizationId).eq('record_type', 'commission'),
    supabase.from('service_order_edit_logs').select('*').eq('service_order_id', orderId).order('created_at', { ascending: false })
  ])

  type EmployeeListItem = { id: string, name: string | null }
  type ResponsibleEmployeeRef = { employee_id: string }

  // Build employee name map
  const employeeNameById = new Map(
    ((employeesResult.data || []) as EmployeeListItem[]).map(employee => [employee.id, employee.name])
  )

  // Resolve responsible employee names
  const responsibleNames = ((order.responsible_employees || []) as ResponsibleEmployeeRef[]).map(responsible => ({
    employee_id: responsible.employee_id,
    name: employeeNameById.get(responsible.employee_id) || null
  }))

  // An installment can now be settled across more than one receipt — surface
  // how much of it has already been received (and each individual receipt,
  // so the UI can offer to undo a specific one) instead of just the
  // original expected amount.
  const receiptsByInstallmentId = new Map<string, { id: string, amount: number, due_date: string | null, payment_method: string | null, bank_account_id: string | null }[]>()
  for (const tx of paidTransactionsResult.data || []) {
    if (!tx.service_order_installment_id) continue
    const key = String(tx.service_order_installment_id)
    const list = receiptsByInstallmentId.get(key) || []
    list.push({
      id: tx.id,
      amount: Number(tx.amount || 0),
      due_date: tx.due_date,
      payment_method: tx.payment_method,
      bank_account_id: tx.bank_account_id
    })
    receiptsByInstallmentId.set(key, list)
  }

  const installments = (installmentsResult.data || []).map((installment) => {
    const receipts = receiptsByInstallmentId.get(String(installment.id)) || []
    const received = Number(receipts.reduce((sum, receipt) => sum + receipt.amount, 0).toFixed(2))
    const remaining = Number((Number(installment.amount || 0) - received).toFixed(2))
    return { ...installment, received_amount: received, remaining_amount: remaining, receipts }
  })

  return {
    data: {
      order,
      client: clientResult.data,
      vehicle: vehicleResult.data,
      masterProduct: masterProductResult.data,
      employees: employeesResult.data || [],
      installments,
      commissions: commissionsResult.data || [],
      editLogs: editLogsResult.data || [],
      responsibleNames
    }
  }
})
