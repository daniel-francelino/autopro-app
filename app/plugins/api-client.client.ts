/**
 * Envia a plataforma (web | ios | android) em toda chamada /api para o log de auditoria.
 * O código do erro (X-Request-Id) já vem em `error.response.headers` — ver useApiErrorToast.
 */
export default defineNuxtPlugin(() => {
  const capacitor = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  const detected = capacitor?.getPlatform?.()
  const platform = detected === 'ios' || detected === 'android' ? detected : 'web'

  const originalFetch = globalThis.$fetch
  globalThis.$fetch = originalFetch.create({
    onRequest({ request, options }) {
      const url = typeof request === 'string' ? request : (request as Request).url
      if (!url.startsWith('/api/')) return
      const headers = new Headers(options.headers as HeadersInit | undefined)
      if (!headers.has('x-client-platform')) headers.set('x-client-platform', platform)
      options.headers = headers
    }
  }) as typeof globalThis.$fetch
})
