export interface CommissionReportItem {
  id: string
  employee_name: string
  order_number: string | null
  order_entry_date: string | null
  order_status: string | null
  order_payment_status: string | null
  reference_date: string
  amount: number
  status: string
}

export interface CommissionSummary {
  totalCommissions?: number
  totalPaid?: number
  totalPending?: number
  employeeCount?: number
  count?: number
}

export interface CommissionCharts {
  byEmployee: Array<{ name: string, total: number, paid: number, pending: number }>
  statusDistribution: Array<{ name: string, value: number, color: string }>
}

export interface CommissionEmployeeOption {
  value: string
  label: string
}

interface CommissionsReportResponse {
  data?: {
    items?: CommissionReportItem[]
    summary?: CommissionSummary
    pagination?: { totalItems?: number } | null
    charts?: CommissionCharts
    employees?: CommissionEmployeeOption[]
  }
}

export interface CommissionsListFilters {
  dateFrom: Ref<string>
  dateTo: Ref<string>
  selectedEmployees: Ref<string[]>
  commissionStatus: Ref<string[]>
  recordType: Ref<string[]>
  orderStatusFilters: Ref<string[]>
  paymentStatusFilters: Ref<string[]>
  paymentMethods: Ref<string[]>
  sortBy: Ref<string> | ComputedRef<string>
  sortOrder: Ref<string> | ComputedRef<string>
}

/**
 * Owns the commissions report screen data: the paginated list (via
 * useInfiniteList, so paying/deleting a commission can softRefresh() in
 * place instead of resetting the whole table) plus the summary/charts/
 * employees aggregates that come bundled in the same API response.
 *
 * summary/charts/employees are computed server-side over the full filtered
 * dataset, not per-page (server/api/reports/commissions.get.ts) — so it's
 * safe to overwrite them from any fetcher call, including the parallel
 * page requests fired by softRefresh().
 */
export function useCommissionsReportList(filters: CommissionsListFilters, pageSize = 20) {
  const requestFetch = useRequestFetch()
  const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

  const summary = ref<CommissionSummary>({})
  const charts = ref<CommissionCharts>({ byEmployee: [], statusDistribution: [] })
  const employees = ref<CommissionEmployeeOption[]>([])

  const list = useInfiniteList<CommissionReportItem>(
    async ({ cursor, limit, signal }) => {
      const page = Math.floor(cursor / limit) + 1
      const res = await requestFetch<CommissionsReportResponse>('/api/reports/commissions', {
        headers: requestHeaders,
        signal,
        query: {
          dateFrom: filters.dateFrom.value,
          dateTo: filters.dateTo.value,
          page,
          pageSize: limit,
          employeeIds: filters.selectedEmployees.value.length ? filters.selectedEmployees.value : undefined,
          status: filters.commissionStatus.value.length === 1 ? filters.commissionStatus.value[0] : undefined,
          recordType: filters.recordType.value.length === 1 ? filters.recordType.value[0] : undefined,
          orderStatusFilters: filters.orderStatusFilters.value.length ? filters.orderStatusFilters.value : undefined,
          paymentStatusFilters: filters.paymentStatusFilters.value.length ? filters.paymentStatusFilters.value : undefined,
          paymentMethods: filters.paymentMethods.value.length ? filters.paymentMethods.value : undefined,
          sortBy: filters.sortBy.value,
          sortOrder: filters.sortOrder.value
        }
      })
      summary.value = res.data?.summary ?? {}
      charts.value = res.data?.charts ?? { byEmployee: [], statusDistribution: [] }
      employees.value = res.data?.employees ?? []
      return {
        items: res.data?.items ?? [],
        total: res.data?.pagination?.totalItems ?? 0
      }
    },
    { pageSize }
  )

  watch(
    [
      filters.dateFrom, filters.dateTo, filters.selectedEmployees, filters.commissionStatus,
      filters.recordType, filters.orderStatusFilters, filters.paymentStatusFilters,
      filters.paymentMethods, filters.sortBy, filters.sortOrder
    ],
    () => list.reset()
  )

  return { ...list, summary, charts, employees }
}
