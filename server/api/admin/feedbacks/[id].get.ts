import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireOwner } from '../../../utils/require-owner'
import { requireUuidParam } from '../../../utils/admin-params'

/**
 * GET /api/admin/feedbacks/:id
 * Detalhe com anexos, respostas, vínculos, autor e oficina. Só owner.
 */
export default eventHandler(async (event) => {
  await requireOwner(event)
  const id = requireUuidParam(event)
  const supabase = getSupabaseAdminClient()

  const { data: feedback, error } = await supabase
    .from('feedbacks')
    .select('*, feedback_attachments(*), feedback_responses(*), feedback_entity_links(*)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: 'Falha ao buscar feedback' })
  if (!feedback) throw createError({ statusCode: 404, statusMessage: 'Feedback não encontrado' })

  const { data: author } = await supabase
    .from('user_profiles')
    .select('display_name, email, organization_id')
    .eq('user_id', feedback.user_id)
    .maybeSingle()

  let organizationName: string | null = null
  if (author?.organization_id) {
    const { data: org } = await supabase.from('organizations').select('name').eq('id', author.organization_id).maybeSingle()
    organizationName = (org?.name as string | undefined) ?? null
  }

  return {
    ...feedback,
    author_name: author?.display_name ?? null,
    author_email: author?.email ?? null,
    organization_id: author?.organization_id ?? null,
    organization_name: organizationName
  }
})
