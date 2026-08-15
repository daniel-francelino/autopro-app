import { defineEventHandler, getQuery } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import type { SupabaseClientLike } from '../../utils/supabase-pagination'
import { qArr } from '../../utils/report-helpers'
import { getEmployeeReport } from '../../utils/employee-report'

/**
 * GET /api/reports/employees
 * Per-employee report: orders worked, commissions and sold items for a
 * single employee, over a date range. Reuses the same filter semantics as
 * /api/reports/commissions (order status/payment status/payment method
 * filter which orders count; commission status/record type filter only the
 * commission records), scoped to exactly one employee at a time.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const query = getQuery(event)

  const result = await getEmployeeReport(supabase as unknown as SupabaseClientLike, organizationId, {
    dateFrom: query.dateFrom as string,
    dateTo: query.dateTo as string,
    employeeId: query.employeeId as string,
    orderStatusFilters: qArr(query.orderStatusFilters as string | string[] | undefined),
    paymentStatusFilters: qArr(query.paymentStatusFilters as string | string[] | undefined),
    paymentMethods: qArr(query.paymentMethods as string | string[] | undefined),
    commissionStatus: qArr(query.commissionStatus as string | string[] | undefined),
    recordType: qArr(query.recordType as string | string[] | undefined)
  })

  return { data: result }
})
