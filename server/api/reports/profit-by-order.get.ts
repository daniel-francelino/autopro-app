import { defineEventHandler, getQuery } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchAllOrganizationRows } from '../../utils/supabase-pagination'
import { parseDateStart, parseDateEnd } from '../../utils/report-helpers'
import { enforceReportAccess } from '../../utils/license'
import { calculateByOrderPeriodData, buildByOrderEvolutionData, buildTopProfitableOrders, resolveComparison, buildVariations, toPublicPeriodData } from '../../utils/profit-report-helpers'

// Modo "Pelas OS": margem por serviço prestado — receita da OS menos o custo de peças
// da própria OS (total_cost_amount), independente de status de pagamento.
// Ver docs/profit-report.md seção 5.
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)
  await enforceReportAccess(organizationId, 'costs')

  const query = getQuery(event)

  const dateFrom = parseDateStart(query.dateFrom as string)
  const dateTo = parseDateEnd(query.dateTo as string)
  const compareWithPreviousPeriod = query.compareWithPreviousPeriod === 'true'
  const compareMode = ['same_period_last_year', 'previous_month', 'previous_quarter'].includes(query.compareMode as string) ? String(query.compareMode) : 'previous_period'

  if (!dateFrom || !dateTo) {
    return { data: { profitReport: { currentData: null, previousData: null, variations: null, comparisonMeta: null, evolutionData: [], topProfitableOrders: [] } } }
  }

  const orders = await fetchAllOrganizationRows(supabase, {
    table: 'service_orders',
    organizationId,
    nullColumns: ['deleted_at'],
    order: { column: 'created_at' }
  })

  const currentData = calculateByOrderPeriodData(orders, dateFrom, dateTo)
  const { previousData, comparisonMeta } = resolveComparison(
    dateFrom,
    dateTo,
    compareMode,
    compareWithPreviousPeriod,
    (start, end) => calculateByOrderPeriodData(orders, start, end)
  )
  const variations = buildVariations(currentData, previousData)
  const evolutionData = buildByOrderEvolutionData(currentData, dateFrom, dateTo)
  const topProfitableOrders = buildTopProfitableOrders(currentData.orders)

  return {
    data: {
      profitReport: {
        currentData: toPublicPeriodData(currentData),
        previousData: toPublicPeriodData(previousData),
        variations,
        comparisonMeta,
        evolutionData,
        topProfitableOrders
      }
    }
  }
})
