import { getSupabaseAdminClient } from '../../utils/supabase'

export default eventHandler(async () => {
  const supabase = getSupabaseAdminClient()

  const { error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1
  })

  if (error) {
    // Rota pública: não expõe código nem mensagem internos do Supabase.
    console.error('[health] Supabase indisponível:', error.code, error.message)
    throw createError({ statusCode: 502, statusMessage: 'Failed to reach Supabase' })
  }

  return { ok: true }
})
