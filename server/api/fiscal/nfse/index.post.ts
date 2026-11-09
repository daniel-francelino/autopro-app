import { defineEventHandler, readBody, createError } from 'h3'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import {
  getFocusNfeApiBaseUrl,
  getFocusNfeBasicAuthHeader,
  monitoredFocusNfeFetch
} from '../../../utils/focus-nfe'
import { mapNfseInput, mapNfseResult, mapFiscalErrorDetails } from '../../../utils/fiscal-mappers'
import { upsertNfseRecord } from '../../../utils/nfse-sync'
import type { FocusNfeNfseResponse } from '../../../types/focus-nfe'
import type { NfseInput, NfseResult } from '../../../types/fiscal'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  await requireOrgPermission(user.id, 'service_invoice.create', event)

  const body: NfseInput = await readBody(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, message: 'Payload da NFSe é obrigatório' })
  }
  if (!body.reference) {
    throw createError({ statusCode: 400, message: 'Campo obrigatório: reference' })
  }
  if (!body.service?.description || body.service.service_value == null) {
    throw createError({ statusCode: 400, message: 'Campos obrigatórios: service.description e service.service_value' })
  }

  const focusNfePayload = mapNfseInput(body)
  const authHeader = getFocusNfeBasicAuthHeader()
  const apiBaseUrl = getFocusNfeApiBaseUrl()

  const { response, responseBodyRaw } = await monitoredFocusNfeFetch({
    authUserEmail: user.email!,
    functionName: 'createFocusNfeNfse',
    url: `${apiBaseUrl}/v2/nfse`,
    captureResponseBody: 'always',
    init: {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(focusNfePayload)
    }
  })

  if (!response.ok) {
    const raw = responseBodyRaw ? JSON.parse(responseBodyRaw) : null
    throw createError({
      statusCode: response.status,
      data: { error: 'Erro ao emitir NFSe na Focus NFe', details: mapFiscalErrorDetails(raw) }
    })
  }

  const rawNfse = JSON.parse(responseBodyRaw!) as FocusNfeNfseResponse

  if (body.service_order_id && body.organization_id) {
    await upsertNfseRecord({
      serviceOrderId: body.service_order_id,
      organizationId: body.organization_id,
      serviceOrderNumber: body.service_order_number ?? null,
      payloadJson: JSON.stringify(focusNfePayload),
      rawResponse: rawNfse,
      rawResponseJson: responseBodyRaw!,
      userEmail: user.email ?? undefined
    })
  }

  const result: NfseResult = mapNfseResult(rawNfse)
  return { success: true, data: result }
})
