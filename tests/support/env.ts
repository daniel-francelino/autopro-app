// Configuração dos testes de integração (projeto `api`).
// Padrões = Supabase LOCAL (`supabase start`). Nada de produção aqui.
export const TEST_ENV = {
  url: process.env.TEST_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  serviceRoleKey: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? '',
  anonKey: process.env.TEST_SUPABASE_ANON_KEY ?? ''
}

export function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
  } catch {
    return false
  }
}
