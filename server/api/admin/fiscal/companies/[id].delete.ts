import { defineEventHandler, getRouterParam, createError } from 'h3'
import {
  getFocusNfeApiBaseUrl,
  getFocusNfeBasicAuthHeader,
  monitoredFocusNfeFetch
} from '../../../../utils/focus-nfe'
import { mapCompanyResult, mapFiscalErrorDetails } from '../../../../utils/fiscal-mappers'
import type { FocusNfeEmpresaResponse } from '../../../../types/focus-nfe'
import type { CompanyResult } from '../../../../types/fiscal'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  if (!user) {
    throw createError({ statusCode: 403, message: 'Acesso negado' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: 'id é obrigatório' })
  }

  const authHeader = getFocusNfeBasicAuthHeader()
  const apiBaseUrl = getFocusNfeApiBaseUrl()

  const { response, responseBodyRaw } = await monitoredFocusNfeFetch({
    authUserEmail: user.email!,
    functionName: 'deleteFocusNfeEmpresa',
    url: `${apiBaseUrl}/v2/empresas/${encodeURIComponent(id)}`,
    captureResponseBody: 'always',
    init: {
      method: 'DELETE',
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
      data: { error: 'Erro ao excluir empresa na Focus NFe', details: mapFiscalErrorDetails(raw) }
    })
  }

  const result: CompanyResult = mapCompanyResult(JSON.parse(responseBodyRaw!) as FocusNfeEmpresaResponse)
  return { success: true, data: result }
})
