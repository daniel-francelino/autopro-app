// Gera as chaves de TESTE da stack local (docker-compose.e2e.yml). Só valem para essa stack:
// o segredo JWT é uma constante pública neste repositório e a stack só escuta em 127.0.0.1.
//   node supabase/e2e/generate-keys.mjs        # imprime o bloco para colar em supabase/e2e/stack.env
import { createHmac } from 'node:crypto'

export const JWT_SECRET = 'autopro-e2e-only-jwt-secret-not-for-production-0123456789'

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')

export function signJwt(payload, secret = JWT_SECRET) {
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64(payload)
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

// iat/exp fixos (2020 → 2100): a chave não expira e a saída é estável (o arquivo não muda a cada geração).
const claims = { iss: 'supabase-e2e', iat: 1577836800, exp: 4102444800 }
export const ANON_KEY = signJwt({ ...claims, role: 'anon' })
export const SERVICE_ROLE_KEY = signJwt({ ...claims, role: 'service_role' })

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('generate-keys.mjs')) {
  console.log(`JWT_SECRET=${JWT_SECRET}`)
  console.log(`ANON_KEY=${ANON_KEY}`)
  console.log(`SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}`)
}
