import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireOrgPermission } from '../../../../utils/require-org-permission'
import {
  getFocusNfeApiBaseUrl,
  getFocusNfeBasicAuthHeader,
  monitoredFocusNfeFetch
} from '../../../../utils/focus-nfe'
import { mapNfseResult, mapFiscalErrorDetails } from '../../../../utils/fiscal-mappers'
import { syncNfseFromApi } from '../../../../utils/nfse-sync'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import type { FocusNfeNfseResponse } from '../../../../types/focus-nfe'
import type { NfseResult } from '../../../../types/fiscal'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  await requireOrgPermission(user.id, 'service_invoice.read', event)

  const reference = getRouterParam(event, 'reference')
  if (!reference) {
    throw createError({ statusCode: 400, message: 'reference é obrigatório' })
  }

  // Try local DB first — skip API if the status is stable (not processing)
  const supabase = getSupabaseAdminClient()
  const { data: dbRecord } = await supabase
    .from('service_order_nfse')
    .select('provider_status, response_json')
    .eq('provider_reference', reference)
    .is('deleted_at', null)
    .maybeSingle()

  if (
    dbRecord?.response_json && dbRecord.provider_status !== 'processando_autorizacao'
  ) {
    const raw = JSON.parse(dbRecord.response_json) as FocusNfeNfseResponse
    return { success: true, data: mapNfseResult(raw) }
  }

  // Not in DB or still processing — fetch from FocusNFE and sync result
  const authHeader = getFocusNfeBasicAuthHeader()
  const apiBaseUrl = getFocusNfeApiBaseUrl()

  const { response, responseBodyRaw } = await monitoredFocusNfeFetch({
    authUserEmail: user.email!,
    functionName: 'getFocusNfeNfse',
    url: `${apiBaseUrl}/v2/nfse/${encodeURIComponent(reference)}`,
    captureResponseBody: 'always',
    init: {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      }
    }
  })

  if (!response.ok) {
    const raw = responseBodyRaw ? JSON.parse(responseBodyRaw) : null
    throw createError({
      statusCode: response.status,
      data: { error: 'Erro ao consultar NFSe na Focus NFe', details: mapFiscalErrorDetails(raw) }
    })
  }

  const rawNfse = JSON.parse(responseBodyRaw!) as FocusNfeNfseResponse

  // Fire-and-forget sync — don't block the response
  syncNfseFromApi(reference, rawNfse, responseBodyRaw!).catch(() => {})

  const result: NfseResult = mapNfseResult(rawNfse)
  return { success: true, data: result }
})
