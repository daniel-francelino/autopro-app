import { OS_HISTORY_ORIGIN_HEADER, originForPath } from '../../lib/utils/os-history-sources'

/**
 * Envia a plataforma (web | ios | android) em toda chamada /api para o log de auditoria.
 * Envia também a origem (tela) em `x-origin`, derivada da rota atual, para o histórico da OS
 * (só informativo: o servidor valida contra um catálogo fechado e nunca decide acesso por ela).
 * O código do erro (X-Request-Id) já vem em `error.response.headers` — ver useApiErrorToast.
 */
export default defineNuxtPlugin(() => {
  const router = useRouter()
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
      if (!headers.has(OS_HISTORY_ORIGIN_HEADER)) {
        const origin = originForPath(router.currentRoute.value.path)
        if (origin) headers.set(OS_HISTORY_ORIGIN_HEADER, origin)
      }
      options.headers = headers
    }
  }) as typeof globalThis.$fetch
})
