import type { SupabaseClient } from '@supabase/supabase-js'
import { createError } from 'h3'

export type SupabaseReportRow = object

interface SupabaseQueryError {
  message: string
}

interface SupabaseQueryResult<T extends SupabaseReportRow> {
  data: T[] | null
  error: SupabaseQueryError | null
}

interface SupabaseQueryBuilder<T extends SupabaseReportRow> {
  select: (columns: string) => SupabaseQueryBuilder<T>
  eq: (column: string, value: unknown) => SupabaseQueryBuilder<T>
  is: (column: string, value: unknown) => SupabaseQueryBuilder<T>
  order: (column: string, options: { ascending: boolean }) => SupabaseQueryBuilder<T>
  range: (from: number, to: number) => Promise<SupabaseQueryResult<T>>
}

export interface SupabaseClientLike {
  from: <T extends SupabaseReportRow = SupabaseReportRow>(table: string) => SupabaseQueryBuilder<T>
}

interface FetchAllRowsOptions {
  table: string
  organizationId: string
  columns?: string
  eq?: Record<string, unknown>
  nullColumns?: string[]
  order?: {
    column: string
    ascending?: boolean
  }
  pageSize?: number
}

export async function fetchAllOrganizationRows<T extends SupabaseReportRow = SupabaseReportRow>(
  supabase: SupabaseClientLike | SupabaseClient,
  options: FetchAllRowsOptions
): Promise<T[]> {
  const pageSize = options.pageSize ?? 1000
  const rows: T[] = []
  // The real SupabaseClient is structurally richer than SupabaseClientLike (and untyped
  // here, Database = any), so narrow once to the minimal paginated-SELECT surface.
  const client = supabase as SupabaseClientLike

  for (let offset = 0; ; offset += pageSize) {
    let query = client
      .from<T>(options.table)
      .select(options.columns ?? '*')
      .eq('organization_id', options.organizationId)

    for (const column of options.nullColumns ?? []) {
      query = query.is(column, null)
    }

    for (const [column, value] of Object.entries(options.eq ?? {})) {
      query = query.eq(column, value)
    }

    if (options.order) {
      query = query.order(options.order.column, { ascending: options.order.ascending ?? false })
    }

    const { data, error } = await query.range(offset, offset + pageSize - 1)

    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: `Erro ao carregar dados de ${options.table}: ${error.message}`
      })
    }

    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }

  return rows
}
