import type { CommissionManualAdjustmentLogEntry } from '../../lib/utils/employee-commission-engine'

export type ServiceOrder = {
  id: string
  number: string | null
  status: string
  payment_status: string | null
  is_installment: boolean
  client_id: string | null
  client_name: string | null
  vehicle_id: string | null
  vehicle_label: string | null
  entry_date: string | null
  reported_defect: string | null
  total_amount: number | null
  master_product_name: string | null
  responsible_name: string | null
  responsible_names: string[]
  has_commissions: boolean
  installments_progress: { paid: number, total: number } | null
  commission_release_mode?: string | null
}

export type ServiceOrderDetail = {
  order: {
    id: string
    number: string | null
    status: string
    payment_status: string | null
    entry_date: string | null
    reported_defect: string | null
    diagnosis: string | null
    notes: string | null
    total_amount: number | null
    discount: number | null
    payment_method: string | null
    items?: { name?: string, description?: string, quantity: number, unit_price: number }[]
  }
  client: { name: string, phone?: string | null } | null
  vehicle: { brand: string | null, model: string | null, license_plate: string | null } | null
  installments?: unknown[]
}

// ─── Full detail (used in DetailModal) ────────────────────────────────────────

export type ServiceOrderDraftItem = {
  id: string
  name: string
  description: string
  quantity: number
  unit_price: number | string
  cost_price: number | string
  source: 'manual' | 'catalog'
  product_id?: string | null
  category_id?: string | null
  category_name?: string | null
  stored_commission?: number | null
}

export type ServiceOrderItem = {
  name?: string | null
  description?: string | null
  quantity: number
  unit_price: number
  total_price?: number | null
  total_amount?: number | null
  cost_price?: number | null
  cost_amount?: number | null
  product_id?: string | null
  category_id?: string | null
  category_name?: string | null
  commission_total?: number | null
  total_commission?: number | null
  commissions?: {
    employee_id?: string | null
    amount?: number | null
    commission_type?: string | null
    commission_base?: string | null
    commission_percentage?: number | null
  }[] | null
}

export type ServiceOrderSelectedTax = {
  tax_id?: string | null
  name?: string | null
  type?: string | null
  rate?: number | null
  calculated_amount?: number | null
}

export type ServiceOrderInstallmentReceipt = {
  id: string
  amount: number
  due_date: string | null
  payment_method: string | null
  bank_account_id: string | null
}

export type ServiceOrderInstallment = {
  id: string
  service_order_id: string
  installment_number?: number | null
  kind: 'down_payment' | 'installment' | 'extra' | string
  amount: number
  received_amount?: number
  remaining_amount?: number
  receipts?: ServiceOrderInstallmentReceipt[]
  due_date: string | null
  payment_date: string | null
  status: string
  bank_account_id?: string | null
  payment_method?: string | null
  payment_terminal_id?: string | null
}

export type ServiceOrderCommission = {
  id: string
  employee_id: string | null
  amount: number | null
  status: string | null
  service_order_id: string
  description: string | null
  payment_date: string | null
  reference_date: string | null
}

export type ServiceOrderEmployee = {
  id: string
  name: string
  photo_url?: string | null
}

/** Re-exported under the ServiceOrder* naming convention this file uses — canonical shape lives with the pure resolution logic that reads it. */
export type ServiceOrderCommissionManualAdjustmentLogEntry = CommissionManualAdjustmentLogEntry

export type ServiceOrderRaw = {
  id: string
  number: string | null
  status: string
  payment_status: string | null
  entry_date: string | null
  expected_date?: string | null
  reported_defect: string | null
  diagnosis: string | null
  notes: string | null
  total_amount: number | null
  discount: number | null
  commission_amount: number | null
  commission_release_mode?: string | null
  commission_manual_adjustments_log?: ServiceOrderCommissionManualAdjustmentLogEntry[] | null
  total_taxes_amount?: number | null
  total_cost_amount?: number | null
  payment_method: string | null
  items: ServiceOrderItem[] | null
  apply_taxes: boolean
  selected_taxes?: ServiceOrderSelectedTax[] | null
  is_installment: boolean
  installment_count: number | null
  appointment_id?: string | null
  responsible_employees: { employee_id: string }[] | null
  employee_responsible_id: string | null
  client_id: string | null
  vehicle_id: string | null
  master_product_id: string | null
  organization_id: string
  created_at: string
  updated_at: string | null
}

export type ServiceOrderDetailFull = {
  order: ServiceOrderRaw
  client: {
    id: string
    name: string
    phone?: string | null
    mobile_phone?: string | null
    email?: string | null
  } | null
  vehicle: {
    id: string
    brand: string | null
    model: string | null
    license_plate: string | null
    year?: number | null
    color?: string | null
    fuel_type?: string | null
  } | null
  masterProduct: {
    id: string
    name: string
    description?: string | null
    notes?: string | null
  } | null
  employees: ServiceOrderEmployee[]
  installments: ServiceOrderInstallment[]
  commissions: ServiceOrderCommission[]
  editLogs: {
    id: string
    created_at: string
    action?: string | null
    changed_by?: string | null
    changes?: Record<string, unknown> | null
  }[]
  responsibleNames: { employee_id: string, name: string | null }[]
}
