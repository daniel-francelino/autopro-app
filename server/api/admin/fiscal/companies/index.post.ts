import { defineEventHandler, readBody, getQuery, createError } from 'h3'
import {
  getFocusNfeApiBaseUrl,
  getFocusNfeBasicAuthHeader,
  monitoredFocusNfeFetch
} from '../../../../utils/focus-nfe'
import { mapCompanyInput, mapCompanyResult, mapFiscalErrorDetails } from '../../../../utils/fiscal-mappers'
import type { FocusNfeEmpresaResponse } from '../../../../types/focus-nfe'
import type { CompanyInput, CompanyResult } from '../../../../types/fiscal'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  if (!user) {
    throw createError({ statusCode: 403, message: 'Acesso negado' })
  }

  const body: CompanyInput = await readBody(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, message: 'Payload da empresa é obrigatório' })
  }

  const { dry_run } = getQuery(event)
  const authHeader = getFocusNfeBasicAuthHeader()
  const apiBaseUrl = getFocusNfeApiBaseUrl()

  const url = dry_run === '1' ? `${apiBaseUrl}/v2/empresas?dry_run=1` : `${apiBaseUrl}/v2/empresas`

  const { response, responseBodyRaw } = await monitoredFocusNfeFetch({
    authUserEmail: user.email!,
    functionName: 'createFocusNfeEmpresa',
    url,
    captureResponseBody: 'always',
    init: {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(mapCompanyInput(body))
    }
  })

  if (!response.ok) {
    const raw = responseBodyRaw ? JSON.parse(responseBodyRaw) : null
    throw createError({
      statusCode: response.status,
      data: { error: 'Erro ao criar empresa na Focus NFe', details: mapFiscalErrorDetails(raw) }
    })
  }

  const result: CompanyResult = mapCompanyResult(JSON.parse(responseBodyRaw!) as FocusNfeEmpresaResponse)
  return { success: true, data: result }
})
