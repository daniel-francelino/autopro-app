// Passo 3 do seeder "demo": carrega supabase/seeders/demo/demo.sql.gz na stack LOCAL (docker-compose.e2e.yml) e cria usuários de login.
//
//   pnpm stack:up
//   pnpm seed:demo            # (node scripts/seed/load-demo.mjs)
//
// Só fala com a stack local (127.0.0.1:54421 / container `db`). É idempotente: apaga a oficina demo e recria.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { createClient } from '@supabase/supabase-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dir = join(root, 'supabase', 'seeders', 'demo')
const envFile = join(root, 'supabase', 'e2e', 'stack.env')
if (!existsSync(join(dir, 'demo.sql.gz'))) {
  console.error('demo.sql.gz não existe. Gere com: node scripts/seed/export-prod.mjs && node scripts/seed/anonymize.mjs')
  process.exit(1)
}

const env = Object.fromEntries(readFileSync(envFile, 'utf8').split(String.fromCharCode(10)).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const GATEWAY = `http://127.0.0.1:${env.GATEWAY_PORT}`
const meta = JSON.parse(readFileSync(join(dir, 'demo.meta.json'), 'utf8'))
const orgId = meta.organizationId
const compose = ['compose', '-f', join(root, 'docker-compose.e2e.yml'), '--env-file', envFile]

const up = spawnSync('docker', [...compose, 'ps', '--status', 'running', '--services'], { encoding: 'utf8' })
if (!up.stdout?.includes('db')) {
  console.error('A stack local não está no ar. Rode: pnpm stack:up')
  process.exit(1)
}

console.log('Carregando dados (SQL anonimizado)...')
const sql = gunzipSync(readFileSync(join(dir, 'demo.sql.gz')))
const psql = spawnSync('docker', [...compose, 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, maxBuffer: 1 << 30, encoding: 'utf8' })
if (psql.status !== 0) {
  console.error(psql.stderr || psql.stdout)
  process.exit(1)
}

const db = createClient(GATEWAY, env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`)
  return r.data
}

// Papel "admin" de sistema (é o que o servidor reconhece como administrador da oficina).
let admin = (await db.from('roles').select('id').eq('organization_id', orgId).eq('name', 'admin').maybeSingle()).data
if (!admin) admin = must(await db.from('roles').insert({ organization_id: orgId, name: 'admin', display_name: 'Administrador', is_system_role: true }).select('id').single(), 'papel admin')
const limited = (await db.from('roles').select('id, name').eq('organization_id', orgId).eq('is_system_role', false).order('name').limit(1).maybeSingle()).data

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@12345'
const users = [
  { email: 'admin@demo.autopro.test', name: 'Admin Demo', roleId: admin.id },
  ...(limited ? [{ email: 'funcionario@demo.autopro.test', name: 'Funcionário Demo', roleId: limited.id }] : [])
]
for (const u of users) {
  const list = await db.auth.admin.listUsers({ perPage: 1000 })
  const old = list.data?.users.find(x => x.email === u.email)
  if (old) {
    await db.from('user_profiles').delete().eq('user_id', old.id)
    await db.auth.admin.deleteUser(old.id)
  }
  const created = await db.auth.admin.createUser({ email: u.email, password: PASSWORD, email_confirm: true, user_metadata: { name: u.name } })
  if (created.error) throw new Error(`usuário ${u.email}: ${created.error.message}`)
  must(await db.from('user_profiles').insert({ user_id: created.data.user.id, organization_id: orgId, role_id: u.roleId, display_name: u.name, is_active: true }).select('id').single(), `perfil ${u.email}`)
}

console.log(`Pronto. Oficina demo: ${orgId}`)
console.table(users.map(u => ({ login: u.email, senha: PASSWORD, papel: u.roleId === admin.id ? 'admin' : limited?.name })))
