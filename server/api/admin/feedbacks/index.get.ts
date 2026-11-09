import { z } from 'zod'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireOwner } from '../../../utils/require-owner'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(['bug', 'suggestion', 'improvement', 'praise']).optional(),
  status: z.enum(['submitted', 'in_review', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  search: z.string().optional()
})

export default eventHandler(async (event) => {
  await requireOwner(event)
  const query = getQuery(event)
  const params = querySchema.parse(query)

  const supabase = getSupabaseAdminClient()

  const from = (params.page - 1) * params.pageSize
  const to = from + params.pageSize - 1

  let qb = supabase
    .from('feedbacks')
    .select('*, feedback_attachments(*), feedback_responses(count), feedback_entity_links(*)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (params.type) qb = qb.eq('type', params.type)
  if (params.status) qb = qb.eq('status', params.status)
  if (params.priority) qb = qb.eq('priority', params.priority)
  if (params.search) qb = qb.or(`title.ilike.%${params.search}%,description.ilike.%${params.search}%`)

  const { data, error, count } = await qb

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Falha ao buscar feedbacks', data: error.message })
  }

  // Autor e oficina (feedbacks só guarda user_id).
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const userIds = [...new Set(rows.map(r => r.user_id).filter((v): v is string => typeof v === 'string'))]
  const authors = new Map<string, { display_name: string | null, email: string | null, organization_id: string | null }>()
  const orgNames = new Map<string, string>()
  if (userIds.length) {
    const { data: profiles } = await supabase.from('user_profiles').select('user_id, display_name, email, organization_id').in('user_id', userIds)
    for (const p of profiles ?? []) authors.set(p.user_id as string, p as never)
    const orgIds = [...new Set([...authors.values()].map(a => a.organization_id).filter((v): v is string => !!v))]
    if (orgIds.length) {
      const { data: orgs } = await supabase.from('organizations').select('id, name').in('id', orgIds)
      for (const o of orgs ?? []) orgNames.set(o.id as string, o.name as string)
    }
  }

  return {
    data: rows.map((row) => {
      const author = typeof row.user_id === 'string' ? authors.get(row.user_id) : undefined
      return {
        ...row,
        author_name: author?.display_name ?? null,
        author_email: author?.email ?? null,
        organization_id: author?.organization_id ?? null,
        organization_name: author?.organization_id ? orgNames.get(author.organization_id) ?? null : null
      }
    }),
    total: count ?? 0,
    page: params.page,
    pageSize: params.pageSize
  }
})
