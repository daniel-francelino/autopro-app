import { z } from 'zod'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireOwner } from '../../../utils/require-owner'

const bodySchema = z.object({
  entityType: z.string().min(1, 'Tipo de entidade é obrigatório'),
  entityId: z.string().uuid().optional(),
  externalUrl: z.string().url().optional()
}).refine(d => d.entityId || d.externalUrl, {
  message: 'Informe entityId ou externalUrl'
})

export default eventHandler(async (event) => {
  await requireOwner(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'ID é obrigatório' })
  }

  const body = await readBody(event)
  const parsed = bodySchema.parse(body)

  const supabase = getSupabaseAdminClient()

  const { data, error } = await supabase
    .from('feedback_entity_links')
    .insert({
      feedback_id: id,
      entity_type: parsed.entityType,
      entity_id: parsed.entityId ?? null,
      external_url: parsed.externalUrl ?? null
    })
    .select()
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Falha ao vincular entidade', data: error.message })
  }

  return data
})
