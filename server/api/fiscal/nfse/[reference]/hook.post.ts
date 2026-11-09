import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireOrgPermission } from '../../../../utils/require-org-permission'
import {
  getFocusNfeApiBaseUrl,
  getFocusNfeBasicAuthHeader,
  monitoredFocusNfeFetch
} from '../../../../utils/focus-nfe'
import { mapWebhookTrigger, mapFiscalErrorDetails } from '../../../../utils/fiscal-mappers'
import type { FocusNfeHookTrigger } from '../../../../types/focus-nfe'
import type { WebhookTrigger } from '../../../../types/fiscal'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  await requireOrgPermission(user.id, 'service_invoice.update', event)

  const reference = getRouterParam(event, 'reference')
  if (!reference) {
    throw createError({ statusCode: 400, message: 'reference é obrigatório' })
  }

  const authHeader = getFocusNfeBasicAuthHeader()
  const apiBaseUrl = getFocusNfeApiBaseUrl()

  const { response, responseBodyRaw } = await monitoredFocusNfeFetch({
    authUserEmail: user.email!,
    functionName: 'retryFocusNfeNfseHook',
    url: `${apiBaseUrl}/v2/nfse/${encodeURIComponent(reference)}/hook`,
    captureResponseBody: 'always',
    init: {
      method: 'POST',
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
      data: { error: 'Erro ao reenviar notificação da NFSe na Focus NFe', details: mapFiscalErrorDetails(raw) }
    })
  }

  const rawList: FocusNfeHookTrigger[] = responseBodyRaw ? JSON.parse(responseBodyRaw) : []
  const results: WebhookTrigger[] = rawList.map(mapWebhookTrigger)
  return { success: true, data: results }
})
