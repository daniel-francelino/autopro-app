import { defineEventHandler, readBody, createError } from 'h3'
import { requireAuthUser } from '../../../utils/require-auth'
import {
  getFocusNfeApiBaseUrl,
  getFocusNfeBasicAuthHeader,
  monitoredFocusNfeFetch
} from '../../../utils/focus-nfe'
import { sanitizeCpfCnpj } from '../../../utils/nuvem-fiscal'
import { mapCompanyInput, mapCompanyResult, mapFiscalErrorDetails } from '../../../utils/fiscal-mappers'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import type { FocusNfeEmpresaResponse } from '../../../types/focus-nfe'
import type { CompanyInput, CompanyResult } from '../../../types/fiscal'

export default defineEventHandler(async (event) => {
  const user = await requireAuthUser(event)

  const body: CompanyInput & { organization_id?: string } = await readBody(event)
  const { organization_id, ...companyInput } = body || {}

  if (!organization_id) {
    throw createError({ statusCode: 400, message: 'organization_id é obrigatório' })
  }

  const taxId = sanitizeCpfCnpj(companyInput.business_id ?? companyInput.individual_id)
  if (!taxId) {
    throw createError({ statusCode: 400, message: 'business_id ou individual_id é obrigatório' })
  }

  if (!companyInput.name?.trim()) {
    throw createError({ statusCode: 400, message: 'name (razão social) é obrigatório' })
  }

  // Normalize: CNPJ/CPF must be digits-only for the API; use the already-sanitized taxId.
  // Always enable NFS-e emission and email delivery to recipient.
  const syncInput: CompanyInput = {
    ...(companyInput.business_id
      ? { ...companyInput, business_id: taxId }
      : { ...companyInput, individual_id: taxId }),
    nfse_enabled: true,
    send_email_to_recipient: true
  }

  const authHeader = getFocusNfeBasicAuthHeader()
  const apiBaseUrl = getFocusNfeApiBaseUrl()
  const headers = { 'Authorization': authHeader, 'Content-Type': 'application/json' }

  // Check if company already exists in Focus NFe
  const { response: getResp } = await monitoredFocusNfeFetch({
    authUserEmail: user.email!,
    functionName: 'syncFocusNfeEmpresa:check',
    url: `${apiBaseUrl}/v2/empresas/${encodeURIComponent(taxId)}`,
    init: { method: 'GET', headers }
  })

  const companyExists = getResp.ok
  const method = companyExists ? 'PUT' : 'POST'
  const saveUrl = companyExists
    ? `${apiBaseUrl}/v2/empresas/${encodeURIComponent(taxId)}`
    : `${apiBaseUrl}/v2/empresas`

  const { response: saveResp, responseBodyRaw: saveRaw } = await monitoredFocusNfeFetch({
    authUserEmail: user.email!,
    functionName: companyExists ? 'syncFocusNfeEmpresa:update' : 'syncFocusNfeEmpresa:create',
    captureResponseBody: 'always',
    url: saveUrl,
    init: { method, headers, body: JSON.stringify(mapCompanyInput(syncInput)) }
  })

  const saveData = saveRaw ? JSON.parse(saveRaw) : null
  const nowIso = new Date().toISOString()

  // Upsert fiscal_sync_status record
  const supabase = getSupabaseAdminClient()
  let syncRecord = null
  try {
    const { data: existing } = await supabase
      .from('fiscal_sync_status')
      .select('id, last_synced_at, selected_state')
      .eq('organization_id', organization_id)
      .maybeSingle()

    const syncData = {
      organization_id,
      tax_id: taxId,
      integration_status: saveResp.ok ? 'active' : 'error',
      is_company_synced: saveResp.ok,
      sync_status: saveResp.ok ? 'synced' : 'error',
      sync_error_message: saveResp.ok
        ? null
        : (saveData?.mensagem || saveData?.message || JSON.stringify(saveData)?.slice(0, 500)),
      sync_error_code: saveResp.ok ? null : String(saveResp.status),
      last_synced_at: saveResp.ok ? nowIso : (existing?.last_synced_at ?? null),
      last_sync_attempt_at: nowIso,
      selected_state: companyInput.state?.toUpperCase().slice(0, 2) ?? existing?.selected_state ?? null,
      provider_response_json: JSON.stringify(saveData)?.slice(0, 5000),
      contact_name: companyInput.contact_name?.trim() || null,
      contact_cpf: sanitizeCpfCnpj(companyInput.contact_id) || null
    }

    if (existing?.id) {
      const { data } = await supabase
        .from('fiscal_sync_status')
        .update(syncData)
        .eq('id', existing.id)
        .select()
        .single()
      syncRecord = data
    } else {
      const { data } = await supabase
        .from('fiscal_sync_status')
        .insert(syncData)
        .select()
        .single()
      syncRecord = data
    }
  } catch (err) {
    console.error('Error upserting fiscal_sync_status:', err)
  }

  if (!saveResp.ok) {
    throw createError({
      statusCode: saveResp.status,
      data: {
        success: false,
        error: companyExists ? 'Erro ao atualizar empresa na Focus NFe' : 'Erro ao criar empresa na Focus NFe',
        details: mapFiscalErrorDetails(saveData),
        syncRecord
      }
    })
  }

  const result: CompanyResult = mapCompanyResult(saveData as FocusNfeEmpresaResponse)

  return {
    success: true,
    action: companyExists ? 'updated' : 'created',
    data: result,
    syncRecord
  }
})
