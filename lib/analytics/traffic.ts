// Classifica o tráfego (pessoa × robô) a partir do User-Agent.
// O User-Agent é lido SÓ para classificar e NUNCA é gravado. Robô disfarçado cai em "human".

export type TrafficKind
  = | 'human'
    | 'ai_crawler'
    | 'search_bot'
    | 'social_preview'
    | 'headless'
    | 'script'
    | 'other_bot'

export type BotPurpose
  = | 'ai_training'
    | 'ai_search'
    | 'ai_user'
    | 'search_index'
    | 'seo_tool'
    | 'preview'
    | 'testing'
    | 'script'
    | 'unknown'

export interface TrafficInfo {
  traffic: TrafficKind
  bot: string | null
  purpose: BotPurpose | null
}

interface BotRule {
  test: RegExp
  kind: TrafficKind
  name: string
  purpose: BotPurpose
}

// Ordem importa: regras específicas antes das genéricas.
const BOTS: BotRule[] = [
  // IA
  { test: /OAI-SearchBot/i, kind: 'ai_crawler', name: 'OAI-SearchBot', purpose: 'ai_search' },
  { test: /ChatGPT-User/i, kind: 'ai_crawler', name: 'ChatGPT-User', purpose: 'ai_user' },
  { test: /GPTBot/i, kind: 'ai_crawler', name: 'GPTBot', purpose: 'ai_training' },
  { test: /Claude-SearchBot/i, kind: 'ai_crawler', name: 'Claude-SearchBot', purpose: 'ai_search' },
  { test: /Claude-User/i, kind: 'ai_crawler', name: 'Claude-User', purpose: 'ai_user' },
  { test: /ClaudeBot|anthropic-ai/i, kind: 'ai_crawler', name: 'ClaudeBot', purpose: 'ai_training' },
  { test: /Perplexity-User/i, kind: 'ai_crawler', name: 'Perplexity-User', purpose: 'ai_user' },
  { test: /PerplexityBot/i, kind: 'ai_crawler', name: 'PerplexityBot', purpose: 'ai_search' },
  { test: /DuckAssistBot/i, kind: 'ai_crawler', name: 'DuckAssistBot', purpose: 'ai_search' },
  { test: /MistralAI-User/i, kind: 'ai_crawler', name: 'MistralAI-User', purpose: 'ai_user' },
  { test: /meta-externalagent/i, kind: 'ai_crawler', name: 'Meta-ExternalAgent', purpose: 'ai_training' },
  { test: /meta-externalfetcher/i, kind: 'ai_crawler', name: 'Meta-ExternalFetcher', purpose: 'ai_user' },
  { test: /Applebot-Extended/i, kind: 'ai_crawler', name: 'Applebot-Extended', purpose: 'ai_training' },
  { test: /Bytespider/i, kind: 'ai_crawler', name: 'Bytespider', purpose: 'ai_training' },
  { test: /CCBot/i, kind: 'ai_crawler', name: 'CCBot', purpose: 'ai_training' },
  { test: /cohere-ai/i, kind: 'ai_crawler', name: 'cohere-ai', purpose: 'ai_training' },
  { test: /Diffbot/i, kind: 'ai_crawler', name: 'Diffbot', purpose: 'ai_training' },
  { test: /YouBot/i, kind: 'ai_crawler', name: 'YouBot', purpose: 'ai_search' },
  // Buscadores
  { test: /Googlebot|Google-InspectionTool|GoogleOther|AdsBot-Google/i, kind: 'search_bot', name: 'Googlebot', purpose: 'search_index' },
  { test: /bingbot|BingPreview/i, kind: 'search_bot', name: 'Bingbot', purpose: 'search_index' },
  { test: /Applebot/i, kind: 'search_bot', name: 'Applebot', purpose: 'search_index' },
  { test: /DuckDuckBot/i, kind: 'search_bot', name: 'DuckDuckBot', purpose: 'search_index' },
  { test: /YandexBot|YandexImages/i, kind: 'search_bot', name: 'YandexBot', purpose: 'search_index' },
  { test: /Baiduspider/i, kind: 'search_bot', name: 'Baiduspider', purpose: 'search_index' },
  { test: /PetalBot/i, kind: 'search_bot', name: 'PetalBot', purpose: 'search_index' },
  { test: /Slurp/i, kind: 'search_bot', name: 'Yahoo Slurp', purpose: 'search_index' },
  { test: /SeznamBot/i, kind: 'search_bot', name: 'SeznamBot', purpose: 'search_index' },
  { test: /Sogou/i, kind: 'search_bot', name: 'Sogou', purpose: 'search_index' },
  // Ferramentas de SEO
  { test: /AhrefsBot/i, kind: 'other_bot', name: 'AhrefsBot', purpose: 'seo_tool' },
  { test: /SemrushBot/i, kind: 'other_bot', name: 'SemrushBot', purpose: 'seo_tool' },
  { test: /MJ12bot/i, kind: 'other_bot', name: 'MJ12bot', purpose: 'seo_tool' },
  { test: /DotBot/i, kind: 'other_bot', name: 'DotBot', purpose: 'seo_tool' },
  { test: /Screaming Frog/i, kind: 'other_bot', name: 'Screaming Frog', purpose: 'seo_tool' },
  // Prévia de links
  { test: /facebookexternalhit|Facebot/i, kind: 'social_preview', name: 'Facebook', purpose: 'preview' },
  { test: /Twitterbot/i, kind: 'social_preview', name: 'Twitterbot', purpose: 'preview' },
  { test: /LinkedInBot/i, kind: 'social_preview', name: 'LinkedInBot', purpose: 'preview' },
  { test: /WhatsApp\//i, kind: 'social_preview', name: 'WhatsApp', purpose: 'preview' },
  { test: /Slackbot|Slack-ImgProxy/i, kind: 'social_preview', name: 'Slackbot', purpose: 'preview' },
  { test: /TelegramBot/i, kind: 'social_preview', name: 'TelegramBot', purpose: 'preview' },
  { test: /Discordbot/i, kind: 'social_preview', name: 'Discordbot', purpose: 'preview' },
  { test: /Pinterestbot/i, kind: 'social_preview', name: 'Pinterest', purpose: 'preview' },
  { test: /SkypeUriPreview/i, kind: 'social_preview', name: 'Skype', purpose: 'preview' },
  // Navegadores sem tela / testes
  { test: /HeadlessChrome/i, kind: 'headless', name: 'HeadlessChrome', purpose: 'testing' },
  { test: /Chrome-Lighthouse|Lighthouse/i, kind: 'headless', name: 'Lighthouse', purpose: 'testing' },
  { test: /PhantomJS/i, kind: 'headless', name: 'PhantomJS', purpose: 'testing' },
  { test: /Puppeteer|Playwright/i, kind: 'headless', name: 'Puppeteer/Playwright', purpose: 'testing' },
  // Scripts
  { test: /^curl\//i, kind: 'script', name: 'curl', purpose: 'script' },
  { test: /^Wget\//i, kind: 'script', name: 'Wget', purpose: 'script' },
  { test: /python-requests|python-urllib|aiohttp|httpx/i, kind: 'script', name: 'Python', purpose: 'script' },
  { test: /^Go-http-client/i, kind: 'script', name: 'Go-http-client', purpose: 'script' },
  { test: /axios\/|node-fetch|undici/i, kind: 'script', name: 'Node', purpose: 'script' },
  { test: /okhttp/i, kind: 'script', name: 'okhttp', purpose: 'script' },
  { test: /PostmanRuntime|insomnia|HTTPie/i, kind: 'script', name: 'Cliente HTTP', purpose: 'script' },
  { test: /^Java\/|libwww-perl|Apache-HttpClient/i, kind: 'script', name: 'Java/Perl', purpose: 'script' }
]

const GENERIC_BOT = /bot\b|bot\/|crawler|spider|crawl|scrapy|fetcher/i

export function classifyTraffic(userAgent: string | null | undefined): TrafficInfo {
  const ua = (userAgent ?? '').trim()
  if (!ua) return { traffic: 'script', bot: null, purpose: 'unknown' }

  for (const rule of BOTS) {
    if (rule.test.test(ua)) return { traffic: rule.kind, bot: rule.name, purpose: rule.purpose }
  }

  if (GENERIC_BOT.test(ua)) return { traffic: 'other_bot', bot: null, purpose: 'unknown' }

  return { traffic: 'human', bot: null, purpose: null }
}
