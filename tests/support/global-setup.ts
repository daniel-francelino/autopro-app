import type { TestProject } from 'vitest/node'
import { TEST_ENV, isLocalUrl } from './env'

declare module 'vitest' {
  export interface ProvidedContext {
    apiAvailable: boolean
    apiSkipReason: string
  }
}

/**
 * Barreira de segurança: os testes `api` escrevem e apagam dados. Só rodam contra Supabase LOCAL.
 * Se o Supabase local não estiver no ar, o projeto é marcado como indisponível e os testes são
 * PULADOS (com o motivo), em vez de falhar para quem não usa Docker.
 * No CI, REQUIRE_API_TESTS=1 transforma "indisponível" em falha.
 */
export default async function setup(project: TestProject) {
  const required = process.env.REQUIRE_API_TESTS === '1'
  const unavailable = (reason: string) => {
    if (required) throw new Error(`[api tests] ${reason}`)
    project.provide('apiAvailable', false)
    project.provide('apiSkipReason', reason)
  }

  if (!isLocalUrl(TEST_ENV.url)) {
    throw new Error(`[api tests] TEST_SUPABASE_URL (${TEST_ENV.url}) não é local. Recusando rodar para proteger dados reais.`)
  }
  if (!TEST_ENV.serviceRoleKey) return unavailable('TEST_SUPABASE_SERVICE_ROLE_KEY não definida (veja "supabase status").')

  try {
    const res = await fetch(`${TEST_ENV.url}/rest/v1/`, {
      headers: { apikey: TEST_ENV.serviceRoleKey, Authorization: `Bearer ${TEST_ENV.serviceRoleKey}` },
      signal: AbortSignal.timeout(3000)
    })
    if (!res.ok && res.status !== 404) return unavailable(`Supabase local respondeu ${res.status}.`)
  } catch {
    return unavailable(`Supabase local indisponível em ${TEST_ENV.url} (rode "supabase start").`)
  }

  project.provide('apiAvailable', true)
  project.provide('apiSkipReason', '')
}
