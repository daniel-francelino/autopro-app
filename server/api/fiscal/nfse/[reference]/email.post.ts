import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireOrgPermission } from '../../../../utils/require-org-permission'
import {
  getFocusNfeApiBaseUrl,
  getFocusNfeBasicAuthHeader,
  monitoredFocusNfeFetch
} from '../../../../utils/focus-nfe'
import { mapFiscalErrorDetails } from '../../../../utils/fiscal-mappers'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  await requireOrgPermission(user.id, 'service_invoice.read', event)

  const reference = getRouterParam(event, 'reference')
  if (!reference) {
    throw createError({ statusCode: 400, message: 'reference é obrigatório' })
  }

  const body: { emails?: string[] } = await readBody(event)
  if (!Array.isArray(body?.emails) || body.emails.length === 0) {
    throw createError({ statusCode: 400, message: 'Campo obrigatório: emails (array com ao menos 1 email)' })
  }
  if (body.emails.length > 10) {
    throw createError({ statusCode: 400, message: 'Máximo de 10 emails por requisição' })
  }

  const authHeader = getFocusNfeBasicAuthHeader()
  const apiBaseUrl = getFocusNfeApiBaseUrl()

  const { response, responseBodyRaw } = await monitoredFocusNfeFetch({
    authUserEmail: user.email!,
    functionName: 'sendFocusNfeNfseEmail',
    url: `${apiBaseUrl}/v2/nfse/${encodeURIComponent(reference)}/email`,
    captureResponseBody: 'always',
    init: {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ emails: body.emails })
    }
  })

  if (!response.ok) {
    const raw = responseBodyRaw ? JSON.parse(responseBodyRaw) : null
    throw createError({
      statusCode: response.status,
      data: { error: 'Erro ao reenviar email da NFSe na Focus NFe', details: mapFiscalErrorDetails(raw) }
    })
  }

  const result: { emails: string[] } = responseBodyRaw ? JSON.parse(responseBodyRaw) : { emails: body.emails }
  return { success: true, data: result }
})
