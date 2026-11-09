import { z } from 'zod'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireOwner } from '../../../utils/require-owner'

const bodySchema = z.object({
  status: z.enum(['submitted', 'in_review', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional()
}).refine(d => d.status || d.priority, { message: 'Informe status ou prioridade' })

export default eventHandler(async (event) => {
  await requireOwner(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'ID é obrigatório' })
  }

  const body = await readBody(event)
  const parsed = bodySchema.parse(body)

  const supabase = getSupabaseAdminClient()

  const updates: Record<string, unknown> = {}
  if (parsed.status) updates.status = parsed.status
  if (parsed.priority) updates.priority = parsed.priority

  const { data, error } = await supabase
    .from('feedbacks')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Falha ao atualizar feedback', data: error.message })
  }

  return data
})
