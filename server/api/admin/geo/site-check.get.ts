import { requireOwner } from '../../../utils/require-owner'
import { analyzeHtml, analyzeLlms, analyzeRobots, analyzeSitemap, summarize } from '../../../utils/site-check'

/**
 * GET /api/admin/geo/site-check
 * Verificação técnica de SEO/GEO do site público: robots, sitemap, llms.txt e a página inicial.
 * Não depende de nenhum registro manual.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const config = useRuntimeConfig()
  const siteUrl = String((config.public as { siteUrl?: string } | undefined)?.siteUrl || '').replace(/\/$/, '')
  if (!siteUrl) {
    throw createError({ statusCode: 503, statusMessage: 'NUXT_PUBLIC_SITE_URL não configurada.' })
  }

  async function read(path: string): Promise<string | null> {
    try {
      return await $fetch<string>(`${siteUrl}${path}`, { responseType: 'text', timeout: 8000, headers: { 'user-agent': 'AutoProSiteCheck/1.0' } })
    } catch {
      return null
    }
  }

  const [home, robots, sitemap, llms] = await Promise.all([read('/'), read('/robots.txt'), read('/sitemap.xml'), read('/llms.txt')])

  const items = [
    ...(home === null
      ? [{ key: 'home', group: 'seo' as const, label: 'Página inicial', status: 'error' as const, detail: 'Não foi possível carregar a página inicial.' }]
      : analyzeHtml(home)),
    ...analyzeRobots(robots),
    analyzeSitemap(sitemap),
    analyzeLlms(llms)
  ]

  return { site_url: siteUrl, checked_at: new Date().toISOString(), summary: summarize(items), items }
})
