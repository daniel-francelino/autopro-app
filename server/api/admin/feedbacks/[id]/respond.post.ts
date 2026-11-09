import { z } from 'zod'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireOwner } from '../../../../utils/require-owner'
import { requireUuidParam } from '../../../../utils/admin-params'

const bodySchema = z.object({ content: z.string().trim().min(1).max(5000) })

/** POST /api/admin/feedbacks/:id/respond  { content } — resposta da plataforma (is_admin = true). */
export default eventHandler(async (event) => {
  const owner = await requireOwner(event)
  const id = requireUuidParam(event)
  const parsed = bodySchema.safeParse(await readBody(event).catch(() => null))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Informe o texto da resposta' })

  const supabase = getSupabaseAdminClient()
  const { data: feedback } = await supabase.from('feedbacks').select('id').eq('id', id).maybeSingle()
  if (!feedback) throw createError({ statusCode: 404, statusMessage: 'Feedback não encontrado' })

  const { data, error } = await supabase
    .from('feedback_responses')
    .insert({ feedback_id: id, user_id: owner.id, content: parsed.data.content, is_admin: true })
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: 'Falha ao responder o feedback' })
  return data
})
