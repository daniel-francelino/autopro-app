import { defineEventHandler, getQuery } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchAllOrganizationRows } from '../../utils/supabase-pagination'
import { parseDateStart, parseDateEnd, normalizeStatusFilters } from '../../utils/report-helpers'
import { enforceReportAccess } from '../../utils/license'
import { calculateCashFlowPeriodData, buildCashFlowEvolutionData, resolveComparison, buildVariations, toPublicPeriodData } from '../../utils/profit-report-helpers'

// Modo "Fluxo de Caixa": dinheiro que já entrou/saiu (ou está prestes a), conforme o filtro
// de status de pagamento (Pago/Pendente). Ver docs/profit-report.md seção 5.
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)
  await enforceReportAccess(organizationId, 'costs')

  const query = getQuery(event)

  const dateFrom = parseDateStart(query.dateFrom as string)
  const dateTo = parseDateEnd(query.dateTo as string)
  const statusFilters = normalizeStatusFilters(query.status)
  const compareWithPreviousPeriod = query.compareWithPreviousPeriod === 'true'
  const compareMode = ['same_period_last_year', 'previous_month', 'previous_quarter'].includes(query.compareMode as string) ? String(query.compareMode) : 'previous_period'

  if (!dateFrom || !dateTo) {
    return { data: { profitReport: { currentData: null, previousData: null, variations: null, comparisonMeta: null, evolutionData: [] } } }
  }

  const [orders, transactions] = await Promise.all([
    fetchAllOrganizationRows(supabase, {
      table: 'service_orders',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'created_at' }
    }),
    fetchAllOrganizationRows(supabase, {
      table: 'financial_transactions',
      organizationId,
      nullColumns: ['deleted_at'],
      order: { column: 'due_date' }
    })
  ])

  const currentData = calculateCashFlowPeriodData(orders, transactions, dateFrom, dateTo, statusFilters)
  const { previousData, comparisonMeta } = resolveComparison(
    dateFrom,
    dateTo,
    compareMode,
    compareWithPreviousPeriod,
    (start, end) => calculateCashFlowPeriodData(orders, transactions, start, end, statusFilters)
  )
  const variations = buildVariations(currentData, previousData)
  const evolutionData = buildCashFlowEvolutionData(currentData, dateFrom, dateTo)

  return {
    data: {
      profitReport: {
        currentData: toPublicPeriodData(currentData),
        previousData: toPublicPeriodData(previousData),
        variations,
        comparisonMeta,
        evolutionData
      }
    }
  }
})
