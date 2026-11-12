// ─── Enums ────────────────────────────────────────────────────────────────────

export enum TransactionType {
  Income = 'income',
  Expense = 'expense'
}

export enum DebtStatus {
  Active = 'active',
  PaidOff = 'paid_off'
}

// ─── Icon & Color Mappings ────────────────────────────────────────────────────

export const TRANSACTION_TYPE_META: Record<TransactionType, { label: string, icon: string, color: 'success' | 'error' }> = {
  [TransactionType.Income]: { label: 'Receita', icon: 'i-lucide-trending-up', color: 'success' },
  [TransactionType.Expense]: { label: 'Despesa', icon: 'i-lucide-trending-down', color: 'error' }
}

export const DEBT_STATUS_META: Record<DebtStatus, { label: string, icon: string, color: 'warning' | 'success' }> = {
  [DebtStatus.Active]: { label: 'Ativa', icon: 'i-lucide-alert-circle', color: 'warning' },
  [DebtStatus.PaidOff]: { label: 'Quitada', icon: 'i-lucide-check-circle', color: 'success' }
}

// ─── Entities ─────────────────────────────────────────────────────────────────

export interface FinancialCategory {
  id: string
  userId: string
  name: string
  icon: string | null
  color: string | null
  type: TransactionType
  createdAt: string
}

export interface Income {
  id: string
  userId: string
  source: string
  description: string | null
  amount: number
  date: string
  recurring: boolean
  recurringDay: number | null
  categoryId: string | null
  createdAt: string
  updatedAt: string
  // Populated via joins
  category?: FinancialCategory | null
}

export interface Expense {
  id: string
  userId: string
  description: string
  amount: number
  date: string
  recurring: boolean
  recurringDay: number | null
  categoryId: string | null
  createdAt: string
  updatedAt: string
  // Populated via joins
  category?: FinancialCategory | null
}

export interface Debt {
  id: string
  userId: string
  name: string
  description: string | null
  totalAmount: number
  remainingAmount: number
  status: DebtStatus
  createdAt: string
  updatedAt: string
  // Populated
  installments?: DebtInstallment[]
  installmentCount?: number
  paidInstallmentCount?: number
}

export interface DebtInstallment {
  id: string
  debtId: string
  amount: number
  dueDate: string
  paid: boolean
  paidAt: string | null
  createdAt: string
}

export interface Asset {
  id: string
  userId: string
  name: string
  description: string | null
  value: number
  createdAt: string
  updatedAt: string
}

// ─── API Payloads ─────────────────────────────────────────────────────────────

export interface CreateCategoryPayload {
  name: string
  icon?: string
  color?: string
  type: TransactionType
}

export interface UpdateCategoryPayload {
  name?: string
  icon?: string
  color?: string
}

export interface CreateIncomePayload {
  source: string
  description?: string
  amount: number
  date: string
  recurring?: boolean
  recurringDay?: number
  categoryId?: string
}

export interface UpdateIncomePayload {
  source?: string
  description?: string
  amount?: number
  date?: string
  recurring?: boolean
  recurringDay?: number
  categoryId?: string | null
}

export interface CreateExpensePayload {
  description: string
  amount: number
  date: string
  recurring?: boolean
  recurringDay?: number
  categoryId?: string
}

export interface UpdateExpensePayload {
  description?: string
  amount?: number
  date?: string
  recurring?: boolean
  recurringDay?: number
  categoryId?: string | null
}

export interface CreateDebtPayload {
  name: string
  description?: string
  totalAmount: number
}

export interface UpdateDebtPayload {
  name?: string
  description?: string
  totalAmount?: number
}

export interface CreateInstallmentPayload {
  amount: number
  dueDate: string
}

export interface CreateAssetPayload {
  name: string
  description?: string
  value: number
}

export interface UpdateAssetPayload {
  name?: string
  description?: string
  value?: number
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface FinancialListResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

export interface FinancialDashboard {
  totalIncome: number
  totalExpenses: number
  balance: number
  netWorth: number
  totalDebt: number
  totalAssets: number
  expensesByCategory: CategorySummary[]
  recentTransactions: RecentTransaction[]
  monthlyComparison: MonthlyComparison
}

export interface CategorySummary {
  categoryId: string | null
  categoryName: string
  total: number
  percentage: number
}

export interface RecentTransaction {
  id: string
  type: TransactionType
  description: string
  amount: number
  date: string
  categoryName: string | null
}

export interface MonthlyComparison {
  currentMonthIncome: number
  currentMonthExpenses: number
  previousMonthIncome: number
  previousMonthExpenses: number
}

export interface BankAccount {
  id: string
  account_name?: string | null
  account_type?: string | null
  bank_name?: string | null
  branch?: string | null
  account_number?: string | null
  initial_balance?: number | string | null
  current_balance?: number | string | null
  preferred_payment_method?: string | null
  is_active?: boolean | null
  notes?: string | null
  [key: string]: unknown
}

export interface PaymentTerminal {
  id: string
  terminal_name?: string | null
  provider_company?: string | null
  payment_receipt_days?: number | string | null
  is_active?: boolean | null
  [key: string]: unknown
}

export interface Tax {
  id: string
  name?: string | null
  type?: string | null
  rate?: number | string | null
  [key: string]: unknown
}

/** Metodos de pagamento aceitos nas baixas de OS (valores persistidos). */
export type PaymentMethod = 'pix' | 'cash' | 'credit_card' | 'debit_card' | 'bank_slip' | 'transfer' | 'check'

/**
 * Conta bancaria resumida usada em seletores/baixas.
 * `preferred_payment_method` e texto livre (nao e `PaymentMethod`); normalizar com `normalizePaymentMethod`.
 */
export interface BankAccountItem {
  id: string
  account_name: string
  bank_name?: string | null
  preferred_payment_method?: string | null
}

export interface PaymentTerminalItem {
  id: string
  terminal_name: string
  provider_company: string | null
}
