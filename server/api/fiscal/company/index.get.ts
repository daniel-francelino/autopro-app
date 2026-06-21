import { defineEventHandler, getQuery, createError } from 'h3'
import {
  getFocusNfeApiBaseUrl,
  getFocusNfeBasicAuthHeader,
  monitoredFocusNfeFetch
} from '../../../utils/focus-nfe'
import { sanitizeCpfCnpj } from '../../../utils/nuvem-fiscal'
import { mapCompanyResult, mapFiscalErrorDetails } from '../../../utils/fiscal-mappers'
import type { FocusNfeEmpresaResponse } from '../../../types/focus-nfe'
import type { CompanyResult } from '../../../types/fiscal'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)
  if (!user) {
    throw createError({ statusCode: 403, message: 'Acesso negado' })
  }

  const queryParams = getQuery(event)

  let authHeader: string
  try {
    authHeader = getFocusNfeBasicAuthHeader()
  } catch {
    throw createError({ statusCode: 503, message: 'Integração Focus NFe não configurada no servidor' })
  }

  const apiBaseUrl = getFocusNfeApiBaseUrl()

  const offset = Math.max(0, Number(queryParams.offset) || 0)
  const businessId = sanitizeCpfCnpj(queryParams.business_id)
  const individualId = sanitizeCpfCnpj(queryParams.individual_id)

  const params = new URLSearchParams()
  params.set('offset', String(offset))
  if (businessId) params.set('cnpj', businessId)
  if (individualId) params.set('cpf', individualId)

  let response: Response
  let responseBodyRaw: string | null
  try {
    ;({ response, responseBodyRaw } = await monitoredFocusNfeFetch({
      authUserEmail: user.email!,
      functionName: 'listFocusNfeEmpresas',
      url: `${apiBaseUrl}/v2/empresas?${params.toString()}`,
      captureResponseBody: 'always',
      init: {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      }
    }))
  } catch (err: any) {
    throw createError({ statusCode: 502, message: `Erro ao conectar com a Focus NFe: ${err?.message ?? 'falha de rede'}` })
  }

  if (!response.ok) {
    const raw = responseBodyRaw ? JSON.parse(responseBodyRaw) : null
    throw createError({
      statusCode: response.status,
      data: { error: 'Erro ao listar empresas na Focus NFe', details: mapFiscalErrorDetails(raw) }
    })
  }

  const rawList: FocusNfeEmpresaResponse[] = responseBodyRaw ? JSON.parse(responseBodyRaw) : []
  const results: CompanyResult[] = rawList.map(mapCompanyResult)
  const total = response.headers.get('x-total-count')
  return { success: true, data: results, total: total ? Number(total) : undefined }
})
