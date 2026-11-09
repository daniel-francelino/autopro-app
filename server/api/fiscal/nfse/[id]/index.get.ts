import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireOrgPermission } from '../../../../utils/require-org-permission'
import { getSupabaseAdminClient } from '../../../../utils/supabase'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  await requireOrgPermission(user.id, 'service_invoice.read', event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: 'ID é obrigatório' })
  }

  const supabase = getSupabaseAdminClient()

  const { data, error } = await supabase
    .from('service_order_nfse')
    .select(
      [
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
        'messages_json',
        'cancellation_json',
        'response_json',
        'payload_json',
        'last_error_message',
        'last_error_json',
        'last_error_at',
        'created_at',
        'created_by',
        'updated_at',
        'updated_by'
      ].join(', ')
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, message: 'Erro ao buscar NFSe no banco de dados' })
  }

  if (!data) {
    throw createError({ statusCode: 404, message: 'NFSe não encontrada' })
  }

  return { success: true, data }
})
