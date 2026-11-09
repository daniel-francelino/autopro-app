import { defineEventHandler, getQuery } from 'h3'
import { requireOwner } from '../../../utils/require-owner'
import { getSupabaseAdminClient } from '../../../utils/supabase'

const DAY_MS = 86_400_000
const MAX_RANGE_DAYS = 31
const OUTCOMES = ['success', 'denied', 'invalid', 'error']
const LIST_COLUMNS = 'id, created_at, request_id, actor_email, actor_type, actor_role, organization_id, action, resource_type, resource_id, http_method, route_pattern, status_code, outcome, duration_ms, error_message, platform'

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** Prefixo de UUID (ex.: os 8 caracteres do código mostrado no toast) → intervalo [min, max]. */
function uuidRange(prefix: string): { min: string, max: string } | null {
  const hex = prefix.toLowerCase().replace(/-/g, '')
  if (!/^[0-9a-f]{1,32}$/.test(hex)) return null
  const format = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  return { min: format(hex.padEnd(32, '0')), max: format(hex.padEnd(32, 'f')) }
}

/**
 * GET /api/admin/audit-logs
 * Lista o log de auditoria (somente owner da plataforma). Sem corpos: o detalhe vem em /:id.
 * Toda consulta tem intervalo de datas (padrão 24 h, máx. 31 dias) para o PostgreSQL podar partições.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const query = getQuery(event)
  const to = query.to ? new Date(String(query.to)) : new Date()
  const from = query.from ? new Date(String(query.from)) : new Date(to.getTime() - DAY_MS)

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw createError({ statusCode: 400, statusMessage: 'Período inválido' })
  }
  if (to < from) {
    throw createError({ statusCode: 400, statusMessage: 'O fim do período deve ser depois do início' })
  }
  if ((to.getTime() - from.getTime()) / DAY_MS > MAX_RANGE_DAYS) {
    throw createError({ statusCode: 400, statusMessage: `Período máximo de ${MAX_RANGE_DAYS} dias` })
  }

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50))
  const offset = (page - 1) * pageSize

  const supabase = getSupabaseAdminClient()
  let db = supabase
    .from('audit_logs')
    .select(LIST_COLUMNS, { count: 'exact' })
    .gte('created_at', from.toISOString())
    .lte('created_at', to.toISOString())
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  const organizationId = text(query.organizationId)
  if (organizationId) db = db.eq('organization_id', organizationId)

  const actorEmail = text(query.actorEmail).toLowerCase()
  if (actorEmail) db = db.ilike('actor_email', `%${actorEmail.replace(/[%_]/g, m => `\\${m}`)}%`)

  const resourceType = text(query.resourceType)
  if (resourceType) db = db.eq('resource_type', resourceType)

  const resourceId = text(query.resourceId)
  if (resourceId) db = db.eq('resource_id', resourceId)

  const action = text(query.action)
  if (action) db = db.eq('action', action)

  const method = text(query.method).toUpperCase()
  if (method) db = db.eq('http_method', method)

  const outcomes = [query.outcome].flat().flatMap(v => String(v ?? '').split(',')).map(v => v.trim()).filter(v => OUTCOMES.includes(v))
  if (outcomes.length) db = db.in('outcome', outcomes)

  const requestId = text(query.requestId)
  if (requestId) {
    const range = uuidRange(requestId)
    if (!range) throw createError({ statusCode: 400, statusMessage: 'Código da requisição inválido' })
    db = db.gte('request_id', range.min).lte('request_id', range.max)
  }

  const { data, error, count } = await db
  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Erro ao consultar o log de auditoria' })
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const orgIds = [...new Set(rows.map(r => r.organization_id).filter((id): id is string => typeof id === 'string'))]
  const names = new Map<string, string>()
  if (orgIds.length) {
    const { data: orgs } = await supabase.from('organizations').select('id, name').in('id', orgIds)
    for (const org of orgs ?? []) names.set(org.id as string, org.name as string)
  }

  return {
    data: rows.map(row => ({
      ...row,
      organization_name: typeof row.organization_id === 'string' ? names.get(row.organization_id) ?? null : null
    })),
    total: count ?? 0,
    page,
    pageSize
  }
})
