// L0: a stack de testes (docker-compose.e2e.yml) e o que depende dela não podem sair de sincronia.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANON_KEY, JWT_SECRET, SERVICE_ROLE_KEY } from '../../supabase/e2e/generate-keys.mjs'
import { ROOT } from '../helpers/source-scan'

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const env = Object.fromEntries(read('supabase/e2e/stack.env').split(/\r?\n/).filter(l => l && !l.startsWith('#')).map((l) => {
  const i = l.indexOf('=')
  return [l.slice(0, i), l.slice(i + 1)]
}))

describe('stack de testes (docker-compose.e2e.yml)', () => {
  it('as chaves em stack.env são as geradas por generate-keys.mjs', () => {
    expect(env.JWT_SECRET).toBe(JWT_SECRET)
    expect(env.ANON_KEY).toBe(ANON_KEY)
    expect(env.SERVICE_ROLE_KEY).toBe(SERVICE_ROLE_KEY)
  })

  it('só escuta em 127.0.0.1 (nada de porta aberta para a rede)', () => {
    const ports = [...read('docker-compose.e2e.yml').matchAll(/^\s*-\s*'([^']*:[^']*:\d+)'/gm)].map(m => m[1])
    expect(ports.length).toBeGreaterThan(0)
    for (const p of ports) expect(p, p).toMatch(/^127\.0\.0\.1:/)
  })

  it('não usa as portas do `supabase start`, para os dois conviverem', () => {
    for (const port of [54321, 54322, 54323, 54324]) {
      expect([env.GATEWAY_PORT, env.DB_PORT]).not.toContain(String(port))
    }
  })

  it('o gateway expõe o que o app usa: auth, rest e storage', () => {
    const kong = read('supabase/e2e/kong.yml')
    for (const path of ['/auth/v1/', '/rest/v1/', '/storage/v1/']) expect(kong).toContain(path)
  })

  it('o CI usa a mesma stack e o mesmo runner do desenvolvimento local', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('docker-compose.e2e.yml')
    expect(ci).toContain('test:stack')
  })

  it('o script de migrations aplica todos os arquivos de supabase/migrations em ordem', () => {
    const files = readdirSync(join(ROOT, 'supabase/migrations')).filter(f => f.endsWith('.sql'))
    expect(files.length).toBeGreaterThan(90)
    expect(files).toEqual([...files].sort())
    expect(read('supabase/e2e/migrate.sh')).toContain('/migrations/*.sql')
  })
})
