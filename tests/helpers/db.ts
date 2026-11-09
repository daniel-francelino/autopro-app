import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { TEST_ENV, isLocalUrl } from '../setup/env'

let client: SupabaseClient | undefined

/** Cliente com service role do Supabase LOCAL (recusa qualquer outra URL). */
export function adminDb(): SupabaseClient {
  if (!isLocalUrl(TEST_ENV.url)) throw new Error('adminDb() só funciona contra Supabase local')
  client ||= createClient(TEST_ENV.url, TEST_ENV.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}
