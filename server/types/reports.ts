// Row shapes read by the report endpoints (server/api/reports/**, server/utils/*report*.ts).
//
// Import rule: server code imports this file by RELATIVE path (same as server/types/fiscal.ts),
// e.g. `import type { ClientNameRecord } from '../../types/reports'`. There is no alias for
// server/types, and app/** (pages/components) must NOT import it.
//
// Rule for adding types here: same concept AND same shape. Each `*Record` below is the full set of
// columns any report reads for that table; every query picks ONLY the columns its select asks for
// (Pick/Omit), so reading a column that is not selected is a type error instead of a silent
// `undefined` (which toNumber turns into 0). Do not widen a Pick "to make it compile".
//
// These are input-only types (rows coming from Supabase); they are never serialized, so they do
// not alter the JSON returned by the endpoints.

// --- clients -----------------------------------------------------------------------------------

export interface ClientRecord {
  id: string
  name?: string | null
  phone?: string | null
  email?: string | null
}

/** clients columns `id, name` (sales-items, employee-report, employee-commission-report). */
export type ClientNameRecord = Pick<ClientRecord, 'id' | 'name'>

/** clients as read by debtors.get.ts (select '*': reads name, phone and email). */
export type ClientContactRecord = Pick<ClientRecord, 'id' | 'name' | 'phone' | 'email'>

// --- employees ---------------------------------------------------------------------------------

export interface EmployeeRecord {
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
  termination_date?: string | null
  termination_reason?: string | null
}

/** employees columns `id, name` (commissions, export-commissions, sales-items, employee-report). */
export type EmployeeNameRecord = Pick<EmployeeRecord, 'id' | 'name'>

// --- service orders ----------------------------------------------------------------------------

export interface ItemCommissionRecord {
  employee_id?: string | null
  amount?: number | string | null
}

export interface ServiceOrderItemRecord {
  product_id?: string | null
  category_id?: string | null
  description?: string | null
  name?: string | null
  quantity?: number | string | null
  cost_amount?: number | string | null
  total_amount?: number | string | null
  unit_price?: number | string | null
  commission_total?: number | string | null
  commissions?: ItemCommissionRecord[] | null
}

export interface ResponsibleEmployeeRecord {
  employee_id?: string | null
}

export interface ServiceOrderRecord {
  id?: string | null
  number?: string | number | null
  client_id?: string | null
  client_name?: string | null
  employee_responsible_id?: string | null
  responsible_employees?: ResponsibleEmployeeRecord[] | null
  status?: string | null
  payment_status?: string | null
  payment_method?: string | null
  entry_date?: string | null
  completion_date?: string | null
  expected_payment_date?: string | null
  is_installment?: boolean | null
  total_amount?: number | string | null
  total_cost_amount?: number | string | null
  commission_amount?: number | string | null
  discount?: number | string | null
  total_taxes_amount?: number | string | null
  items?: ServiceOrderItemRecord[] | null
}

/** commissions.get.ts */
export type CommissionReportOrderRecord = Pick<ServiceOrderRecord,
  'id' | 'number' | 'status' | 'payment_status' | 'client_name' | 'entry_date' | 'completion_date' | 'total_amount' | 'payment_method'>

/** export-commissions.post.ts */
export type CommissionExportOrderRecord = Pick<ServiceOrderRecord,
  'id' | 'number' | 'status' | 'payment_status' | 'payment_method' | 'entry_date'>

/** employee-commission-report.ts (id is required there) */
export type EmployeeCommissionOrderRecord
  = Pick<ServiceOrderRecord, 'number' | 'status' | 'payment_status' | 'entry_date' | 'client_id'> & { id: string }

/** debtors.get.ts */
export type DebtorOrderRecord = Pick<ServiceOrderRecord,
  'id' | 'number' | 'client_id' | 'status' | 'payment_status' | 'payment_method' | 'total_amount'
  | 'expected_payment_date' | 'entry_date' | 'is_installment'>

/** sales-items.get.ts */
export type SalesItemsOrderRecord = Pick<ServiceOrderRecord,
  'id' | 'number' | 'client_id' | 'employee_responsible_id' | 'responsible_employees' | 'status'
  | 'payment_status' | 'payment_method' | 'entry_date' | 'discount' | 'total_taxes_amount' | 'items'>

/** employee-report.ts */
export type EmployeeReportOrderRecord = Pick<ServiceOrderRecord,
  'id' | 'number' | 'client_id' | 'employee_responsible_id' | 'responsible_employees' | 'status'
  | 'payment_status' | 'payment_method' | 'entry_date' | 'total_amount' | 'total_cost_amount'
  | 'discount' | 'total_taxes_amount' | 'items'>

/** profit reports and costs-profit (service_orders select '*', reads only these columns) */
export type ProfitOrderRecord = Pick<ServiceOrderRecord,
  'number' | 'entry_date' | 'status' | 'payment_status' | 'total_amount' | 'total_cost_amount' | 'commission_amount'>

// --- financial transactions ----------------------------------------------------------------------

export interface FinancialTransactionRecord {
  id?: string | null
  type?: string | null
  status?: string | null
  category_id?: string | null
  description?: string | null
  amount?: number | string | null
  due_date?: string | null
  recurrence?: string | null
  is_installment?: boolean | null
  current_installment?: number | null
  installment_count?: number | null
  notes?: string | null
}

/** profit-report-helpers.ts cash-flow mode (select '*'; reads only these columns) */
export type ProfitTransactionRecord = Pick<FinancialTransactionRecord, 'type' | 'status' | 'amount' | 'due_date'>

export interface FinancialCategoryNameRecord {
  id: string
  name: string
  icon: string
  color: string
}
