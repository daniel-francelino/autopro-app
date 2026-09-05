// Shared calculation helpers for the profit report's modes
// (server/api/reports/profit-cash-flow.get.ts, profit-by-order.get.ts).
// See docs/reports/profit-report.md for the business rationale behind each mode.

import type { SupabaseReportRow } from './supabase-pagination'
import { toNumber, formatDateKey, formatDayLabel, matchesStatusFilters, normalizeReportStatus, getPreviousRangeByMode, calculateVariation, getComparisonModeLabel, formatPeriodLabel } from './report-helpers'

type ReportRow = SupabaseReportRow

export interface PeriodProfitData {
  revenue: number
  costs: number
  profit: number
  profitMargin: number
  orderCount: number
  orders: ReportRow[]
  costsData?: ReportRow[]
  incomeData?: ReportRow[]
  partsCost?: number
  commissionCost?: number
}

export interface PublicPeriodProfitData {
  revenue: number
  costs: number
  profit: number
  profitMargin: number
  orderCount: number
  partsCost?: number
  commissionCost?: number
}

export interface ProfitVariations {
  revenue: ReturnType<typeof calculateVariation>
  costs: ReturnType<typeof calculateVariation>
  profit: ReturnType<typeof calculateVariation>
  margin: ReturnType<typeof calculateVariation>
}

export interface ComparisonMeta {
  mode: string
  modeLabel: string
  currentPeriodLabel: string
  previousPeriodLabel: string
  currentStartDate: string
  currentEndDate: string
  previousStartDate: string
  previousEndDate: string
}

export interface EvolutionPoint {
  name: string
  revenue: number
  costs: number
  profit: number
}

export interface TopProfitableOrder {
  number: unknown
  revenue: number
  cost: number
  profit: number
  margin: number
}

// ─── Modo "Fluxo de Caixa" — dinheiro que efetivamente circulou no financeiro ───
//
// Receita = financial_transactions tipo 'income' (criadas em server/utils/financial-income.ts
// a cada pagamento recebido de uma OS — down payment, parcela, quitação), a mesma fonte que
// alimenta os cards "Receitas" de server/api/financial/summary.get.ts. Não usa service_orders:
// o payment_status da OS não é a mesma coisa que "existe uma transação de income registrada e
// com o status certo" — os dois podem divergir bastante (parcelas, estornos, ajustes manuais).

export function calculateCashFlowFromTransactions(
  transactions: ReportRow[],
  start: Date,
  end: Date,
  statusFilters: string[]
): PeriodProfitData {
  const periodIncome = transactions.filter((t: ReportRow) => {
    const dueDate = t?.due_date ? new Date(`${t.due_date}T00:00:00`) : null
    const isIncome = t?.type === 'income'
    const isCancelled = normalizeReportStatus(t?.status) === 'cancelled'
    return !!dueDate && !Number.isNaN(dueDate.getTime()) && isIncome && !isCancelled && matchesStatusFilters(t?.status, statusFilters) && dueDate >= start && dueDate <= end
  })
  const periodCosts = transactions.filter((t: ReportRow) => {
    const dueDate = t?.due_date ? new Date(`${t.due_date}T00:00:00`) : null
    const isCost = t?.type === 'expense'
    const isCancelled = normalizeReportStatus(t?.status) === 'cancelled'
    return !!dueDate && !Number.isNaN(dueDate.getTime()) && isCost && !isCancelled && matchesStatusFilters(t?.status, statusFilters) && dueDate >= start && dueDate <= end
  })
  const revenue = periodIncome.reduce((acc: number, t: ReportRow) => acc + toNumber(t?.amount, 0), 0)
  const costs = periodCosts.reduce((acc: number, t: ReportRow) => acc + toNumber(t?.amount, 0), 0)
  const profit = revenue - costs
  return { revenue, costs, profit, profitMargin: revenue > 0 ? (profit / revenue) * 100 : 0, orderCount: periodIncome.length, orders: [], costsData: periodCosts, incomeData: periodIncome }
}

export function buildCashFlowTransactionsEvolutionData(periodData: PeriodProfitData | null, start: Date, end: Date): EvolutionPoint[] {
  const dailyData: Record<string, { revenue: number, costs: number }> = {}
  const cursor = new Date(start)
  while (cursor <= end) {
    dailyData[formatDateKey(cursor)] = { revenue: 0, costs: 0 }
    cursor.setDate(cursor.getDate() + 1)
  }
  for (const t of periodData?.incomeData || []) {
    const key = String(t?.due_date || '')
    if (dailyData[key]) dailyData[key].revenue += toNumber(t?.amount, 0)
  }
  for (const t of periodData?.costsData || []) {
    const key = String(t?.due_date || '')
    if (dailyData[key]) dailyData[key].costs += toNumber(t?.amount, 0)
  }
  return Object.entries(dailyData).map(([date, v]) => ({ name: formatDayLabel(date), ...v, profit: v.revenue - v.costs }))
}

// ─── Modo "Pelas OS" — margem por serviço (receita da OS menos custo de peças e comissão da própria OS) ───
//
// Custo = total_cost_amount (peças/produtos usados) + commission_amount (comissão total já
// entitulada aos funcionários responsáveis pela OS, somada e mantida em sincronia por
// server/utils/service-order-commissions.ts / service-order-item-commissions.ts). Somar os dois
// é seguro aqui porque este modo nunca lê financial_transactions — ao contrário do modo
// "Resultado do Período", que já inclui a parcela PAGA da comissão dentro de "despesas gerais"
// (toda comissão paga gera uma linha financial_transactions tipo expense, categoria "Salários",
// em server/api/reports/commissions/[id]/pay.post.ts) — por isso commission_amount NÃO deve ser
// somado de novo lá, só aqui.
//
// orderStatusFilters: status do ciclo de vida da OS (open/in_progress/waiting_for_part/completed/
// invoiced/delivered/estimate/cancelled) — array vazio = sem restrição (inclui até orçamento e
// cancelada, se o usuário escolher isso explicitamente). paymentStatusFilters: payment_status da
// própria OS (paid/pending, mesma normalização de report-helpers.ts) — array vazio = sem restrição,
// que é o comportamento padrão deste modo (regime de competência, independente de pagamento).

export function calculateByOrderPeriodData(
  orders: ReportRow[],
  start: Date,
  end: Date,
  orderStatusFilters: string[] = [],
  paymentStatusFilters: string[] = []
): PeriodProfitData {
  const periodOrders = orders.filter((o: ReportRow) => {
    const entryDate = o?.entry_date ? new Date(`${o.entry_date}T00:00:00`) : null
    if (!entryDate || Number.isNaN(entryDate.getTime()) || entryDate < start || entryDate > end) return false
    if (orderStatusFilters.length > 0 && !orderStatusFilters.includes(String(o?.status || ''))) return false
    if (!matchesStatusFilters(o?.payment_status, paymentStatusFilters)) return false
    return true
  })
  const revenue = periodOrders.reduce((acc: number, o: ReportRow) => acc + toNumber(o?.total_amount, 0), 0)
  const partsCost = periodOrders.reduce((acc: number, o: ReportRow) => acc + toNumber(o?.total_cost_amount, 0), 0)
  const commissionCost = periodOrders.reduce((acc: number, o: ReportRow) => acc + toNumber(o?.commission_amount, 0), 0)
  const costs = partsCost + commissionCost
  const profit = revenue - costs
  return { revenue, costs, profit, profitMargin: revenue > 0 ? (profit / revenue) * 100 : 0, orderCount: periodOrders.length, orders: periodOrders, partsCost, commissionCost }
}

export function buildByOrderEvolutionData(periodData: PeriodProfitData | null, start: Date, end: Date): EvolutionPoint[] {
  const dailyData: Record<string, { revenue: number, costs: number }> = {}
  const cursor = new Date(start)
  while (cursor <= end) {
    dailyData[formatDateKey(cursor)] = { revenue: 0, costs: 0 }
    cursor.setDate(cursor.getDate() + 1)
  }
  for (const o of periodData?.orders || []) {
    const key = String(o?.entry_date || '')
    if (dailyData[key]) {
      dailyData[key].revenue += toNumber(o?.total_amount, 0)
      dailyData[key].costs += toNumber(o?.total_cost_amount, 0) + toNumber(o?.commission_amount, 0)
    }
  }
  return Object.entries(dailyData).map(([date, v]) => ({ name: formatDayLabel(date), ...v, profit: v.revenue - v.costs }))
}

export function buildTopProfitableOrders(orders: ReportRow[]): TopProfitableOrder[] {
  return orders.map((o: ReportRow) => {
    const revenue = toNumber(o?.total_amount, 0)
    const cost = toNumber(o?.total_cost_amount, 0) + toNumber(o?.commission_amount, 0)
    const profit = revenue - cost
    return { number: o?.number, revenue, cost, profit, margin: revenue > 0 ? (profit / revenue) * 100 : 0 }
  }).sort((a, b) => b.profit - a.profit).slice(0, 10)
}

// ─── Comum aos 3 modos: comparação com período anterior e variações ───

export function resolveComparison(
  dateFrom: Date,
  dateTo: Date,
  compareMode: string,
  compareWithPreviousPeriod: boolean,
  calcFn: (start: Date, end: Date) => PeriodProfitData
): { previousData: PeriodProfitData | null, comparisonMeta: ComparisonMeta | null } {
  if (!compareWithPreviousPeriod) return { previousData: null, comparisonMeta: null }
  const { previousStartDate, previousEndDate } = getPreviousRangeByMode(dateFrom, dateTo, compareMode)
  const previousData = calcFn(previousStartDate, previousEndDate)
  const comparisonMeta: ComparisonMeta = {
    mode: compareMode,
    modeLabel: getComparisonModeLabel(compareMode),
    currentPeriodLabel: formatPeriodLabel(dateFrom, dateTo),
    previousPeriodLabel: formatPeriodLabel(previousStartDate, previousEndDate),
    currentStartDate: formatDateKey(dateFrom),
    currentEndDate: formatDateKey(dateTo),
    previousStartDate: formatDateKey(previousStartDate),
    previousEndDate: formatDateKey(previousEndDate)
  }
  return { previousData, comparisonMeta }
}

export function buildVariations(current: PeriodProfitData | null, previous: PeriodProfitData | null): ProfitVariations | null {
  if (!current || !previous) return null
  return {
    revenue: calculateVariation(current.revenue, previous.revenue),
    costs: calculateVariation(current.costs, previous.costs),
    profit: calculateVariation(current.profit, previous.profit),
    margin: calculateVariation(current.profitMargin, previous.profitMargin)
  }
}

export function toPublicPeriodData(data: PeriodProfitData | null): PublicPeriodProfitData | null {
  if (!data) return null
  return {
    revenue: data.revenue,
    costs: data.costs,
    profit: data.profit,
    profitMargin: data.profitMargin,
    orderCount: data.orderCount,
    partsCost: data.partsCost,
    commissionCost: data.commissionCost
  }
}
