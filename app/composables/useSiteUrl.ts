/**
 * URL pública do site, sem barra final. Usa `NUXT_PUBLIC_SITE_URL` e, se estiver vazia,
 * o `site.url` do nuxt.config. Falha se ambas estiverem vazias (exceto em dev), para
 * nunca publicar canonical/OG apontando para um domínio errado.
 */
export function useSiteUrl(): string {
  const url = (useRuntimeConfig().public.siteUrl || useSiteConfig().url || '').replace(/\/$/, '')
  if (url) return url
  if (import.meta.dev) return 'http://localhost:3000'
  throw new Error('NUXT_PUBLIC_SITE_URL não está definida.')
}
