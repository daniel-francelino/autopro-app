import { defineEventHandler, getQuery, createError } from 'h3'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import { getSupabaseAdminClient } from '../../../utils/supabase'

const SUMMARY_COLUMNS = [
  'id',
  'service_order_id',
  'organization_id',
  'status',
  'service_order_number',
  'provider_nfse_id',
  'provider_status',
  'nfse_number',
  'verification_code',
  'issued_at',
  'environment',
  'provider_reference',
  'dps_series',
  'dps_number',
  'document_url',
  'last_error_message',
  'last_error_at',
  'created_at',
  'updated_at'
].join(', ')

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'service_invoice.read', event)
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const query = getQuery(event)

  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20))
  const offset = (page - 1) * limit

  const serviceOrderId = query.service_order_id as string | undefined
  const status = query.status as string | undefined
  const search = (query.search as string | undefined)?.trim()

  const supabase = getSupabaseAdminClient()

  let countQuery = supabase
    .from('service_order_nfse')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .is('deleted_at', null)

  let dataQuery = supabase
    .from('service_order_nfse')
    .select(SUMMARY_COLUMNS)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (serviceOrderId) {
    countQuery = countQuery.eq('service_order_id', serviceOrderId)
    dataQuery = dataQuery.eq('service_order_id', serviceOrderId)
  }

  if (status) {
    countQuery = countQuery.eq('status', status)
    dataQuery = dataQuery.eq('status', status)
  }

  if (search) {
    const pattern = `%${search}%`
    countQuery = countQuery.or(
      `provider_reference.ilike.${pattern},nfse_number.ilike.${pattern},service_order_number.ilike.${pattern}`
    )
    dataQuery = dataQuery.or(
      `provider_reference.ilike.${pattern},nfse_number.ilike.${pattern},service_order_number.ilike.${pattern}`
    )
  }

  const [{ count, error: countError }, { data, error: dataError }] = await Promise.all([
    countQuery,
    dataQuery
  ])

  if (countError || dataError) {
    throw createError({ statusCode: 500, message: 'Erro ao buscar NFSe no banco de dados' })
  }

  const total = count ?? 0

  return {
    success: true,
    data: data ?? [],
    meta: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  }
})
