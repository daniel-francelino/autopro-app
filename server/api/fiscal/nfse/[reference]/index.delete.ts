import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireAuthUser } from '../../../../utils/require-auth'
import { requireOrgPermission } from '../../../../utils/require-org-permission'
import { assertNfseBelongsToOrg } from '../../../../utils/nfse-ownership'
import {
  getFocusNfeApiBaseUrl,
  getFocusNfeBasicAuthHeader,
  monitoredFocusNfeFetch
} from '../../../../utils/focus-nfe'
import { mapNfseCancelResult, mapFiscalErrorDetails } from '../../../../utils/fiscal-mappers'
import { markNfseDbCancelled } from '../../../../utils/nfse-sync'
import type { FocusNfeNfseCancelResponse } from '../../../../types/focus-nfe'
import type { NfseCancelResult } from '../../../../types/fiscal'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  await requireOrgPermission(user.id, 'service_invoice.delete', event)

  const reference = getRouterParam(event, 'reference')
  if (!reference) {
    throw createError({ statusCode: 400, message: 'reference é obrigatório' })
  }

  await assertNfseBelongsToOrg(event, user.id, reference)

  const body: { justification?: string } = await readBody(event).catch(() => ({}))
  const justification = body?.justification?.trim()
  if (justification !== undefined && (justification.length < 15 || justification.length > 255)) {
    throw createError({ statusCode: 400, message: 'justification deve ter entre 15 e 255 caracteres' })
  }

  const authHeader = getFocusNfeBasicAuthHeader()
  const apiBaseUrl = getFocusNfeApiBaseUrl()

  const requestBody: Record<string, string> = {}
  if (justification) requestBody.justificativa = justification

  const { response, responseBodyRaw } = await monitoredFocusNfeFetch({
    authUserEmail: user.email!,
    functionName: 'cancelFocusNfeNfse',
    url: `${apiBaseUrl}/v2/nfse/${encodeURIComponent(reference)}`,
    captureResponseBody: 'always',
    init: {
      method: 'DELETE',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: Object.keys(requestBody).length ? JSON.stringify(requestBody) : undefined
    }
  })

  if (!response.ok) {
    const raw = responseBodyRaw ? JSON.parse(responseBodyRaw) : null
    throw createError({
      statusCode: response.status,
      data: { error: 'Erro ao cancelar NFSe na Focus NFe', details: mapFiscalErrorDetails(raw) }
    })
  }

  const result: NfseCancelResult = mapNfseCancelResult(JSON.parse(responseBodyRaw!) as FocusNfeNfseCancelResponse)

  if (result.status === 'cancelled') {
    markNfseDbCancelled(reference, responseBodyRaw!).catch(() => {})
  }

  return { success: true, data: result }
})
