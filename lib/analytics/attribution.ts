// Atribuição de origem: UTM + referrer. Funções puras (cliente e servidor).
// Só guarda utm_source/medium/campaign/content/term saneados e o HOST do referrer
// (nunca a URL completa). "Não prova indicação": o número de IA é um piso, não um total.

export const CHANNELS = ['direct', 'search', 'social', 'ai', 'referral', 'campaign'] as const
export type Channel = (typeof CHANNELS)[number]

export const AI_SOURCES = ['chatgpt', 'claude', 'perplexity', 'copilot', 'gemini'] as const
export type AiSource = (typeof AI_SOURCES)[number]

export interface Touch {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  referrer_host?: string
  channel: Channel
  ai?: AiSource
}

export interface Attribution {
  first?: Touch
  last?: Touch
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
const MAX_LEN = 100

// Hostname EXATO (nunca substring): "chatgpt.com.exemplo.com" não é IA.
const AI_HOSTS: Record<string, AiSource> = {
  'chatgpt.com': 'chatgpt',
  'www.chatgpt.com': 'chatgpt',
  'chat.openai.com': 'chatgpt',
  'claude.ai': 'claude',
  'www.claude.ai': 'claude',
  'perplexity.ai': 'perplexity',
  'www.perplexity.ai': 'perplexity',
  'copilot.microsoft.com': 'copilot',
  'gemini.google.com': 'gemini'
}

const SEARCH_HOSTS = new Set([
  'google.com', 'www.google.com', 'google.com.br', 'www.google.com.br',
  'bing.com', 'www.bing.com', 'duckduckgo.com', 'www.duckduckgo.com',
  'search.yahoo.com', 'br.search.yahoo.com', 'ecosia.org', 'www.ecosia.org',
  'search.brave.com', 'yandex.com', 'yandex.ru'
])

const SOCIAL_HOSTS = new Set([
  'facebook.com', 'www.facebook.com', 'm.facebook.com', 'l.facebook.com', 'lm.facebook.com',
  'instagram.com', 'www.instagram.com', 'l.instagram.com',
  't.co', 'twitter.com', 'x.com',
  'linkedin.com', 'www.linkedin.com', 'lnkd.in',
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'web.whatsapp.com', 'wa.me', 'api.whatsapp.com',
  'tiktok.com', 'www.tiktok.com', 'pinterest.com', 'www.pinterest.com',
  'web.telegram.org', 't.me'
])

/** Texto curto e seguro: ≤ 100 caracteres, sem "@" (e-mail) nem "://" (URL). */
export function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim().slice(0, MAX_LEN)
  if (!text || text.includes('@') || text.includes('://')) return undefined
  return text
}

/** Extrai e normaliza o host de um referrer (ou null). */
export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null
  try {
    return new URL(referrer).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/** Define o canal. `ownHosts` = domínios próprios (navegação interna não é origem). */
export function channelFromTouch(
  utmMedium: string | undefined,
  host: string | null,
  ownHosts: readonly string[] = []
): { channel: Channel, ai?: AiSource } {
  if (utmMedium) return { channel: 'campaign' }
  if (!host || ownHosts.includes(host)) return { channel: 'direct' }
  const ai = AI_HOSTS[host]
  if (ai) return { channel: 'ai', ai }
  if (SEARCH_HOSTS.has(host)) return { channel: 'search' }
  if (SOCIAL_HOSTS.has(host)) return { channel: 'social' }
  return { channel: 'referral' }
}

/** Monta um toque a partir da query string e do referrer da página. */
export function buildTouch(
  search: string | URLSearchParams,
  referrer: string | null | undefined,
  ownHosts: readonly string[] = []
): Touch {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const touch: Touch = { channel: 'direct' }

  for (const key of UTM_KEYS) {
    const value = cleanText(params.get(key))
    if (value) touch[key] = value
  }

  const host = referrerHost(referrer)
  const own = host && ownHosts.includes(host)
  if (host && !own) touch.referrer_host = host.slice(0, MAX_LEN)

  const { channel, ai } = channelFromTouch(touch.utm_medium, own ? null : host, ownHosts)
  touch.channel = channel
  if (ai) touch.ai = ai
  return touch
}

export function hasSignal(touch: Touch | undefined): boolean {
  return !!touch && (touch.channel !== 'direct' || UTM_KEYS.some(key => touch[key]))
}

const CHANNEL_SET: ReadonlySet<string> = new Set(CHANNELS)
const AI_SET: ReadonlySet<string> = new Set(AI_SOURCES)

function sanitizeTouch(raw: unknown): Touch | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const input = raw as Record<string, unknown>
  const channel = typeof input.channel === 'string' && CHANNEL_SET.has(input.channel)
    ? (input.channel as Channel)
    : 'direct'
  const touch: Touch = { channel }

  for (const key of UTM_KEYS) {
    const value = cleanText(input[key])
    if (value) touch[key] = value
  }

  const host = cleanText(input.referrer_host)
  if (host) touch.referrer_host = host.toLowerCase()
  if (typeof input.ai === 'string' && AI_SET.has(input.ai)) touch.ai = input.ai as AiSource
  return touch
}

/** Saneamento no servidor: só chaves permitidas, valores curtos, listas fechadas. */
export function sanitizeAttribution(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const first = sanitizeTouch(input.first)
  const last = sanitizeTouch(input.last)
  if (!first && !last) return null
  return { ...(first ? { first } : {}), ...(last ? { last } : {}) }
}
