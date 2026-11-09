import { defineEventHandler, getQuery, createError } from 'h3'
import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const query = getQuery(event)

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50))
  const offset = (page - 1) * pageSize

  const functionName = query.function_name as string | undefined
  const integration = query.integration as string | undefined
  const organizationId = query.organization_id as string | undefined
  const isSuccess = query.is_success === undefined ? undefined : query.is_success === 'true'
  const search = (query.search as string | undefined)?.trim()

  const supabase = getSupabaseAdminClient()

  let countQuery = supabase
    .from('fiscal_integration_logs')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)

  let dataQuery = supabase
    .from('fiscal_integration_logs')
    .select(
      'id, organization_id, integration, function_name, request_method, request_url, request_path, response_status, response_ok, duration_ms, is_success, error_message, user_email, created_at'
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (organizationId) {
    countQuery = countQuery.eq('organization_id', organizationId)
    dataQuery = dataQuery.eq('organization_id', organizationId)
  }

  if (functionName) {
    countQuery = countQuery.eq('function_name', functionName)
    dataQuery = dataQuery.eq('function_name', functionName)
  }

  if (integration) {
    countQuery = countQuery.eq('integration', integration)
    dataQuery = dataQuery.eq('integration', integration)
  }

  if (isSuccess !== undefined) {
    countQuery = countQuery.eq('is_success', isSuccess)
    dataQuery = dataQuery.eq('is_success', isSuccess)
  }

  if (search) {
    const pattern = `%${search}%`
    countQuery = countQuery.or(`function_name.ilike.${pattern},request_url.ilike.${pattern},user_email.ilike.${pattern}`)
    dataQuery = dataQuery.or(`function_name.ilike.${pattern},request_url.ilike.${pattern},user_email.ilike.${pattern}`)
  }

  const [{ count, error: countError }, { data: logs, error: dataError }] = await Promise.all([
    countQuery,
    dataQuery
  ])

  if (countError || dataError) {
    throw createError({ statusCode: 500, message: 'Erro ao listar logs de integração fiscal' })
  }

  const total = count ?? 0

  return {
    success: true,
    data: logs ?? [],
    meta: {
      total,
      page,
      pageSize,
      pages: Math.ceil(total / pageSize)
    }
  }
})
