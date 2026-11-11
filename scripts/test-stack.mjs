// Sobe a stack local (docker-compose.e2e.yml), roda os testes de banco e E2E e derruba tudo.
//   pnpm test:stack                  db + e2e
//   pnpm test:stack --only=e2e       só Playwright   (--only=db: só tests/db; "api" ainda é aceito como apelido)
//   pnpm test:stack --keep           não derruba a stack no fim (para depurar e reaproveitar na próxima execução)
//   pnpm test:stack --reuse          usa a stack que já está no ar: não sobe nem derruba (migrations não são reaplicadas)
//   pnpm test:stack --only=build     só o build de produção (respeita o carimbo; sem Docker)
//   pnpm test:stack --build          força o build (ignora o carimbo)
//   pnpm test:stack --no-build       nunca builda, mesmo com o carimbo desatualizado (avisa)
//   pnpm test:stack --with-demo-seed carrega o seed demo (pnpm seed:demo) antes do Playwright; o spec @demo-seed deixa de pular
//   pnpm test:stack --print-build-key imprime a chave do build (usada pelo cache do CI) e sai
//   pnpm test:stack --project=desktop --grep money   o resto vai para o Playwright
// Por padrão o build só roda se o carimbo de .output/build-stamp.json não bate com o código atual (ver buildKey).
import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = join(root, 'supabase/e2e/stack.env')
const compose = ['compose', '-f', join(root, 'docker-compose.e2e.yml'), '--env-file', envFile]

const args = process.argv.slice(2)
const split = args.indexOf('--')
const flags = split === -1 ? args : args.slice(0, split)
const own = new Set(['--keep', '--reuse', '--build', '--no-build', '--with-demo-seed', '--print-build-key'])
const keep = flags.includes('--keep')
const reuse = flags.includes('--reuse')
const forceBuild = flags.includes('--build')
const noBuild = flags.includes('--no-build')
const withDemoSeed = flags.includes('--with-demo-seed')
const rawOnly = flags.find(f => f.startsWith('--only='))?.split('=')[1] ?? 'all'
const only = rawOnly === 'api' ? 'db' : rawOnly
// Tudo que não é flag deste script vai para o Playwright (com ou sem "--": o pnpm às vezes consome o "--").
const playwrightArgs = [...flags.filter(f => !own.has(f) && !f.startsWith('--only=')), ...(split === -1 ? [] : args.slice(split + 1))]

const stack = Object.fromEntries(
  readFileSync(envFile, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=')
    return [l.slice(0, i), l.slice(i + 1)]
  })
)
const url = `http://127.0.0.1:${stack.GATEWAY_PORT}`
const port = process.env.E2E_PORT ?? '3100'

// Variáveis que entram no build (o runtimeConfig as lê de process.env). Fazem parte do carimbo.
const buildEnv = {
  SUPABASE_URL: url,
  SUPABASE_ANON_KEY: stack.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
  STRIPE_SECRET_KEY: 'sk_test_e2e_placeholder',
  STRIPE_WEBHOOK_SECRET: 'whsec_e2e_placeholder',
  NUXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
  NITRO_PRESET: 'node-server'
}

// ---- carimbo de build -------------------------------------------------------------------------------------------
const stampFile = join(root, '.output', 'build-stamp.json')
const hashedDirs = ['app', 'server', 'lib', 'content', 'public']
const hashedFiles = ['nuxt.config.ts', 'content.config.ts', 'app.config.ts', 'tsconfig.json', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile()) out.push(p)
  }
  return out
}

/** Hash do que influencia o build: código-fonte, conteúdo, config, lockfile, .env* (o Nuxt os lê) e variáveis de build. */
function buildKey() {
  const h = createHash('sha256')
  const feed = (label, data) => {
    h.update(`${label}\0`)
    h.update(data)
    h.update('\0')
  }
  const files = [
    ...hashedDirs.filter(d => existsSync(join(root, d))).flatMap(d => walk(join(root, d))),
    ...hashedFiles.map(f => join(root, f)).filter(existsSync),
    ...readdirSync(root).filter(f => /^\.env(\..+)?$/.test(f) && !f.endsWith('.example')).map(f => join(root, f))
  ]
  for (const f of files) {
    if (!statSync(f).isFile()) continue
    // CRLF e LF dão o mesmo hash (o checkout no Windows converte).
    feed(relative(root, f).replace(/\\/g, '/'), readFileSync(f, 'utf8').replace(/\r\n/g, '\n'))
  }
  feed('env', JSON.stringify(Object.entries(buildEnv).sort()))
  feed('node', process.version.split('.')[0])
  return h.digest('hex').slice(0, 32)
}

if (flags.includes('--print-build-key')) {
  console.log(buildKey())
  process.exit(0)
}

function readStamp() {
  try {
    return JSON.parse(readFileSync(stampFile, 'utf8')).key
  } catch {
    return null
  }
}
const outputOk = () => existsSync(join(root, '.output', 'server', 'index.mjs'))

// ---- execução por etapa -----------------------------------------------------------------------------------------
const verbose = !!process.env.VERBOSE
const logsDir = join(root, '.test-output', 'logs')
mkdirSync(logsDir, { recursive: true })
const timings = []

// Padrão: saída completa vai para .test-output/logs/<etapa>.log; o console mostra só o resumo.
// Em falha, mostra as últimas linhas e o caminho do log. VERBOSE=1: stdio herdado (comportamento antigo).
function run(cmd, cmdArgs, env = {}, step = 'step') {
  const shell = process.platform === 'win32'
  const fullEnv = { ...process.env, ...env }
  const t0 = Date.now()
  const finish = (status) => {
    timings.push({ step, seconds: Number(((Date.now() - t0) / 1000).toFixed(1)), status })
    return status
  }
  if (verbose) {
    console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`)
    return finish(spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', shell, env: fullEnv }).status ?? 1)
  }
  const logPath = join(logsDir, `${step}.log`)
  const fd = openSync(logPath, 'w')
  let status
  try {
    status = spawnSync(cmd, cmdArgs, { cwd: root, stdio: ['ignore', fd, fd], shell, env: fullEnv }).status ?? 1
  } finally {
    closeSync(fd)
  }
  finish(status)
  if (status === 0) {
    console.log(`[ok]   ${step}  ${timings.at(-1).seconds}s  (log: ${logPath})`)
  } else {
    console.log(`[FAIL] ${step} (exit ${status}) - últimas linhas:`)
    console.log(readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-40).join('\n'))
    console.log(`Log completo: ${logPath}`)
  }
  return status
}

function summary() {
  if (!timings.length) return
  console.log('\nTempo por etapa:')
  for (const t of timings) console.log(`  ${t.step.padEnd(12)} ${String(t.seconds).padStart(8)} s  ${t.status === 0 ? 'ok' : `exit ${t.status}`}`)
  const total = timings.reduce((a, t) => a + t.seconds, 0)
  console.log(`  ${'total'.padEnd(12)} ${total.toFixed(1).padStart(8)} s`)
  writeFileSync(join(root, '.test-output', 'timings.json'), JSON.stringify({ at: new Date().toISOString(), steps: timings }, null, 2))
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = timings.map(t => `| ${t.step} | ${t.seconds} | ${t.status === 0 ? 'ok' : `exit ${t.status}`} |`).join('\n')
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### test:stack\n\n| etapa | s | resultado |\n|---|---|---|\n${rows}\n`, { flag: 'a' })
  }
}

// Build de produção servido pelo Playwright: sobe em segundos e não compila telas sob demanda (o `nuxt dev`
// passa de 3 min na primeira subida). As chaves entram no build porque o runtimeConfig as lê de process.env.
function ensureBuild() {
  const key = buildKey()
  const stale = !outputOk() || readStamp() !== key
  let buildCode = 0
  if (noBuild) {
    console.log(stale ? '[warn] --no-build com .output ausente ou desatualizado: o E2E pode testar código antigo' : '[skip] build (--no-build)')
  } else if (!forceBuild && !stale) {
    console.log(`[skip] build (carimbo ${key.slice(0, 12)} igual ao de .output; --build força)`)
  } else {
    // O Nitro estoura o heap padrão (~4 GB) neste projeto em algumas máquinas; BUILD_HEAP_MB ajusta.
    const heap = process.env.BUILD_HEAP_MB ?? '8192'
    const nodeOptions = /max-old-space-size/.test(process.env.NODE_OPTIONS ?? '') ? process.env.NODE_OPTIONS : `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=${heap}`.trim()
    buildCode = run('pnpm', ['exec', 'nuxt', 'build'], { ...buildEnv, NODE_OPTIONS: nodeOptions }, 'build')
    if (buildCode === 0) writeFileSync(stampFile, JSON.stringify({ key, at: new Date().toISOString() }))
  }
  return buildCode
}

// ---- stack ------------------------------------------------------------------------------------------------------
if (only === 'build') { // só o build (sem Docker): pnpm build:e2e
  const c = ensureBuild()
  summary()
  process.exit(c)
}
const down = () => run('docker', [...compose, 'down', '-v'], {}, 'stack-down')

if (reuse) {
  // Stack já no ar: não sobe (nenhuma migration é reaplicada) e não derruba.
  const ps = spawnSync('docker', [...compose, 'ps', '--status', 'running', '--services'], { encoding: 'utf8', cwd: root })
  const running = (ps.stdout ?? '').split(/\r?\n/)
  if (!running.includes('db') || !running.includes('gateway')) {
    console.error('--reuse: a stack não está no ar. Rode: pnpm stack:up')
    process.exit(1)
  }
  console.log('[skip] stack-up (--reuse: stack já no ar)')
} else {
  const upCode = run('docker', [...compose, 'up', '-d', '--wait', '--quiet-pull'], {}, 'stack-up')
  if (upCode !== 0) {
    run('docker', [...compose, 'logs', '--tail=80'], {}, 'stack-logs')
    if (!keep) down()
    summary()
    process.exit(upCode)
  }
}
let code = 0

try {
  if (code === 0 && (only === 'all' || only === 'db')) {
    code = run('pnpm', ['exec', 'vitest', 'run', '--project', 'db'], {
      TEST_SUPABASE_URL: url,
      TEST_SUPABASE_ANON_KEY: stack.ANON_KEY,
      TEST_SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
      REQUIRE_API_TESTS: '1',
      // O teste da migration de auditoria roda no Postgres da própria stack (via `docker exec`).
      AUDIT_PG_URL: `postgres://postgres@127.0.0.1:${stack.DB_PORT}/postgres`,
      AUDIT_PG_CONTAINER: 'autopro-e2e-db'
    }, 'db')
  }
  if ((only === 'all' || only === 'e2e') && (code === 0 || only === 'e2e')) {
    let buildCode = ensureBuild()
    // Seed demo opcional (1.265 OS): carregado só aqui, depois dos testes de banco, para não contaminá-los. Usa a mesma stack (docker compose exec db + gateway de stack.env).
    if (buildCode === 0 && withDemoSeed) buildCode = run('node', ['scripts/seed/load-demo.mjs'], {}, 'demo-seed')
    const e2eCode = buildCode !== 0
      ? buildCode
      : run('pnpm', ['exec', 'playwright', 'test', ...playwrightArgs], {
          E2E_SERVER: 'prod',
          E2E_SUPABASE_URL: url,
          E2E_SUPABASE_ANON_KEY: stack.ANON_KEY,
          E2E_SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY
        }, 'e2e')
    code = code || e2eCode
  }
} finally {
  if (keep || reuse) console.log(`\nStack mantida em ${url} (derrubar: pnpm stack:down)`)
  else down()
  summary()
}
process.exit(code)
