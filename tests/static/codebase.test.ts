// L0 — testes estáticos: leem o código-fonte, não sobem nada.
// Ver docs/testing/test-plan.md §4 e docs/testing/known-failures.md.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTION_PLAN_REQUIREMENTS, PLAN_LICENSES } from '../../app/composables/usePlans'
import {
  AUTH_GUARDS,
  PERMISSION_GUARDS,
  ROOT,
  WRITE_METHODS,
  checkRatchet,
  listHandlers,
  read,
  walk,
  rel
} from '../helpers/source-scan'

const handlers = listHandlers()

/** Rotas públicas por desenho. Cada entrada precisa de justificativa. */
const PUBLIC_ALLOWLIST: Record<string, string> = {
  'server/api/auth/forgot-password.post.ts': 'recuperação de senha',
  'server/api/auth/login.post.ts': 'login',
  'server/api/auth/logout.post.ts': 'logout limpa cookies',
  'server/api/auth/me.get.ts': 'valida a própria sessão por cookie',
  'server/api/auth/reset-password-with-tokens.post.ts': 'reset por token do e-mail',
  'server/api/auth/reset-password.post.ts': 'reset por token do e-mail',
  'server/api/auth/set-session.post.ts': 'troca de token por sessão',
  'server/api/auth/signup.post.ts': 'cadastro',
  'server/api/metrics/track.post.ts': 'telemetria anônima',
  'server/api/stripe/webhook.post.ts': 'webhook (valida assinatura do Stripe)',
  'server/api/supabase/health.get.ts': 'health check'
}

describe('L0: matriz de guards', () => {
  it('há handlers para analisar', () => {
    expect(handlers.length).toBeGreaterThan(200)
  })

  it('todo handler chama um guard ou está na allowlist pública (catraca para as exceções conhecidas)', () => {
    const unguarded = handlers
      .filter(h => !AUTH_GUARDS.test(h.source))
      .map(h => h.file)
      .filter(f => !(f in PUBLIC_ALLOWLIST))

    const { added, fixed } = checkRatchet('unguarded-routes', unguarded)
    // KF-05..KF-08: rotas sem guard que NÃO deveriam ser públicas (consulta, export-file, lookup-plate, zip_code).
    expect(added, `Rota nova sem guard. Proteja-a ou, se for pública, justifique na PUBLIC_ALLOWLIST:\n${added.join('\n')}`).toEqual([])
    expect(fixed, `Rota agora protegida: remova de tests/static/baselines/unguarded-routes.json (UPDATE_BASELINE=1):\n${fixed.join('\n')}`).toEqual([])
  })

  it('a allowlist pública não tem entradas órfãs', () => {
    const files = new Set(handlers.map(h => h.file))
    for (const f of Object.keys(PUBLIC_ALLOWLIST)) expect(files.has(f), f).toBe(true)
  })

  it('nenhum handler é arquivo vazio (rota fantasma)', () => {
    const empty = handlers.filter(h => h.size === 0).map(h => h.file)
    const { added, fixed } = checkRatchet('empty-handlers', empty)
    // KF-08: fiscal/zip_code/index.get.ts
    expect(added).toEqual([])
    expect(fixed).toEqual([])
  })

  it('todo handler segue a convenção <nome>.<método>.ts', () => {
    const odd = handlers.filter(h => h.method === null).map(h => h.file)
    expect(odd).toEqual([])
  })

  it('toda rota /api/admin/** exige owner da plataforma', () => {
    const admin = handlers.filter(h => h.file.startsWith('server/api/admin/'))
    expect(admin.length).toBeGreaterThan(0)
    const weak = admin.filter(h => !/\brequireOwner\b/.test(h.source)).map(h => h.file)
    expect(weak).toEqual([])
  })
})

describe('L0: permissão nas rotas de escrita', () => {
  it('rotas de escrita sem requireOrgPermission/requireOwner só podem diminuir', () => {
    const writes = handlers
      .filter(h => h.method && WRITE_METHODS.has(h.method))
      .filter(h => !(h.file in PUBLIC_ALLOWLIST))
      .filter(h => !PERMISSION_GUARDS.test(h.source))
      .map(h => h.file)

    const { added, fixed } = checkRatchet('write-routes-without-permission', writes)
    // KF-09: a maior parte das rotas de escrita não checa o papel no servidor.
    expect(added, `Rota de escrita nova sem permissão:\n${added.join('\n')}`).toEqual([])
    expect(fixed, `Rota agora com permissão — atualize o baseline (UPDATE_BASELINE=1):\n${fixed.join('\n')}`).toEqual([])
  })
})

describe('L0: isolamento por organização', () => {
  it('handlers que usam o cliente admin referenciam organization_id (catraca)', () => {
    const missing = handlers
      .filter(h => /getSupabaseAdminClient/.test(h.source))
      .filter(h => !h.file.startsWith('server/api/admin/'))
      .filter(h => !(h.file in PUBLIC_ALLOWLIST))
      .filter(h => !/organization_id|organizationId|resolveOrganizationId|requireOrgPermission/.test(h.source))
      .map(h => h.file)

    const { added, fixed } = checkRatchet('admin-client-without-org', missing)
    expect(added, `Handler com service role sem referência à organização:\n${added.join('\n')}`).toEqual([])
    expect(fixed, `Corrigido — atualize o baseline (UPDATE_BASELINE=1):\n${fixed.join('\n')}`).toEqual([])
  })
})

describe('L0: paridade front/servidor de planos (R9)', () => {
  const guardSource = read('server/utils/require-org-permission.ts')
  const licenseSource = read('server/utils/license.ts')

  it('ACTION_PLAN_REQUIREMENTS é igual em usePlans.ts e require-org-permission.ts', () => {
    const block = guardSource.match(/ACTION_PLAN_REQUIREMENTS[^{]*\{([\s\S]*?)\n\}/)![1]!
    const server = Object.fromEntries([...block.matchAll(/'([a-z_.]+)':\s*'([a-z]+)'/g)].map(m => [m[1], m[2]]))
    const front = Object.fromEntries(Object.entries(ACTION_PLAN_REQUIREMENTS).map(([k, v]) => [k, String(v)]))
    expect(server).toEqual(front)
  })

  it('limites de funcionários iguais em usePlans.ts (PLAN_LICENSES) e license.ts (EMPLOYEE_LIMITS)', () => {
    const block = licenseSource.match(/EMPLOYEE_LIMITS[^{]*\{([\s\S]*?)\n\}/)![1]!
    const server = Object.fromEntries([...block.matchAll(/(\w+):\s*(null|\d+)/g)].map(m => [m[1], m[2] === 'null' ? null : Number(m[2])]))
    const front = Object.fromEntries(Object.entries(PLAN_LICENSES).map(([k, v]) => [k, v.maxEmployees]))
    expect(server).toEqual(front)
  })

  it('a ordem de planos do servidor é a mesma do front', () => {
    const order = guardSource.match(/PLAN_ORDER\s*=\s*\[([^\]]*)\]/)![1]!.match(/'(\w+)'/g)!.map(s => s.replace(/'/g, ''))
    expect(order).toEqual(Object.keys(PLAN_LICENSES))
  })
})

describe('L0: códigos de ação', () => {
  const migrations = walk(join(ROOT, 'supabase/migrations')).filter(f => f.endsWith('.sql'))
  const allSql = migrations.map(f => read(rel(f))).join('\n')
  const seededCodes = new Set([...allSql.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]))

  it('todo código de ActionCode (front) existe nas migrations', () => {
    const codes = [...read('app/constants/action-codes.ts').matchAll(/=\s*'([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]!)
    expect(codes.length).toBeGreaterThan(30)
    const missing = codes.filter(c => !seededCodes.has(c))
    const { added, fixed } = checkRatchet('action-codes-not-seeded', missing)
    expect(added, `Código de ação sem seed:\n${added.join('\n')}`).toEqual([])
    expect(fixed).toEqual([])
  })

  it('todo código passado a requireOrgPermission(...) no servidor existe nas migrations', () => {
    const used = new Set<string>()
    for (const h of handlers) {
      for (const m of h.source.matchAll(/requireOrgPermission\([^)]*?'([a-z_]+\.[a-z_]+)'/g)) used.add(m[1]!)
    }
    expect(used.size).toBeGreaterThan(5)
    const missing = [...used].filter(c => !seededCodes.has(c))
    expect(missing).toEqual([])
  })

  it('códigos de ActionCode são únicos', () => {
    const codes = [...read('app/constants/action-codes.ts').matchAll(/=\s*'([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]!)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('L0: migrations', () => {
  const files = readdirSync(join(ROOT, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()

  it('todas seguem o padrão <timestamp>_<nome>.sql', () => {
    expect(files.filter(f => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f))).toEqual([])
  })

  it('não há timestamps duplicados (conflito de ordem de aplicação)', () => {
    const stamps = files.map(f => f.split('_')[0]!)
    const dup = [...new Set(stamps.filter((s, i) => stamps.indexOf(s) !== i))]
    // KF-10: 20240101000093 aparece duas vezes. Catraca: não podem surgir novos.
    const { added } = checkRatchet('duplicate-migration-timestamps', dup)
    expect(added).toEqual([])
  })

  // KF-10 (corrigido em 2026-11-09: a segunda ...093 virou ...099).
  it('timestamps estritamente crescentes e únicos', () => {
    const stamps = files.map(f => f.split('_')[0]!)
    expect(new Set(stamps).size).toBe(stamps.length)
  })
})

describe('L0: afirmações públicas', () => {
  it('check:claims passa (FAQ/preços não prometem o que não existe)', async () => {
    const { spawnSync } = await import('node:child_process')
    const result = spawnSync(process.execPath, ['scripts/check-public-claims.mjs'], { cwd: ROOT, encoding: 'utf8' })
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })
})
