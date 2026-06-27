import { monitoredNuvemFiscalFetch } from './nuvem-fiscal'

// ─── Constants ────────────────────────────────────────────────────────────────

export const FOCUS_NFE_OWNER_EMAIL
  = process.env.FOCUSNFE_OWNER_EMAIL
    || process.env.NUVEMFISCAL_OWNER_EMAIL
    || 'beenkoficial@gmail.com'

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Builds the Basic Auth header for Focus NFe.
 * The API token is used as the username and the password is left empty,
 * as required by RFC 7617: Authorization: Basic base64("TOKEN:")
 */
export function getFocusNfeBasicAuthHeader(): string {
  const token = process.env.FOCUSNFE_API_TOKEN
  if (!token) {
    throw new Error('FOCUSNFE_API_TOKEN não configurado')
  }
  const encoded = Buffer.from(`${token}:`).toString('base64')
  return `Basic ${encoded}`
}

// ─── Base URL ─────────────────────────────────────────────────────────────────

export function getFocusNfeApiBaseUrl(): string {
  return process.env.FOCUSNFE_API_BASE_URL || 'https://api.focusnfe.com.br'
}

// ─── Server-side cache ────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

export function createServerCache<T>(ttlMs: number) {
  const store = new Map<string, CacheEntry<T>>()
  return {
    get(key: string): T | undefined {
      const entry = store.get(key)
      if (!entry) return undefined
      if (Date.now() > entry.expiresAt) {
        store.delete(key)
        return undefined
      }
      return entry.value
    },
    set(key: string, value: T): void {
      store.set(key, { value, expiresAt: Date.now() + ttlMs })
    }
  }
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { monitoredNuvemFiscalFetch as monitoredFocusNfeFetch }

// ─── Subscription cancellation cleanup ───────────────────────────────────────

/**
 * Checks if an organization has a synced company in FocusNFe and, if so,
 * deletes it. Silently logs errors — caller should not fail on this.
 */
export async function deleteFocusNfeCompanyForOrg(organizationId: string): Promise<void> {
  let authHeader: string
  let apiBaseUrl: string
  try {
    authHeader = getFocusNfeBasicAuthHeader()
    apiBaseUrl = getFocusNfeApiBaseUrl()
  } catch {
    // FocusNFe not configured — nothing to do
    return
  }

  const supabase = (await import('./supabase')).getSupabaseAdminClient()

  const { data: syncStatus } = await supabase
    .from('fiscal_sync_status')
    .select('id, tax_id, is_company_synced')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!syncStatus?.is_company_synced || !syncStatus.tax_id) return

  const taxId = syncStatus.tax_id.replace(/\D/g, '')
  if (!taxId) return

  try {
    const response = await fetch(
      `${apiBaseUrl}/v2/empresas/${encodeURIComponent(taxId)}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': authHeader }
      }
    )

    if (response.ok || response.status === 404) {
      await supabase
        .from('fiscal_sync_status')
        .update({
          is_company_synced: false,
          integration_status: 'inactive',
          sync_status: 'never',
          updated_by: 'subscription-cancellation'
        })
        .eq('id', syncStatus.id)
    } else {
      console.warn(
        `[deleteFocusNfeCompanyForOrg] FocusNFe returned ${response.status} for org ${organizationId}`
      )
    }
  } catch (err) {
    console.error(`[deleteFocusNfeCompanyForOrg] Network error for org ${organizationId}:`, err)
  }
}
