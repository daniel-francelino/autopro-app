import { z } from 'zod'
import { getSupabaseAnonClient } from '../../utils/supabase-anon'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { setAuthCookies } from '../../utils/auth-cookies'
import { setAuthUserCookie, toAuthUser } from '../../utils/auth-user'
import { ensureUserProvisioned } from '../../utils/user-provisioning'
import { trackServerEvent } from '../../utils/analytics/record'

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8)
})

export default eventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid payload',
      data: parsed.error.flatten()
    })
  }

  const supabase = getSupabaseAnonClient()

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        name: parsed.data.name
      }
    }
  })

  if (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error.message
    })
  }

  if (data.user) {
    const supabaseAdmin = getSupabaseAdminClient()

    await ensureUserProvisioned(supabaseAdmin, {
      userId: data.user.id,
      email: data.user.email,
      displayName: parsed.data.name
    })
  }

  // Com confirmação de e-mail ligada, um e-mail já cadastrado devolve um usuário "falso" sem identities:
  // não é cadastro novo e não pode contar.
  if (data.user && data.user.identities?.length !== 0) {
    // Telemetria: cadastro concluído. A atribuição (UTM/origem) vem saneada do corpo, ignorada pelo schema.
    const attribution = (body as { attribution?: unknown } | null)?.attribution
    trackServerEvent(event, 'signup_completed', { userId: data.user.id, attribution })
  }

  if (data.session) {
    if (data.user) {
      setAuthUserCookie(event, {
        user: toAuthUser(data.user),
        expiresAt: data.session.expires_at ?? null,
        syncedAt: Date.now()
      })
    }

    setAuthCookies(event, data.session)
  }

  return {
    user: data.user ? toAuthUser(data.user) : null,
    session: data.session ? { expiresAt: data.session.expires_at ?? null } : null
  }
})
