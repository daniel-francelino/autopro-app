import { defineEventHandler, getRouterParam } from 'h3'
import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { setAuditContext } from '../../../utils/audit/context'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/admin/audit-logs/:id
 * Linha completa (request, response, mudanças) + as outras linhas da mesma requisição.
 * Abrir o detalhe é registrado como `audit.view`: quem viu dados de outra oficina fica rastreável.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const id = getRouterParam(event, 'id') ?? ''
  if (!UUID.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Identificador inválido' })
  }

  const supabase = getSupabaseAdminClient()
  const { data: row, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Erro ao consultar o log de auditoria' })
  }
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Registro não encontrado' })
  }

  const { data: related } = await supabase
    .from('audit_logs')
    .select('id, created_at, action, status_code, outcome, http_method, route_pattern')
    .eq('request_id', row.request_id)
    .neq('id', id)
    .order('created_at', { ascending: true })
    .limit(20)

  let organizationName: string | null = null
  if (row.organization_id) {
    const { data: org } = await supabase.from('organizations').select('name').eq('id', row.organization_id).maybeSingle()
    organizationName = (org?.name as string | undefined) ?? null
  }

  // Registra qual log (e de qual oficina) o owner abriu.
  setAuditContext(event, { resourceType: 'audit_log', resourceId: id, organizationId: row.organization_id ?? undefined })

  return { ...row, organization_name: organizationName, related: related ?? [] }
})
