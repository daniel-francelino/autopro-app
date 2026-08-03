import { defineEventHandler, getQuery } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchAllOrganizationRows } from '../../utils/supabase-pagination'
import { parseDateStart, parseDateEnd } from '../../utils/report-helpers'
import { enforceReportAccess } from '../../utils/license'
import { calculateAccrualPeriodData, buildAccrualEvolutionData, resolveComparison, buildVariations, toPublicPeriodData } from '../../utils/profit-report-helpers'

// Modo "Resultado do Período": P&L de competência completo — receita de OS reconhecida
// menos despesas gerais reconhecidas, ambas independentes de status de pagamento.
// Sempre considera tudo (statusFilters vazio) — não aceita filtro de status.
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

  const currentData = calculateAccrualPeriodData(orders, transactions, dateFrom, dateTo)
  const { previousData, comparisonMeta } = resolveComparison(
    dateFrom,
    dateTo,
    compareMode,
    compareWithPreviousPeriod,
    (start, end) => calculateAccrualPeriodData(orders, transactions, start, end)
  )
  const variations = buildVariations(currentData, previousData)
  const evolutionData = buildAccrualEvolutionData(currentData, dateFrom, dateTo)

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
