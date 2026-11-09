import type { Platform } from '../../lib/analytics/events'

const SESSION_KEY = 'autopro.sid'
const STARTED_KEY = 'autopro.sid.started'
const MAX_ACTIVE_MS = 3_600_000
const ACTIVE_FLUSH_MS = 60_000

function newSessionId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  }
}

function getSession(): { id: string, isNew: boolean } {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY)
    if (existing) return { id: existing, isNew: sessionStorage.getItem(STARTED_KEY) !== '1' }
    const id = newSessionId()
    sessionStorage.setItem(SESSION_KEY, id)
    return { id, isNew: true }
  } catch {
    return { id: newSessionId(), isNew: true }
  }
}

function detectPlatform(): Platform {
  const capacitor = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  const value = capacitor?.getPlatform?.()
  return value === 'ios' || value === 'android' ? value : 'web'
}

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig()
  if (!config.public.analyticsEnabled) return

  const session = getSession()
  const platform = detectPlatform()
  configureAnalytics({ enabled: true, sessionId: session.id, platform })
  setAnalyticsPath(window.location.pathname)

  // Liga as ações do servidor (§5.3) à visita: o servidor lê estes cabeçalhos nas chamadas /api.
  const originalFetch = globalThis.$fetch
  globalThis.$fetch = originalFetch.create({
    onRequest({ request, options }) {
      const url = typeof request === 'string' ? request : (request as Request).url
      if (!url.startsWith('/api/')) return
      const headers = new Headers(options.headers as HeadersInit | undefined)
      headers.set('x-analytics-session', session.id)
      headers.set('x-client-platform', platform)
      options.headers = headers
    }
  }) as typeof globalThis.$fetch

  const router = useRouter()
  const ownHosts = [window.location.hostname]
  try {
    const siteHost = new URL(config.public.siteUrl as string).hostname
    if (siteHost) ownHosts.push(siteHost)
  } catch {
    // siteUrl ausente: só o host atual
  }

  // ── Tempo ativo: só conta com a aba visível; descarrega a cada 60 s e ao esconder ──
  let visibleSince: number | null = document.visibilityState === 'visible' ? Date.now() : null
  let accumulated = 0

  function drain(): number {
    const now = Date.now()
    let total = accumulated
    if (visibleSince !== null) {
      total += now - visibleSince
      visibleSince = now
    }
    accumulated = 0
    return total
  }

  function emitActive() {
    const total = drain()
    if (total >= 1000) trackEvent('active_time', { durationMs: Math.min(total, MAX_ACTIVE_MS) })
  }

  function pause() {
    emitActive()
    visibleSince = null
    flushAnalytics()
  }

  function resume() {
    if (visibleSince === null) visibleSince = Date.now()
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pause()
    else resume()
  })
  window.addEventListener('pagehide', pause)
  setInterval(() => {
    if (visibleSince !== null) {
      emitActive()
      flushAnalytics()
    }
  }, ACTIVE_FLUSH_MS)

  // App nativo: aplicativo indo para segundo plano também pausa o tempo ativo.
  if (platform !== 'web') {
    void import('@capacitor/app').then(({ App }) => {
      void App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) resume()
        else pause()
      })
    }).catch(() => {})
  }

  // ── Navegação ──
  let ready = false
  router.afterEach((to) => {
    setAnalyticsPath(to.path)
    if (ready) trackEvent('page_view')
  })

  nuxtApp.hook('app:mounted', () => {
    setAnalyticsPath(router.currentRoute.value.path)
    if (session.isNew) {
      try {
        sessionStorage.setItem(STARTED_KEY, '1')
      } catch {
        // sem sessionStorage: segue sem marcar
      }
      trackEvent('session_start', { attribution: captureAttribution(ownHosts) })
    }
    trackEvent('page_view')
    ready = true
  })
})
