import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireOwner } from '../../../utils/require-owner'

export default eventHandler(async (event) => {
  await requireOwner(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'ID é obrigatório' })
  }

  const query = getQuery(event)
  const linkId = query.linkId as string

  if (!linkId) {
    throw createError({ statusCode: 400, statusMessage: 'linkId é obrigatório' })
  }

  const supabase = getSupabaseAdminClient()

  const { error } = await supabase
    .from('feedback_entity_links')
    .delete()
    .eq('id', linkId)
    .eq('feedback_id', id)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Falha ao remover vínculo', data: error.message })
  }

  return { success: true }
})
