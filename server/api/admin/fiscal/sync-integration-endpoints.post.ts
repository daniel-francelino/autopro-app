import { defineEventHandler } from 'h3'
import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'

interface EndpointDef {
  function_name: string
  method: string
  path: string
  integration: string
  description?: string
}

const ENDPOINTS: EndpointDef[] = [
  // company
  { function_name: 'listFocusNfeEmpresas', method: 'GET', path: '/v2/empresas', integration: 'company' },
  { function_name: 'createFocusNfeEmpresa', method: 'POST', path: '/v2/empresas', integration: 'company' },
  { function_name: 'getFocusNfeEmpresa', method: 'GET', path: '/v2/empresas/{cnpj}', integration: 'company' },
  { function_name: 'updateFocusNfeEmpresa', method: 'PUT', path: '/v2/empresas/{cnpj}', integration: 'company' },
  { function_name: 'deleteFocusNfeEmpresa', method: 'DELETE', path: '/v2/empresas/{cnpj}', integration: 'company' },
  { function_name: 'syncFocusNfeEmpresa:check', method: 'GET', path: '/v2/empresas/{cnpj}', integration: 'company' },
  { function_name: 'syncFocusNfeEmpresa:create', method: 'POST', path: '/v2/empresas', integration: 'company' },
  { function_name: 'syncFocusNfeEmpresa:update', method: 'PUT', path: '/v2/empresas/{cnpj}', integration: 'company' },
  // municipalities
  { function_name: 'listFocusNfeMunicipios', method: 'GET', path: '/v2/municipios', integration: 'municipalities' },
  { function_name: 'getFocusNfeMunicipio', method: 'GET', path: '/v2/municipios/{codigo_ibge}', integration: 'municipalities' },
  { function_name: 'listFocusNfeItensListaServico', method: 'GET', path: '/v2/municipios/{codigo_ibge}/servicos', integration: 'municipalities' },
  { function_name: 'getFocusNfeItemListaServico', method: 'GET', path: '/v2/municipios/{codigo_ibge}/servicos/{codigo}', integration: 'municipalities' },
  { function_name: 'listFocusNfeCodigosTributarios', method: 'GET', path: '/v2/municipios/{codigo_ibge}/codigos_tributarios', integration: 'municipalities' },
  { function_name: 'getFocusNfeCodigoTributario', method: 'GET', path: '/v2/municipios/{codigo_ibge}/codigos_tributarios/{codigo}', integration: 'municipalities' },
  // business lookup
  { function_name: 'getFocusNfeCnpj', method: 'GET', path: '/v2/cnpj/{cnpj}', integration: 'lookup' },
  { function_name: 'getFocusNfeCep', method: 'GET', path: '/v2/cep/{cep}', integration: 'lookup' },
  // nfse
  { function_name: 'createFocusNfeNfse', method: 'POST', path: '/v2/nfse', integration: 'nfse' },
  { function_name: 'getFocusNfeNfse', method: 'GET', path: '/v2/nfse/{referencia}', integration: 'nfse' },
  { function_name: 'cancelFocusNfeNfse', method: 'DELETE', path: '/v2/nfse/{referencia}', integration: 'nfse' },
  { function_name: 'sendFocusNfeNfseEmail', method: 'POST', path: '/v2/nfse/{referencia}/email', integration: 'nfse' },
  { function_name: 'retryFocusNfeNfseHook', method: 'POST', path: '/v2/nfse/{referencia}/hook', integration: 'nfse' }
]

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const supabase = getSupabaseAdminClient()
  const results: Array<{ function_name: string, status: string, id?: string }> = []

  for (const endpoint of ENDPOINTS) {
    try {
      const { data: existing } = await supabase
        .from('fiscal_integration_endpoints')
        .select('id')
        .eq('function_name', endpoint.function_name)
        .maybeSingle()

      const payload = {
        function_name: endpoint.function_name,
        method: endpoint.method,
        path: endpoint.path,
        integration: endpoint.integration,
        description: endpoint.description ?? null,
        is_active: true,
        source: 'api_routes'
      }

      if (existing?.id) {
        await supabase
          .from('fiscal_integration_endpoints')
          .update(payload)
          .eq('id', existing.id)
        results.push({ function_name: endpoint.function_name, status: 'updated', id: existing.id })
      } else {
        const { data: created } = await supabase
          .from('fiscal_integration_endpoints')
          .insert(payload)
          .select('id')
          .single()
        results.push({ function_name: endpoint.function_name, status: 'created', id: created?.id })
      }
    } catch {
      results.push({ function_name: endpoint.function_name, status: 'skipped' })
    }
  }

  return {
    success: true,
    data: { count: results.length, results }
  }
})
