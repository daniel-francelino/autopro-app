import { getSupabaseAdminClient } from './supabase'

// ─── Constants ────────────────────────────────────────────────────────────────

export const NUVEM_FISCAL_OWNER_EMAIL = process.env.NUVEMFISCAL_OWNER_EMAIL || 'beenkoficial@gmail.com'

const RENEWAL_MARGIN_MS = 5 * 60 * 1000
const DEFAULT_MAX_BODY_CHARS = 50_000

function truncate(value: string, maxChars: number) {
  if (!value) return value
  if (value.length <= maxChars) return value
  return value.slice(0, maxChars) + `\n...TRUNCATED (${value.length - maxChars} chars)`
}

function redactHeaders(headers: Record<string, string>) {
  const redacted: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (lower === 'authorization' || lower === 'cookie' || lower === 'set-cookie') {
      redacted[key] = '[REDACTED]'
      continue
    }
    redacted[key] = value
  }
  return redacted
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function sanitizeSecrets(value: unknown): unknown {
  const secretKeys = new Set(['authorization', 'token', 'api_token', 'apikey', 'api_key', 'password', 'senha', 'certificado', 'certificate', 'private_key', 'client_secret'])
  if (Array.isArray(value)) return value.map(sanitizeSecrets)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = secretKeys.has(k.toLowerCase()) ? '[REDACTED]' : sanitizeSecrets(v)
    }
    return out
  }
  return value
}

function inferIntegrationTypeFromUrl(url: string) {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    return parts[0]
  } catch { return undefined }
}

export async function resolveOrganizationIdByEmail(email: string) {
  if (!email) return undefined
  try {
    const supabase = getSupabaseAdminClient()
    const { data } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle()
    return data?.organization_id
  } catch { return undefined }
}

export async function monitoredNuvemFiscalFetch(options: {
  authUserEmail: string
  functionName: string
  url: string
  init: RequestInit
  captureResponseBody?: 'auto' | 'always' | 'never'
  maxResponseBodyChars?: number
  integrationType?: string
  organizationId?: string
}) {
  const startedAt = Date.now()
  const {
    authUserEmail, functionName, url, init,
    captureResponseBody = 'auto',
    maxResponseBodyChars = DEFAULT_MAX_BODY_CHARS,
    integrationType,
    organizationId
  } = options

  let response: Response | undefined
  let fetchError: unknown

  try {
    response = await fetch(url, init)
  } catch (error) {
    fetchError = error
  }

  const durationMs = Date.now() - startedAt
  const requestHeaders = redactHeaders(Object.fromEntries(Object.entries(init.headers || {})))

  let requestBodySafe: unknown = null
  if (init.body) {
    try {
      const raw = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
      const parsed = safeJsonParse(raw)
      requestBodySafe = sanitizeSecrets(parsed || raw)
    } catch { /* ignore */ }
  }

  let responseBodyRaw: string | null = null
  let responseBodySafe: unknown = null

  if (response && !fetchError) {
    const cloned = response.clone()
    try {
      responseBodyRaw = await cloned.text()
      if (captureResponseBody === 'always' || (captureResponseBody === 'auto' && !response.ok)) {
        const parsed = safeJsonParse(responseBodyRaw)
        responseBodySafe = sanitizeSecrets(parsed || responseBodyRaw)
      }
    } catch { /* ignore */ }
  }

  const logEntry = {
    function_name: functionName,
    user_email: authUserEmail,
    organization_id: organizationId || null,
    integration_type: integrationType || inferIntegrationTypeFromUrl(url),
    request_method: String(init.method || 'GET').toUpperCase(),
    request_url: url,
    request_headers: requestHeaders,
    request_body: requestBodySafe ? truncate(JSON.stringify(requestBodySafe), maxResponseBodyChars) : null,
    response_status: response?.status || null,
    response_body: responseBodySafe ? truncate(JSON.stringify(responseBodySafe), maxResponseBodyChars) : null,
    duration_ms: durationMs,
    error_message: fetchError ? String((fetchError as { message?: unknown } | null)?.message || fetchError) : null,
    created_at: new Date().toISOString()
  }

  try {
    const supabase = getSupabaseAdminClient()
    await supabase.from('fiscal_integration_logs').insert(logEntry)
  } catch { /* ignore logging failures */ }

  if (fetchError) throw fetchError
  return { response: response!, responseBodyRaw }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'true') return true
    if (v === 'false') return false
  }
  return fallback
}

export function sanitizeCpfCnpj(value: unknown): string {
  return String(value || '').replace(/\D/g, '')
}

export function extractFilename(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) return fallback
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1])
  const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
  if (basicMatch?.[1]) return basicMatch[1]
  return fallback
}

// ─── Token Management ────────────────────────────────────────────────────────

export async function getNuvemFiscalApiToken(): Promise<string> {
  const supabase = getSupabaseAdminClient()

  const { data: cached } = await supabase
    .from('oauth_tokens')
    .select('id, access_token, expires_at')
    .eq('provider', 'nuvemfiscal')
    .maybeSingle()

  if (cached && (Date.now() + RENEWAL_MARGIN_MS < new Date(cached.expires_at).getTime())) {
    return cached.access_token
  }

  const authUrl = process.env.NUVEMFISCAL_AUTH_URL || 'https://auth.nuvemfiscal.com.br/oauth/token'
  const clientId = process.env.NUVEMFISCAL_CLIENT_ID || ''
  const clientSecret = process.env.NUVEMFISCAL_CLIENT_SECRET || ''
  const scope = process.env.NUVEMFISCAL_SCOPE || ''

  if (!clientId || !clientSecret) {
    throw new Error('NUVEMFISCAL_CLIENT_ID ou NUVEMFISCAL_CLIENT_SECRET não configurados')
  }

  const tokenBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope
  })

  const tokenResponse = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString()
  })

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text()
    throw new Error(`Falha ao obter token OAuth2 da Nuvem Fiscal: ${errText}`)
  }

  const tokenData = await tokenResponse.json()
  const apiToken = tokenData.access_token as string
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

  const payload = {
    provider: 'nuvemfiscal',
    access_token: apiToken,
    token_type: (tokenData.token_type as string) ?? 'Bearer',
    expires_in: tokenData.expires_in as number,
    expires_at: expiresAt,
    scope: (tokenData.scope as string) ?? scope
  }

  if (cached?.id) {
    await supabase.from('oauth_tokens').update(payload).eq('id', cached.id)
  } else {
    await supabase.from('oauth_tokens').insert(payload)
  }

  return apiToken
}

// ─── Company Document Resolver ───────────────────────────────────────────────

export async function resolveCompanyDocument(userId: string): Promise<string | null> {
  const supabase = getSupabaseAdminClient()

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', userId)
    .maybeSingle()

  if (!profile?.organization_id) return null

  const { data: org } = await supabase
    .from('organizations')
    .select('cpf_cnpj, cnpj, document')
    .eq('id', profile.organization_id)
    .maybeSingle()

  if (org) {
    const doc = sanitizeCpfCnpj(org.cpf_cnpj || org.cnpj || org.document)
    if (doc) return doc
  }

  return null
}

// ─── API Base URL ────────────────────────────────────────────────────────────

export function getNuvemFiscalApiBaseUrl(): string {
  return process.env.NUVEMFISCAL_API_BASE_URL || 'https://api.nuvemfiscal.com.br'
}
