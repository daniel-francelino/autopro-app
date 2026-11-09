// Verificação técnica de SEO/GEO do próprio site (sem depender de ninguém responder nada).
// Funções puras: recebem o texto já baixado e devolvem itens de checklist.

export type CheckStatus = 'ok' | 'warning' | 'error'
export type SiteCheckItem = { key: string, group: 'seo' | 'geo', label: string, status: CheckStatus, detail: string }

export const AI_BOTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'PerplexityBot', 'Google-Extended']

function meta(html: string, attr: 'name' | 'property', value: string): string | null {
  const re = new RegExp(`<meta[^>]+${attr}=["']${value}["'][^>]*>`, 'i')
  const tag = html.match(re)?.[0]
  if (!tag) return null
  return tag.match(/content=["']([^"']*)["']/i)?.[1] ?? null
}

export function analyzeHtml(html: string): SiteCheckItem[] {
  const items: SiteCheckItem[] = []
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? ''
  const description = meta(html, 'name', 'description') ?? ''
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1] ?? null
  const ogImage = meta(html, 'property', 'og:image')
  const lang = html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] ?? null
  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length
  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1] ?? '')
  const jsonLdTypes = new Set<string>()
  for (const block of jsonLd) {
    for (const m of block.matchAll(/"@type"\s*:\s*"([^"]+)"/g)) jsonLdTypes.add(m[1]!)
  }

  items.push({
    key: 'title', group: 'seo', label: 'Título da página',
    status: !title ? 'error' : title.length < 20 || title.length > 70 ? 'warning' : 'ok',
    detail: title ? `${title.length} caracteres: “${title}”` : 'Sem <title>.'
  })
  items.push({
    key: 'description', group: 'seo', label: 'Meta description',
    status: !description ? 'error' : description.length < 70 || description.length > 170 ? 'warning' : 'ok',
    detail: description ? `${description.length} caracteres (ideal: 70–170).` : 'Sem meta description.'
  })
  items.push({ key: 'canonical', group: 'seo', label: 'URL canônica', status: canonical ? 'ok' : 'warning', detail: canonical ?? 'Sem <link rel="canonical">.' })
  items.push({ key: 'og-image', group: 'seo', label: 'Imagem de compartilhamento (og:image)', status: ogImage ? 'ok' : 'warning', detail: ogImage ?? 'Sem og:image.' })
  items.push({ key: 'lang', group: 'seo', label: 'Idioma da página', status: lang?.toLowerCase().startsWith('pt') ? 'ok' : 'warning', detail: lang ? `lang="${lang}"` : 'Sem atributo lang.' })
  items.push({ key: 'h1', group: 'seo', label: 'Um único H1', status: h1Count === 1 ? 'ok' : 'warning', detail: `${h1Count} H1 na página inicial.` })
  items.push({
    key: 'jsonld', group: 'geo', label: 'Dados estruturados (JSON-LD)',
    status: jsonLdTypes.size ? 'ok' : 'error',
    detail: jsonLdTypes.size ? `Tipos: ${[...jsonLdTypes].join(', ')}.` : 'Nenhum JSON-LD: IAs e buscadores têm menos contexto sobre o produto.'
  })
  const hasFaq = jsonLdTypes.has('FAQPage')
  items.push({ key: 'faq', group: 'geo', label: 'FAQ estruturado (FAQPage)', status: hasFaq ? 'ok' : 'warning', detail: hasFaq ? 'FAQPage presente.' : 'Sem FAQPage na página inicial (pode estar em /perguntas-frequentes).' })
  return items
}

export function analyzeRobots(text: string | null): SiteCheckItem[] {
  if (text === null) {
    return [{ key: 'robots', group: 'seo', label: 'robots.txt', status: 'error', detail: 'Não encontrado.' }]
  }
  const hasSitemap = /^\s*sitemap:/im.test(text)
  const blocksAll = /user-agent:\s*\*\s*[\r\n]+(?:\s*(?:allow|disallow):.*[\r\n]+)*?\s*disallow:\s*\/\s*$/im.test(text)
  const blockedBots = AI_BOTS.filter((bot) => {
    const block = text.match(new RegExp(`user-agent:\\s*${bot}\\s*[\\r\\n]+((?:\\s*(?:allow|disallow|crawl-delay):.*[\\r\\n]*)+)`, 'i'))?.[1] ?? ''
    return /disallow:\s*\/\s*$/im.test(block)
  })
  return [
    { key: 'robots', group: 'seo', label: 'robots.txt', status: blocksAll ? 'error' : 'ok', detail: blocksAll ? 'Bloqueia o site inteiro (Disallow: /).' : 'Presente e sem bloqueio geral.' },
    { key: 'robots-sitemap', group: 'seo', label: 'Sitemap declarado no robots.txt', status: hasSitemap ? 'ok' : 'warning', detail: hasSitemap ? 'Linha Sitemap: encontrada.' : 'Sem linha Sitemap:.' },
    {
      key: 'ai-bots', group: 'geo', label: 'Robôs de IA permitidos',
      status: blockedBots.length ? 'error' : 'ok',
      detail: blockedBots.length ? `Bloqueados: ${blockedBots.join(', ')}.` : 'Nenhum robô de IA bloqueado.'
    }
  ]
}

export function analyzeSitemap(xml: string | null): SiteCheckItem {
  if (xml === null) return { key: 'sitemap', group: 'seo', label: 'sitemap.xml', status: 'error', detail: 'Não encontrado.' }
  const urls = (xml.match(/<loc>/gi) ?? []).length
  return { key: 'sitemap', group: 'seo', label: 'sitemap.xml', status: urls > 0 ? 'ok' : 'warning', detail: urls > 0 ? `${urls} URL(s) listada(s).` : 'Arquivo sem URLs.' }
}

export function analyzeLlms(text: string | null): SiteCheckItem {
  if (text === null) return { key: 'llms', group: 'geo', label: 'llms.txt', status: 'error', detail: 'Não encontrado: IAs não têm um resumo oficial do produto.' }
  const lines = text.split(/\r?\n/).filter(l => l.trim()).length
  return { key: 'llms', group: 'geo', label: 'llms.txt', status: lines >= 5 ? 'ok' : 'warning', detail: `${lines} linha(s) de conteúdo.` }
}

export function summarize(items: SiteCheckItem[]) {
  return {
    ok: items.filter(i => i.status === 'ok').length,
    warning: items.filter(i => i.status === 'warning').length,
    error: items.filter(i => i.status === 'error').length,
    total: items.length
  }
}
