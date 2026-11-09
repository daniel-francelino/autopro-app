import { analyticsArea } from '../../lib/analytics/areas'
import type { ClientEvent, Platform } from '../../lib/analytics/events'

// Telemetria própria: fila em lote → POST /api/metrics/track.
// Sem cookie e sem ID persistente de visitante: a sessão vive em sessionStorage.
// Nunca envia texto livre, e-mail, nome ou rota crua — só nomes de evento e rótulos de área.

interface QueuedEvent {
  event: ClientEvent
  area: string
  at: number
  durationMs?: number
  step?: number
  attribution?: unknown
}

const FLUSH_MS = 10_000
const MAX_BATCH = 20
const ENDPOINT = '/api/metrics/track'

let enabled = false
let sessionId = ''
let platform: Platform = 'web'
let currentPath = '/'
const queue: QueuedEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null

export function configureAnalytics(options: { enabled: boolean, sessionId: string, platform: Platform }) {
  enabled = options.enabled
  sessionId = options.sessionId
  platform = options.platform
}

export function setAnalyticsPath(path: string) {
  currentPath = path
}

export function flushAnalytics() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!enabled || !queue.length) return

  const events = queue.splice(0, 25)
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, platform, events }),
      keepalive: true,
      credentials: 'same-origin'
    }).catch(() => {})
  } catch {
    // telemetria nunca interfere no uso
  }
  if (queue.length) flushAnalytics()
}

export function trackEvent(
  event: ClientEvent,
  extra: { durationMs?: number, step?: number, attribution?: unknown } = {}
) {
  if (!enabled || !sessionId) return
  queue.push({ event, area: analyticsArea(currentPath), at: Date.now(), ...extra })
  if (queue.length >= MAX_BATCH) flushAnalytics()
  else if (!timer) timer = setTimeout(flushAnalytics, FLUSH_MS)
}

/** Uso nos componentes: `const { track } = useAnalytics()`. Sem efeito quando a telemetria está desligada. */
export function useAnalytics() {
  return { track: trackEvent }
}
