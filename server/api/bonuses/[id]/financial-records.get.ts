import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import { fetchBonus, monthDateRange, currentMonthStart } from '../../../utils/bonuses'
import { normalizeReportStatus } from '../../../utils/report-helpers'

interface EmployeeNameRecord {
  id: string
  name?: string | null
}

interface BonusFinancialRecord {
  id: string
  employee_id: string | null
  amount: number | string | null
  status: string | null
  reference_date: string | null
  payment_date: string | null
  description: string | null
}

/**
 * GET /api/bonuses/:id/financial-records?referenceMonth=YYYY-MM-01
 * Lists the employee_financial_records (record_type=bonus) this bonus has
 * actually released for the given month — the real payment ledger, as
 * opposed to /progress (which also includes live, not-yet-generated goal
 * math). Powers the "Pagamentos" list on the bonus detail screen, so a
 * pending bonus can be paid without leaving the page.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'bonuses.read')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const bonusId = getRouterParam(event, 'id')
  if (!bonusId) {
    throw createError({ statusCode: 400, statusMessage: 'Bonus id is required' })
  }

  const bonus = await fetchBonus(supabase, organizationId, bonusId)
  if (!bonus) {
    throw createError({ statusCode: 404, statusMessage: 'Bônus não encontrado' })
  }

  const query = getQuery(event)
  const referenceMonth = typeof query.referenceMonth === 'string' && query.referenceMonth.trim()
    ? query.referenceMonth.trim()
    : currentMonthStart()

  const { start, end } = monthDateRange(referenceMonth)

  const { data: records, error: recordsError } = await supabase
    .from('employee_financial_records')
    .select('id, employee_id, amount, status, reference_date, payment_date, description')
    .eq('organization_id', organizationId)
    .eq('bonus_id', bonusId)
    .is('deleted_at', null)
    .order('reference_date', { ascending: false })

  if (recordsError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load bonus financial records: ${recordsError.message}` })
  }

  const monthRecords = ((records || []) as BonusFinancialRecord[]).filter((record) => {
    if (!record.reference_date) return false
    const referenceDate = new Date(`${record.reference_date}T00:00:00`)
    if (Number.isNaN(referenceDate.getTime())) return false
    return referenceDate >= start && referenceDate <= end
  })

  const employeeIds = [...new Set(monthRecords.map(record => record.employee_id).filter((id): id is string => Boolean(id)))]
  const { data: employeesData, error: employeesError } = employeeIds.length > 0
    ? await supabase.from('employees').select('id, name').in('id', employeeIds)
    : { data: [] as EmployeeNameRecord[], error: null }

  if (employeesError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to load employees: ${employeesError.message}` })
  }

  const employeeNameById = new Map<string, string>(
    ((employeesData || []) as EmployeeNameRecord[]).map(employee => [employee.id, employee.name || 'Sem nome'])
  )

  const items = monthRecords.map(record => ({
    id: record.id,
    employeeId: record.employee_id,
    employeeName: record.employee_id ? employeeNameById.get(record.employee_id) || 'Funcionário' : 'Funcionário',
    amount: Number(record.amount || 0),
    status: normalizeReportStatus(record.status),
    referenceDate: record.reference_date,
    paymentDate: record.payment_date,
    description: record.description
  }))

  return { items }
})
