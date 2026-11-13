import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { resolveOrganizationId } from '../../../utils/organization'
import { allowedVisibilities } from '../../../utils/os-history/access'
import { renderOsEvent, type OsEventRow } from '../../../utils/os-history/render'
import { isOsHistorySourceCode } from '../../../../lib/utils/os-history-sources'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

function decodeCursor(raw: string): { t: string, s: number } | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    // Regex estrita: o valor entra cru no filtro .or() do PostgREST e mantém os microssegundos (desempate).
    const t = typeof parsed?.t === 'string' && ISO_TIMESTAMP.test(parsed.t) && !Number.isNaN(Date.parse(parsed.t)) ? parsed.t : null
    const s = typeof parsed?.s === 'number' ? parsed.s : NaN
    return t && Number.isSafeInteger(s) && s >= 0 ? { t, s } : null
  } catch {
    return null
  }
}

/**
 * GET /api/service-orders/:id/history
 * Histórico (timeline) da OS, já renderizado em pt-BR. Filtra por organização, por permissão/visibilidade
 * e pagina por keyset em (occurred_at, seq), do mais recente ao mais antigo.
 * Query: source (código de origem), cursor, limit (padrão 30, máx. 100).
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'orders.read', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const orderId = getRouterParam(event, 'id')
  if (!orderId) throw createError({ statusCode: 400, statusMessage: 'orderId is required' })

  const query = getQuery(event)
  const source = typeof query.source === 'string' && query.source ? query.source : null
  if (source && !isOsHistorySourceCode(source)) {
    throw createError({ statusCode: 400, statusMessage: 'Origem inválida' })
  }
  const limit = Math.min(Math.max(Math.trunc(Number(query.limit)) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const cursorRaw = typeof query.cursor === 'string' && query.cursor ? query.cursor : null
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null
  if (cursorRaw && !cursor) throw createError({ statusCode: 400, statusMessage: 'Cursor inválido' })

  // A OS precisa ser da organização (404 se não for), antes de listar qualquer evento.
  const { data: order, error: orderError } = await supabase
    .from('service_orders')
    .select('id')
    .eq('id', orderId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null) // D6: OS excluída não expõe histórico (eventos seguem na tabela)
    .maybeSingle()
  if (orderError || !order) throw createError({ statusCode: 404, statusMessage: 'Service order not found' })

  const visibilities = await allowedVisibilities(authUser.id)

  let builder = supabase
    .from('service_order_events')
    .select('id, seq, occurred_at, event_type, schema_version, category, actor_name, payload, correlation_id, source_code, source_label')
    .eq('organization_id', organizationId)
    .eq('service_order_id', orderId)
    .in('visibility', visibilities)
  if (source) builder = builder.eq('source_code', source)
  if (cursor) builder = builder.or(`occurred_at.lt."${cursor.t}",and(occurred_at.eq."${cursor.t}",seq.lt.${cursor.s})`)

  const { data, error } = await builder
    .order('occurred_at', { ascending: false })
    .order('seq', { ascending: false })
    .limit(limit + 1)

  if (error) throw createError({ statusCode: 500, statusMessage: 'Erro ao carregar o histórico' })

  const rows = (data || []) as Array<OsEventRow & { seq: number }>
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor = rows.length > limit && last
    ? Buffer.from(JSON.stringify({ t: last.occurred_at, s: last.seq })).toString('base64url')
    : null

  return { items: page.map(renderOsEvent), nextCursor }
})
