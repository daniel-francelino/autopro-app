import { describe, expect, it } from 'vitest'
import { analyzeHtml, analyzeLlms, analyzeRobots, analyzeSitemap, summarize } from '../../../server/utils/site-check'

const goodHtml = `<html lang="pt-BR"><head>
<title>Sistema para oficina mecânica | AutoPro</title>
<meta name="description" content="Gerencie ordens de serviço, estoque, financeiro e comissões da sua oficina mecânica em um só lugar, com nota fiscal.">
<link rel="canonical" href="https://autopro.example/">
<meta property="og:image" content="https://autopro.example/og.png">
<script type="application/ld+json">{"@type":"SoftwareApplication"}</script>
<script type="application/ld+json">{"@type":"FAQPage"}</script>
</head><body><h1>AutoPro</h1></body></html>`

const status = (items: ReturnType<typeof analyzeHtml>, key: string) => items.find(i => i.key === key)!.status

describe('site-check: página inicial', () => {
  it('página completa → tudo ok', () => {
    expect(analyzeHtml(goodHtml).every(i => i.status === 'ok')).toBe(true)
  })
  it('página vazia → falhas e avisos nos itens certos', () => {
    const items = analyzeHtml('<html><body></body></html>')
    expect(status(items, 'title')).toBe('error')
    expect(status(items, 'description')).toBe('error')
    expect(status(items, 'jsonld')).toBe('error')
    expect(status(items, 'canonical')).toBe('warning')
    expect(status(items, 'h1')).toBe('warning')
  })
  it('dois H1 → aviso; título curto → aviso', () => {
    const items = analyzeHtml('<html lang="pt-BR"><title>Oi</title><h1>a</h1><h1>b</h1></html>')
    expect(status(items, 'h1')).toBe('warning')
    expect(status(items, 'title')).toBe('warning')
  })
})

describe('site-check: robots, sitemap e llms', () => {
  it('robots ausente → erro', () => {
    expect(analyzeRobots(null)[0]!.status).toBe('error')
  })
  it('robots liberado com sitemap → ok em tudo', () => {
    const items = analyzeRobots('User-agent: *\nAllow: /\nSitemap: https://x/sitemap.xml\n')
    expect(items.every(i => i.status === 'ok')).toBe(true)
  })
  it('Disallow: / para todos → erro', () => {
    expect(analyzeRobots('User-agent: *\nDisallow: /\n')[0]!.status).toBe('error')
  })
  it('robô de IA bloqueado é apontado pelo nome', () => {
    const items = analyzeRobots('User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n')
    const bots = items.find(i => i.key === 'ai-bots')!
    expect(bots.status).toBe('error')
    expect(bots.detail).toContain('GPTBot')
  })
  it('sitemap: ausente erro, vazio aviso, com URLs ok', () => {
    expect(analyzeSitemap(null).status).toBe('error')
    expect(analyzeSitemap('<urlset></urlset>').status).toBe('warning')
    expect(analyzeSitemap('<urlset><url><loc>a</loc></url><url><loc>b</loc></url></urlset>').detail).toContain('2 URL')
  })
  it('llms.txt: ausente erro, curto aviso, completo ok', () => {
    expect(analyzeLlms(null).status).toBe('error')
    expect(analyzeLlms('# AutoPro').status).toBe('warning')
    expect(analyzeLlms('# AutoPro\n> a\n- b\n- c\n- d\n').status).toBe('ok')
  })
  it('summarize conta por status', () => {
    expect(summarize([{ key: 'a', group: 'seo', label: '', status: 'ok', detail: '' }, { key: 'b', group: 'geo', label: '', status: 'error', detail: '' }])).toEqual({ ok: 1, warning: 0, error: 1, total: 2 })
  })
})
