// Configuração dos E2E que precisam de usuário logado. Tudo contra o Supabase LOCAL.
//
//   supabase start
//   supabase status -o env        # copie API_URL, ANON_KEY e SERVICE_ROLE_KEY
//   E2E_SUPABASE_URL=http://127.0.0.1:54321 \
//   E2E_SUPABASE_ANON_KEY=... E2E_SUPABASE_SERVICE_ROLE_KEY=... pnpm test:e2e
//
// Sem as três variáveis, os specs "logado" são PULADOS com o motivo (os de visitante continuam rodando).
// O playwright.config.ts repassa as mesmas variáveis ao servidor do app, que ignora o .env do projeto.
export const E2E = {
  url: process.env.E2E_SUPABASE_URL ?? '',
  anonKey: process.env.E2E_SUPABASE_ANON_KEY ?? '',
  serviceRoleKey: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? ''
}

export function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/** Por que os specs logados não rodam (ou `null` se podem rodar). */
export function authSkipReason(): string | null {
  if (!E2E.url || !E2E.anonKey || !E2E.serviceRoleKey) {
    return 'defina E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY e E2E_SUPABASE_SERVICE_ROLE_KEY (Supabase local: "supabase status -o env")'
  }
  if (!isLocalUrl(E2E.url)) {
    return `E2E_SUPABASE_URL (${E2E.url}) não é local. Recusando rodar para proteger dados reais.`
  }
  return null
}

export const PASSWORD = 'E2e-Passw0rd!'
