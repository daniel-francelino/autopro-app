import { z } from 'zod'
import { getSupabaseAnonClient } from '../../utils/supabase-anon'
import { setAuthCookies } from '../../utils/auth-cookies'
import { setAuthUserCookie, toAuthUser } from '../../utils/auth-user'
import { trackServerEvent } from '../../utils/analytics/record'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  remember: z.boolean().optional().default(true)
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

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password
  })

  if (error || !data.session || !data.user) {
    throw createError({
      statusCode: 401,
      statusMessage: error?.message || 'Invalid credentials'
    })
  }

  setAuthUserCookie(event, {
    user: toAuthUser(data.user),
    expiresAt: data.session.expires_at ?? null,
    syncedAt: Date.now()
  }, { persistent: parsed.data.remember })

  setAuthCookies(event, data.session, { persistent: parsed.data.remember })

  // Telemetria: login concluído (só nome do evento; o usuário vira HMAC no servidor).
  trackServerEvent(event, 'login_completed', { userId: data.user.id })

  return {
    user: toAuthUser(data.user),
    session: { expiresAt: data.session.expires_at ?? null }
  }
})
