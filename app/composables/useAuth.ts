export type AuthUser = {
  id: string
  email: string | null
  user_metadata: Record<string, unknown>
}

type AuthUserCookiePayload = {
  user: AuthUser
  expiresAt: number | null
  syncedAt: number
}

type AuthSession = {
  expiresAt: number | null
}

type AuthState = {
  user: AuthUser | null
  ready: boolean
  loadingCount: number
}

const AUTH_REFRESH_BUFFER_MS = 60_000
const AUTH_COOKIE_REVALIDATE_MS = 5 * 60_000
const AUTH_SERVER_COOKIE_NAMES = ['sb-access-token=', 'sb-refresh-token=']
const pendingFetchMap = new WeakMap<object, Promise<AuthUser | null>>()
const pendingEnsureMap = new WeakMap<object, Promise<void>>()

function isAuthUserCookiePayload(value: unknown): value is AuthUserCookiePayload {
  if (!value || typeof value !== 'object')
    return false

  const payload = value as Partial<AuthUserCookiePayload>
  return Boolean(payload.user && typeof payload.user === 'object')
}

function parseAuthUserCookieValue(raw: unknown): AuthUserCookiePayload | null {
  if (isAuthUserCookiePayload(raw))
    return raw

  if (typeof raw !== 'string')
    return null

  const attempts = [raw]

  try {
    const decoded = decodeURIComponent(raw)
    if (!attempts.includes(decoded))
      attempts.push(decoded)
  } catch {
    // Ignore malformed URI sequences and try other strategies below.
  }

  try {
    const decodedTwice = decodeURIComponent(attempts[attempts.length - 1]!)
    if (!attempts.includes(decodedTwice))
      attempts.push(decodedTwice)
  } catch {
    // Ignore malformed URI sequences and fall back to the successful attempts.
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown
      if (isAuthUserCookiePayload(parsed))
        return parsed
    } catch {
      // Try the next decoding attempt.
    }
  }

  return null
}

export function useAuth() {
  const requestFetch = useRequestFetch()
  const nuxtApp = useNuxtApp()
  const userCookie = useCookie<string | null>('sb-user', {
    default: () => null,
    decode: value => value,
    encode: value => value ?? '',
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  })
  const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

  const state = useState<AuthState>('auth', () => {
    const parsed = parseUserCookie()
    if (!parsed)
      return { user: null, ready: false, loadingCount: 0 }

    return { user: parsed.user, ready: true, loadingCount: 0 }
  })

  const user = computed(() => state.value.user)
  const ready = computed(() => state.value.ready)
  const loading = computed(() => state.value.loadingCount > 0)
  const isAuthenticated = computed(() => Boolean(state.value.user))

  function beginLoading() {
    state.value.loadingCount += 1
  }

  function endLoading() {
    state.value.loadingCount = Math.max(0, state.value.loadingCount - 1)
  }

  function parseUserCookie(): AuthUserCookiePayload | null {
    const raw = userCookie.value
    if (!raw)
      return null

    const parsed = parseAuthUserCookieValue(raw)
    if (parsed)
      return parsed

    return null
  }

  function hasServerSessionCookies(): boolean {
    if (!import.meta.server)
      return false

    const cookieHeader = requestHeaders?.cookie
    if (!cookieHeader)
      return false

    return AUTH_SERVER_COOKIE_NAMES.some(cookieName => cookieHeader.includes(cookieName))
  }

  function setUserCookie(user: AuthUser, session: AuthSession | null = null) {
    const payload: AuthUserCookiePayload = {
      user,
      expiresAt: session?.expiresAt ?? null,
      syncedAt: Date.now()
    }

    userCookie.value = encodeURIComponent(JSON.stringify(payload))
  }

  function clearUserState() {
    state.value.user = null
    userCookie.value = null
  }

  async function fetchUser(): Promise<AuthUser | null> {
    const pendingFetch = pendingFetchMap.get(nuxtApp)
    if (pendingFetch)
      return pendingFetch

    const request = (async () => {
      beginLoading()
      try {
        const response = await requestFetch<{ user: AuthUser | null, session: AuthSession | null }>('/api/auth/me', {
          credentials: 'include',
          headers: requestHeaders
        })

        if (response.user)
          setUserCookie(response.user, response.session)
        else
          clearUserState()

        state.value.user = response.user
        state.value.ready = true
        return response.user
      } catch {
        state.value.user = state.value.user ?? parseUserCookie()?.user ?? null
        state.value.ready = true
        if (!state.value.user)
          userCookie.value = null

        return state.value.user
      } finally {
        endLoading()
        pendingFetchMap.delete(nuxtApp)
      }
    })()

    pendingFetchMap.set(nuxtApp, request)
    return request
  }

  function isTokenExpired(): boolean {
    const parsed = parseUserCookie()
    if (!parsed)
      return true

    if (!parsed.expiresAt) {
      return parsed.syncedAt <= Date.now() - AUTH_COOKIE_REVALIDATE_MS
    }

    return parsed.expiresAt * 1000 <= Date.now() + AUTH_REFRESH_BUFFER_MS
  }

  async function ensureReady() {
    const pendingEnsure = pendingEnsureMap.get(nuxtApp)
    if (pendingEnsure) {
      await pendingEnsure
      return
    }

    const request = (async () => {
      beginLoading()
      try {
        if (state.value.ready) {
          if (!state.value.user && userCookie.value) {
            await fetchUser()
            return
          }

          // Even when ready, proactively refresh if token is near expiry
          if (state.value.user && isTokenExpired()) {
            await fetchUser()
          }
          return
        }

        const parsed = parseUserCookie()
        if (parsed) {
          state.value.user = parsed.user
          state.value.ready = true

          if (isTokenExpired())
            await fetchUser()

          return
        }

        // Avoid unnecessary /api/auth/me calls when there is clearly no session.
        if (!hasServerSessionCookies()) {
          state.value.user = null
          state.value.ready = true
          userCookie.value = null
          return
        }

        await fetchUser()
      } finally {
        endLoading()
      }
    })().finally(() => {
      pendingEnsureMap.delete(nuxtApp)
    })

    pendingEnsureMap.set(nuxtApp, request)
    await request
  }

  async function login(payload: { email: string, password: string, remember?: boolean }) {
    const response = await $fetch<{ user: AuthUser, session: AuthSession }>('/api/auth/login', {
      method: 'POST',
      body: payload,
      credentials: 'include'
    })

    setUserCookie(response.user, response.session)
    state.value.user = response.user
    state.value.ready = true
    return response.user
  }

  async function signup(payload: { name: string, email: string, password: string }) {
    const response = await $fetch<{ user: AuthUser | null, session: { expiresAt: number | null } | null }>('/api/auth/signup', {
      method: 'POST',
      body: { ...payload, attribution: readAttribution() },
      credentials: 'include'
    })

    if (response.session) {
      if (response.user)
        setUserCookie(response.user, response.session)

      state.value.user = response.user
      state.value.ready = true
    }

    return response
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    state.value.user = null
    state.value.ready = true
    userCookie.value = null
  }

  function setGuestReady() {
    state.value.user = null
    state.value.ready = true
    userCookie.value = null
  }

  return {
    user,
    ready,
    loading,
    isAuthenticated,
    fetchUser,
    ensureReady,
    login,
    signup,
    logout,
    setGuestReady
  }
}
