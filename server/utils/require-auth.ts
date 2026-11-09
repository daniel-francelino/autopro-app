import { getSupabaseAnonClient } from './supabase-anon'
import { getAccessTokenFromCookies, getRefreshTokenFromCookies, setAuthCookies } from './auth-cookies'
import { getAuthUserCookie, setAuthUserCookie, toAuthUser } from './auth-user'
import { isInvalidAuthError, resolveSessionExpiresAt } from './auth-session'
import type { H3Event } from 'h3'
import { setAuditContext } from './audit/context'

async function authenticate(event: H3Event) {
  const supabase = getSupabaseAnonClient()
  const accessToken = getAccessTokenFromCookies(event)
  const refreshToken = getRefreshTokenFromCookies(event)
  const existingUserCookie = getAuthUserCookie(event)
  let accessTokenError: { status?: unknown } | null = null

  if (accessToken) {
    const { data, error } = await supabase.auth.getUser(accessToken)
    if (!error && data.user) {
      const expiresAt = resolveSessionExpiresAt({
        accessToken,
        existingExpiresAt: existingUserCookie?.expiresAt
      })

      setAuthUserCookie(event, {
        user: toAuthUser(data.user),
        expiresAt,
        syncedAt: Date.now()
      })
      return toAuthUser(data.user)
    }

    accessTokenError = error
  }

  if (refreshToken) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession({
      refresh_token: refreshToken
    })

    if (refreshError && !isInvalidAuthError(refreshError)) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Auth service unavailable'
      })
    }

    if (!refreshError && refreshed.session) {
      const expiresAt = resolveSessionExpiresAt({
        accessToken: refreshed.session.access_token,
        sessionExpiresAt: refreshed.session.expires_at ?? null
      })

      const { data: userData, error: userError } = await supabase.auth.getUser(refreshed.session.access_token)
      if (userError && !isInvalidAuthError(userError)) {
        throw createError({
          statusCode: 503,
          statusMessage: 'Auth service unavailable'
        })
      }

      if (!userError && userData.user) {
        setAuthUserCookie(event, {
          user: toAuthUser(userData.user),
          expiresAt,
          syncedAt: Date.now()
        })
        setAuthCookies(event, refreshed.session)
        return toAuthUser(userData.user)
      }
    }
  }

  if (accessToken && accessTokenError && !isInvalidAuthError(accessTokenError)) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Auth service unavailable'
    })
  }

  throw createError({
    statusCode: 401,
    statusMessage: 'Unauthorized'
  })
}

export async function requireAuthUser(event: H3Event) {
  const user = await authenticate(event)
  // Auditoria: todo handler que autentica passa a ter o autor registrado, sem alteração.
  setAuditContext(event, { userId: user.id, email: user.email })
  return user
}
