// Sobe a stack local (docker-compose.e2e.yml), roda os testes de integração e E2E e derruba tudo.
//   pnpm test:stack                  api + e2e
//   pnpm test:stack --only=e2e       só Playwright   (--only=api: só tests/api)
//   pnpm test:stack --keep           não derruba a stack no fim (para depurar)
//   pnpm test:stack --no-build       reaproveita o .output do último build (só vale se o código não mudou)
//   pnpm test:stack --project=desktop --grep money   o resto vai para o Playwright
import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = join(root, 'supabase/e2e/stack.env')
const compose = ['compose', '-f', join(root, 'docker-compose.e2e.yml'), '--env-file', envFile]

const args = process.argv.slice(2)
const split = args.indexOf('--')
const flags = split === -1 ? args : args.slice(0, split)
const keep = flags.includes('--keep')
const noBuild = flags.includes('--no-build')
const only = flags.find(f => f.startsWith('--only='))?.split('=')[1] ?? 'all'
// Tudo que não é flag deste script vai para o Playwright (com ou sem "--": o pnpm às vezes consome o "--").
const playwrightArgs = [...flags.filter(f => f !== '--keep' && f !== '--no-build' && !f.startsWith('--only=')), ...(split === -1 ? [] : args.slice(split + 1))]

const stack = Object.fromEntries(
  readFileSync(envFile, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=')
    return [l.slice(0, i), l.slice(i + 1)]
  })
)
const url = `http://127.0.0.1:${stack.GATEWAY_PORT}`

const verbose = !!process.env.VERBOSE
const logsDir = join(root, '.test-output', 'logs')
mkdirSync(logsDir, { recursive: true })

// Padrão: saída completa vai para .test-output/logs/<etapa>.log; o console mostra só o resumo.
// Em falha, mostra as últimas linhas e o caminho do log. VERBOSE=1: stdio herdado (comportamento antigo).
function run(cmd, cmdArgs, env = {}, step = 'step') {
  const shell = process.platform === 'win32'
  const fullEnv = { ...process.env, ...env }
  if (verbose) {
    console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`)
    return spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', shell, env: fullEnv }).status ?? 1
  }
  const logPath = join(logsDir, `${step}.log`)
  const fd = openSync(logPath, 'w')
  let status
  try {
    status = spawnSync(cmd, cmdArgs, { cwd: root, stdio: ['ignore', fd, fd], shell, env: fullEnv }).status ?? 1
  } finally {
    closeSync(fd)
  }
  if (status === 0) {
    console.log(`[ok]   ${step}  (log: ${logPath})`)
  } else {
    console.log(`[FAIL] ${step} (exit ${status}) - últimas linhas:`)
    console.log(readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-40).join('\n'))
    console.log(`Log completo: ${logPath}`)
  }
  return status
}

let code = run('docker', [...compose, 'up', '-d', '--wait', '--quiet-pull'], {}, 'stack-up')
if (code !== 0) {
  run('docker', [...compose, 'logs', '--tail=80'], {}, 'stack-logs')
  if (!keep) run('docker', [...compose, 'down', '-v'], {}, 'stack-down')
  process.exit(code)
}

try {
  if (only === 'all' || only === 'api') {
    code = run('pnpm', ['exec', 'vitest', 'run', '--project', 'api'], {
      TEST_SUPABASE_URL: url,
      TEST_SUPABASE_ANON_KEY: stack.ANON_KEY,
      TEST_SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
      REQUIRE_API_TESTS: '1',
      // O teste da migration de auditoria roda no Postgres da própria stack (via `docker exec`).
      AUDIT_PG_URL: `postgres://postgres@127.0.0.1:${stack.DB_PORT}/postgres`,
      AUDIT_PG_CONTAINER: 'autopro-e2e-db-1'
    }, 'api')
  }
  if ((only === 'all' || only === 'e2e') && (code === 0 || only === 'e2e')) {
    const port = process.env.E2E_PORT ?? '3100'
    const supabaseEnv = { SUPABASE_URL: url, SUPABASE_ANON_KEY: stack.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY }
    // Build de produção servido pelo Playwright: sobe em segundos e não compila telas sob demanda (o `nuxt dev`
    // passa de 3 min na primeira subida). As chaves entram no build porque o runtimeConfig as lê de process.env.
    let buildCode = 0
    if (!noBuild) {
      buildCode = run('pnpm', ['exec', 'nuxt', 'build'], {
        ...supabaseEnv,
        STRIPE_SECRET_KEY: 'sk_test_e2e_placeholder',
        STRIPE_WEBHOOK_SECRET: 'whsec_e2e_placeholder',
        NUXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
        NITRO_PRESET: 'node-server'
      }, 'build')
    }
    const e2eCode = buildCode !== 0 ? buildCode : run('pnpm', ['exec', 'playwright', 'test', ...playwrightArgs], {
      E2E_SERVER: 'prod',
      E2E_SUPABASE_URL: url,
      E2E_SUPABASE_ANON_KEY: stack.ANON_KEY,
      E2E_SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY
    }, 'e2e')
    code = code || e2eCode
  }
} finally {
  if (keep) console.log(`\nStack mantida em ${url} (derrubar: pnpm stack:down)`)
  else run('docker', [...compose, 'down', '-v'], {}, 'stack-down')
}
process.exit(code)
