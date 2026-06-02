/**
 * useReportDateRange
 *
 * Shared date-range + common filter state for report pages.
 * Values are synced to URL query params (priority) with localStorage as fallback.
 */

function defaultFrom(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function defaultTo(): string {
  const now = new Date()
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

export function useReportDateRange() {
  const dateFrom = useReportQueryParam('from', defaultFrom())
  const dateTo = useReportQueryParam('to', defaultTo())
  const orderStatusFilters = useReportQueryParam('orderStatus', [] as string[])
  const paymentStatusFilters = useReportQueryParam('paymentStatus', [] as string[])
  const selectedEmployees = useReportQueryParam('employees', [] as string[])

  return { dateFrom, dateTo, orderStatusFilters, paymentStatusFilters, selectedEmployees }
}
