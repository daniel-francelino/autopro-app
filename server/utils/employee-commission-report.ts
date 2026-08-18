import { normalizeReportStatus, parseDateEnd, parseDateStart, roundMoney, toNumber, toStringArray } from './report-helpers'
import { fetchAllOrganizationRows } from './supabase-pagination'

interface EmployeeRecord {
  id: string
  name?: string | null
  role?: string | null
  email?: string | null
  phone?: string | null
  tax_id?: string | null
  person_type?: string | null
  photo_url?: string | null
  city?: string | null
  state?: string | null
  neighborhood?: string | null
  street?: string | null
  address_number?: string | null
  address_complement?: string | null
  zip_code?: string | null
  has_commission?: boolean | null
  commission_type?: string | null
  commission_amount?: number | string | null
  commission_base?: string | null
  commission_categories?: unknown
  termination_date?: string | null
  termination_reason?: string | null
}

interface ProductCategoryRecord {
  id: string
  name?: string | null
}

interface ServiceOrderRecord {
  id: string
  number?: string | number | null
  status?: string | null
  payment_status?: string | null
  entry_date?: string | null
  client_id?: string | null
}

interface ClientRecord {
  id: string
  name?: string | null
}

interface EmployeeFinancialRecord {
  id: string
  employee_id?: string | null
  service_order_id?: string | null
  record_type?: string | null
  description?: string | null
  amount?: number | string | null
  status?: string | null
  reference_date?: string | null
  date?: string | null
  payment_date?: string | null
  item_name?: string | null
  item_amount?: number | string | null
  item_cost?: number | string | null
  commission_type?: string | null
  commission_percentage?: number | string | null
  commission_base?: string | null
}

export interface EmployeeCommissionProfile {
  id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  taxId: string | null
  personType: string | null
  photoUrl: string | null
  city: string | null
  state: string | null
  neighborhood: string | null
  street: string | null
  addressNumber: string | null
  addressComplement: string | null
  zipCode: string | null
  hasCommission: boolean
  commissionType: string | null
  commissionAmount: number | null
  commissionBase: string | null
  commissionCategoryIds: string[]
  commissionCategoryNames: string[]
  terminationDate: string | null
  terminationReason: string | null
}

export interface EmployeeCommissionReportItem {
  id: string
  description: string | null
  amount: number
  status: 'paid' | 'pending' | 'cancelled'
  referenceDate: string | null
  paymentDate: string | null
  itemName: string | null
  itemAmount: number
  itemCost: number
  itemProfit: number
  commissionType: string | null
  commissionPercentage: number | null
  commissionBase: string | null
  baseAmount: number
  orderId: string | null
  orderNumber: string | null
  orderStatus: string | null
  orderPaymentStatus: 'paid' | 'pending' | 'cancelled' | null
  orderEntryDate: string | null
  orderClientName: string | null
}

export interface EmployeeCommissionSummary {
  totalCommissions: number
  totalPaid: number
  totalPending: number
  itemsCount: number
  paidItemsCount: number
  pendingItemsCount: number
  orderCount: number
  averageCommission: number
}

export interface EmployeeCommissionReportResult {
  employee: EmployeeCommissionProfile
  summary: EmployeeCommissionSummary
  items: EmployeeCommissionReportItem[]
  period: {
    dateFrom: string | null
    dateTo: string | null
  }
}

function isCommissionRecord(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'commission' || normalized === 'comissao'
}

function normalizeFinancialStatus(value: unknown): 'paid' | 'pending' | 'cancelled' {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'pago')
    return 'paid'
  if (normalized === 'pendente')
    return 'pending'
  if (normalized === 'cancelado')
    return 'cancelled'
  return normalizeReportStatus(normalized)
}

function normalizeCommissionType(value: unknown) {
  const type = String(value || '').trim().toLowerCase()
  if (['percentage', 'percentual'].includes(type))
    return 'percentage'
  if (['fixed_amount', 'fixed', 'valor_fixo'].includes(type))
    return 'fixed_amount'
  return type || null
}

function normalizeCommissionBase(value: unknown) {
  const base = String(value || '').trim().toLowerCase()
  if (['profit', 'lucro'].includes(base))
    return 'profit'
  if (['revenue', 'faturamento'].includes(base))
    return 'revenue'
  return base || null
}

function extractItemName(record: EmployeeFinancialRecord) {
  if (record.item_name)
    return String(record.item_name)

  if (record.description) {
    const parts = String(record.description).split(' - ')
    return String(parts[parts.length - 1] || record.description)
  }

  return null
}

function buildDate(value: string | null | undefined) {
  if (!value)
    return null

  const date = new Date(String(value).includes('T') ? String(value) : `${String(value)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function resolveReferenceDate(record: EmployeeFinancialRecord, order: ServiceOrderRecord | null) {
  return record.reference_date || record.date || order?.entry_date || null
}

export async function getEmployeeCommissionReport({
  supabase,
  organizationId,
  employeeId,
  dateFrom,
  dateTo
}: {
  supabase: any
  organizationId: string
  employeeId: string
  dateFrom?: string | null
  dateTo?: string | null
}): Promise<EmployeeCommissionReportResult> {
  const normalizedEmployeeId = String(employeeId || '').trim()

  if (!normalizedEmployeeId)
    throw new Error('Employee id is required')

  const { data: employeeRecord, error: employeeError } = await supabase
    .from('employees')
    .select('*')
    .eq('id', normalizedEmployeeId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (employeeError || !employeeRecord)
    throw new Error('Employee not found')

  const employee = employeeRecord as EmployeeRecord
  const commissionCategoryIds = toStringArray(employee.commission_categories)

  const [categoriesResult, rawRecordsData] = await Promise.all([
    commissionCategoryIds.length > 0
      ? supabase
          .from('product_categories')
          .select('id, name')
          .eq('organization_id', organizationId)
          .in('id', commissionCategoryIds)
          .is('deleted_at', null)
      : Promise.resolve({ data: [] }),
    fetchAllOrganizationRows<EmployeeFinancialRecord>(supabase, {
      table: 'employee_financial_records',
      organizationId,
      eq: { employee_id: normalizedEmployeeId },
      nullColumns: ['deleted_at'],
      order: { column: 'reference_date' }
    })
  ])

  const categoryMap = new Map<string, string>(
    ((categoriesResult.data || []) as ProductCategoryRecord[])
      .map(category => [String(category.id), String(category.name || '').trim()])
      .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1]))
  )

  const rawRecords = rawRecordsData
    .filter(record => isCommissionRecord(record.record_type))

  const serviceOrderIds = Array.from(new Set(
    rawRecords
      .map(record => String(record.service_order_id || '').trim())
      .filter(Boolean)
  ))

  const [ordersData, clientsData] = await Promise.all([
    serviceOrderIds.length > 0
      ? fetchAllOrganizationRows<ServiceOrderRecord>(supabase, {
          table: 'service_orders',
          organizationId,
          columns: 'id, number, status, payment_status, entry_date, client_id',
          nullColumns: ['deleted_at']
        }).then(orders => orders.filter(order => serviceOrderIds.includes(String(order.id))))
      : Promise.resolve([] as ServiceOrderRecord[]),
    serviceOrderIds.length > 0
      ? fetchAllOrganizationRows<ClientRecord>(supabase, {
          table: 'clients',
          organizationId,
          columns: 'id, name',
          nullColumns: ['deleted_at']
        })
      : Promise.resolve([] as ClientRecord[])
  ])

  const ordersMap = new Map<string, ServiceOrderRecord>(
    ordersData.map(order => [String(order.id), order])
  )

  const clientsMap = new Map<string, string>(
    clientsData.map(client => [String(client.id), String(client.name || '').trim()])
  )

  const parsedDateFrom = parseDateStart(dateFrom || undefined)
  const parsedDateTo = parseDateEnd(dateTo || undefined)

  const items = rawRecords
    .filter((record) => {
      const order = record.service_order_id ? ordersMap.get(String(record.service_order_id)) ?? null : null
      const referenceDateValue = resolveReferenceDate(record, order)
      const referenceDate = buildDate(referenceDateValue)

      if (!referenceDate)
        return false

      if (parsedDateFrom && referenceDate < parsedDateFrom)
        return false

      if (parsedDateTo && referenceDate > parsedDateTo)
        return false

      return true
    })
    .map((record) => {
      const order = record.service_order_id ? ordersMap.get(String(record.service_order_id)) ?? null : null
      const itemAmount = roundMoney(toNumber(record.item_amount, 0))
      const itemCost = roundMoney(toNumber(record.item_cost, 0))
      const itemProfit = roundMoney(itemAmount - itemCost)
      const commissionBase = normalizeCommissionBase(record.commission_base || employee.commission_base)

      return {
        id: String(record.id),
        description: record.description ? String(record.description) : null,
        amount: roundMoney(toNumber(record.amount, 0)),
        status: normalizeFinancialStatus(record.status),
        referenceDate: resolveReferenceDate(record, order),
        paymentDate: record.payment_date ? String(record.payment_date) : null,
        itemName: extractItemName(record),
        itemAmount,
        itemCost,
        itemProfit,
        commissionType: normalizeCommissionType(record.commission_type || employee.commission_type),
        commissionPercentage: record.commission_percentage != null
          ? toNumber(record.commission_percentage, 0)
          : normalizeCommissionType(record.commission_type || employee.commission_type) === 'percentage'
            ? toNumber(employee.commission_amount, 0)
            : null,
        commissionBase,
        baseAmount: roundMoney(commissionBase === 'profit' ? itemProfit : itemAmount),
        orderId: order?.id ? String(order.id) : null,
        orderNumber: order?.number != null ? String(order.number) : null,
        orderStatus: order?.status ? String(order.status) : null,
        orderPaymentStatus: order?.payment_status ? normalizeFinancialStatus(order.payment_status) : null,
        orderEntryDate: order?.entry_date ? String(order.entry_date) : null,
        orderClientName: order?.client_id ? clientsMap.get(String(order.client_id)) || null : null
      }
    })
    .sort((itemA, itemB) => String(itemB.referenceDate || '').localeCompare(String(itemA.referenceDate || '')))

  const totalCommissions = roundMoney(items.reduce((sum, item) => sum + item.amount, 0))
  const totalPaid = roundMoney(items.filter(item => item.status === 'paid').reduce((sum, item) => sum + item.amount, 0))
  const totalPending = roundMoney(items.filter(item => item.status === 'pending').reduce((sum, item) => sum + item.amount, 0))
  const orderCount = new Set(items.map(item => item.orderId).filter(Boolean)).size

  return {
    employee: {
      id: String(employee.id),
      name: String(employee.name || 'Funcionário'),
      role: employee.role ? String(employee.role) : null,
      email: employee.email ? String(employee.email) : null,
      phone: employee.phone ? String(employee.phone) : null,
      taxId: employee.tax_id ? String(employee.tax_id) : null,
      personType: employee.person_type ? String(employee.person_type) : null,
      photoUrl: employee.photo_url ? String(employee.photo_url) : null,
      city: employee.city ? String(employee.city) : null,
      state: employee.state ? String(employee.state) : null,
      neighborhood: employee.neighborhood ? String(employee.neighborhood) : null,
      street: employee.street ? String(employee.street) : null,
      addressNumber: employee.address_number ? String(employee.address_number) : null,
      addressComplement: employee.address_complement ? String(employee.address_complement) : null,
      zipCode: employee.zip_code ? String(employee.zip_code) : null,
      hasCommission: Boolean(employee.has_commission),
      commissionType: normalizeCommissionType(employee.commission_type),
      commissionAmount: employee.commission_amount != null ? toNumber(employee.commission_amount, 0) : null,
      commissionBase: normalizeCommissionBase(employee.commission_base),
      commissionCategoryIds,
      commissionCategoryNames: commissionCategoryIds.map(categoryId => categoryMap.get(categoryId)).filter(Boolean) as string[],
      terminationDate: employee.termination_date ? String(employee.termination_date) : null,
      terminationReason: employee.termination_reason ? String(employee.termination_reason) : null
    },
    summary: {
      totalCommissions,
      totalPaid,
      totalPending,
      itemsCount: items.length,
      paidItemsCount: items.filter(item => item.status === 'paid').length,
      pendingItemsCount: items.filter(item => item.status === 'pending').length,
      orderCount,
      averageCommission: items.length > 0 ? roundMoney(totalCommissions / items.length) : 0
    },
    items,
    period: {
      dateFrom: dateFrom || null,
      dateTo: dateTo || null
    }
  }
}
