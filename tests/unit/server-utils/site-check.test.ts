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

describe('site-check: home page', () => {
  it('complete page → all ok', () => {
    expect(analyzeHtml(goodHtml).every(i => i.status === 'ok')).toBe(true)
  })
  it('empty page → failures and warnings on the right items', () => {
    const items = analyzeHtml('<html><body></body></html>')
    expect(status(items, 'title')).toBe('error')
    expect(status(items, 'description')).toBe('error')
    expect(status(items, 'jsonld')).toBe('error')
    expect(status(items, 'canonical')).toBe('warning')
    expect(status(items, 'h1')).toBe('warning')
  })
  it('two H1 → warning; short title → warning', () => {
    const items = analyzeHtml('<html lang="pt-BR"><title>Oi</title><h1>a</h1><h1>b</h1></html>')
    expect(status(items, 'h1')).toBe('warning')
    expect(status(items, 'title')).toBe('warning')
  })
})

describe('site-check: robots, sitemap and llms', () => {
  it('missing robots → error', () => {
    expect(analyzeRobots(null)[0]!.status).toBe('error')
  })
  it('robots allowed with sitemap → ok everywhere', () => {
    const items = analyzeRobots('User-agent: *\nAllow: /\nSitemap: https://x/sitemap.xml\n')
    expect(items.every(i => i.status === 'ok')).toBe(true)
  })
  it('Disallow: / for everyone → error', () => {
    expect(analyzeRobots('User-agent: *\nDisallow: /\n')[0]!.status).toBe('error')
  })
  it('blocked AI bot is pointed out by name', () => {
    const items = analyzeRobots('User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n')
    const bots = items.find(i => i.key === 'ai-bots')!
    expect(bots.status).toBe('error')
    expect(bots.detail).toContain('GPTBot')
  })
  it('sitemap: missing → error, empty → warning, with URLs → ok', () => {
    expect(analyzeSitemap(null).status).toBe('error')
    expect(analyzeSitemap('<urlset></urlset>').status).toBe('warning')
    expect(analyzeSitemap('<urlset><url><loc>a</loc></url><url><loc>b</loc></url></urlset>').detail).toContain('2 URL')
  })
  it('llms.txt: missing → error, short → warning, complete → ok', () => {
    expect(analyzeLlms(null).status).toBe('error')
    expect(analyzeLlms('# AutoPro').status).toBe('warning')
    expect(analyzeLlms('# AutoPro\n> a\n- b\n- c\n- d\n').status).toBe('ok')
  })
  it('summarize counts by status', () => {
    expect(summarize([{ key: 'a', group: 'seo', label: '', status: 'ok', detail: '' }, { key: 'b', group: 'geo', label: '', status: 'error', detail: '' }])).toEqual({ ok: 1, warning: 0, error: 1, total: 2 })
  })
})
