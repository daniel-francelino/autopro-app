// L3: migration 097 contra Postgres REAL (critérios do §13 de docs/audit/audit-log-plan.md).
// Roda no projeto `api` (precisa de Supabase local) e também isolado:
//   docker run -d --name audit-pg -e POSTGRES_PASSWORD=postgres -p 54999:5432 public.ecr.aws/supabase/postgres:17.11.0.011
//   AUDIT_PG_URL=postgres://postgres:postgres@127.0.0.1:54999/postgres pnpm exec vitest run --project api tests/api/audit-logs.sql.test.ts
// Usa o `psql` do container (sem dependência nova). Recusa qualquer banco que não seja local.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildAuditRow } from '../../server/utils/audit/build'

const CONTAINER = process.env.AUDIT_PG_CONTAINER ?? 'audit-pg'
const enabled = Boolean(process.env.AUDIT_PG_URL)
const MIGRATION = 'supabase/migrations/20240101000097_create_audit_logs.sql'

function psql(sql: string, role?: string): string {
  const wrapped = role ? `SET ROLE ${role};\n${sql}` : sql
  return execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'audit_test', '-v', 'ON_ERROR_STOP=1', '-At', '-q'], { input: wrapped, encoding: 'utf8' }).trim()
}
function psqlFails(sql: string, role?: string): string {
  try {
    psql(sql, role)
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? err)
  }
  throw new Error(`esperava erro, mas passou: ${sql}`)
}

const row = (id: string, extra = '') =>
  `INSERT INTO public.audit_logs (id, request_id, action, http_method, http_path, status_code, outcome${extra ? `, ${extra.split('|')[0]}` : ''})
   VALUES ('${id}', gen_random_uuid(), 'client.create', 'POST', '/api/clients', 200, 'success'${extra ? `, ${extra.split('|')[1]}` : ''})`

describe.skipIf(!enabled)('migration 097 (Postgres real)', () => {
  beforeAll(() => {
    execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-c', 'DROP DATABASE IF EXISTS audit_test', '-c', 'CREATE DATABASE audit_test'])
    // Como no Supabase hospedado: tabelas novas do schema public nascem com GRANT ALL para anon/authenticated/service_role.
    // Sem isto os testes de REVOKE/append-only passariam por motivo errado (falta de privilégio, não do trigger).
    psql(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
          GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role`)
    psql(readFileSync(MIGRATION, 'utf8'))
  })
  afterAll(() => {
    if (enabled) execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', 'postgres', '-c', 'DROP DATABASE IF EXISTS audit_test'])
  })

  it('cria as partições do mês atual + 2 meses e a partição padrão', () => {
    const names = psql(`SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid JOIN pg_class p ON p.oid=i.inhparent WHERE p.relname='audit_logs' ORDER BY 1`).split('\n')
    expect(names).toContain('audit_logs_default')
    expect(names.filter(n => /^audit_logs_y\d{4}m\d{2}$/.test(n))).toHaveLength(3)
  })

  it('service_role grava e lê; a linha cai na partição do mês (não na padrão)', () => {
    psql(row('11111111-1111-4111-8111-111111111111'), 'service_role')
    expect(psql(`SELECT count(*) FROM public.audit_logs`, 'service_role')).toBe('1')
    expect(psql(`SELECT count(*) FROM public.audit_logs_default`)).toBe('0')
  })

  it('UPDATE e DELETE são bloqueados, inclusive para o service_role e o dono', () => {
    expect(psqlFails(`UPDATE public.audit_logs SET action='x'`, 'service_role')).toMatch(/append-only/)
    expect(psqlFails(`DELETE FROM public.audit_logs`, 'service_role')).toMatch(/append-only/)
    expect(psqlFails(`UPDATE public.audit_logs SET action='x'`)).toMatch(/append-only/)
  })

  it('TRUNCATE é negado ao service_role', () => {
    expect(psqlFails(`TRUNCATE public.audit_logs`, 'service_role')).toMatch(/permission denied/)
  })

  it('anon e authenticated não leem nem escrevem na tabela, nem em partições (PostgREST expõe ambas)', () => {
    const partition = psql(`SELECT relname FROM pg_class WHERE relname ~ '^audit_logs_y\\d{4}m\\d{2}$' ORDER BY 1 LIMIT 1`)
    for (const role of ['anon', 'authenticated']) {
      expect(psqlFails(`SELECT * FROM public.audit_logs`, role)).toMatch(/permission denied/)
      expect(psqlFails(`SELECT * FROM public.${partition}`, role)).toMatch(/permission denied/)
      expect(psqlFails(`SELECT * FROM public.audit_logs_default`, role)).toMatch(/permission denied/)
      expect(psqlFails(row('22222222-2222-4222-8222-222222222222'), role)).toMatch(/permission denied/)
    }
  })

  it('anon/authenticated não executam as funções de manutenção', () => {
    for (const role of ['anon', 'authenticated']) {
      expect(psqlFails(`SELECT public.audit_logs_maintain(2, 6)`, role)).toMatch(/permission denied/)
      expect(psqlFails(`SELECT public.audit_logs_create_partition(now()::date)`, role)).toMatch(/permission denied/)
    }
  })

  it('rejeita outcome e actor_type fora da lista', () => {
    expect(psqlFails(`INSERT INTO public.audit_logs (request_id, action, http_method, http_path, status_code, outcome) VALUES (gen_random_uuid(), 'a', 'POST', '/x', 200, 'talvez')`)).toMatch(/check constraint/)
    expect(psqlFails(row('44444444-4444-4444-8444-444444444444', `actor_type|'hacker'`))).toMatch(/check constraint/)
  })

  it('aceita ip como inet e rejeita texto inválido (por isso o plugin valida o IP)', () => {
    psql(row('55555555-5555-4555-8555-555555555555', `ip_address|'203.0.113.9'`))
    expect(psqlFails(row('66666666-6666-4666-8666-666666666666', `ip_address|'nao-e-ip'`))).toMatch(/inet/)
  })

  it('manutenção é idempotente', () => {
    psql(`SELECT public.audit_logs_maintain(2, 6); SELECT public.audit_logs_maintain(2, 6)`)
    const count = psql(`SELECT count(*) FROM pg_class WHERE relname ~ '^audit_logs_y\\d{4}m\\d{2}$' AND relkind='r'`)
    expect(count).toBe('3')
  })

  it('retenção: descarta partição com mais de 6 meses e preserva as recentes', () => {
    psql(`SELECT public.audit_logs_create_partition((now() - interval '8 months')::date)`)
    psql(`SELECT public.audit_logs_create_partition((now() - interval '5 months')::date)`)
    const old = psql(`SELECT to_char(date_trunc('month', now() - interval '8 months'), '"audit_logs_y"YYYY"m"MM')`)
    const recent = psql(`SELECT to_char(date_trunc('month', now() - interval '5 months'), '"audit_logs_y"YYYY"m"MM')`)
    psql(`SELECT public.audit_logs_maintain(2, 6)`)
    const left = psql(`SELECT relname FROM pg_class WHERE relname ~ '^audit_logs_y\\d{4}m\\d{2}$'`).split('\n')
    expect(left).not.toContain(old)
    expect(left).toContain(recent)
    expect(psql(`SELECT count(*) FROM public.audit_logs`)).toBe('2') // dados do mês atual intactos
  })

  it('a partição padrão continua vazia', () => {
    expect(psql(`SELECT count(*) FROM public.audit_logs_default`)).toBe('0')
  })

  it('consulta por request_id usa o intervalo de prefixo do handler do owner', () => {
    psql(`INSERT INTO public.audit_logs (request_id, action, http_method, http_path, status_code, outcome)
          VALUES ('abc12345-0000-4000-8000-000000000001', 'a.b', 'POST', '/x', 500, 'error')`)
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE request_id >= 'abc12345-0000-0000-0000-000000000000' AND request_id <= 'abc12345-ffff-ffff-ffff-ffffffffffff'`)).toBe('1')
  })

  it('linhas montadas por buildAuditRow cabem na tabela (colunas, tipos, limites e jsonb)', () => {
    const base = { requestId: '99999999-9999-4999-8999-999999999999', startedAt: Date.now() - 5 }
    const ctxs = [
      { ctx: { ...base, userId: '22222222-2222-4222-8222-222222222222', email: 'a@a.com', organizationId: '33333333-3333-4333-8333-333333333333', role: 'admin', changes: { changed_fields: ['total'], diff: { total: { from: 500, to: 50 } } } }, method: 'POST', path: '/api/service-orders', matchedRoute: '/api/service-orders', status: 200, body: { orderId: 'o1', total: 50, password: 'x' } },
      { ctx: { ...base, error: { statusCode: 401, message: 'Invalid credentials' } }, method: 'POST', path: '/api/auth/login', matchedRoute: '/api/auth/login', status: 401, body: { email: 'F@x.com', password: 'p' } },
      { ctx: { ...base, userId: '22222222-2222-4222-8222-222222222222', responseBody: { id: 'o1', itens: [1, 2, 3] } }, method: 'GET', path: '/api/service-orders/o1', matchedRoute: '/api/service-orders/:id', params: { id: 'o1' }, status: 200 },
      { ctx: { ...base, actorType: 'webhook', action: 'stripe.invoice.paid' }, method: 'POST', path: '/api/stripe/webhook', matchedRoute: '/api/stripe/webhook', status: 200 },
      { ctx: { ...base }, method: 'POST', path: '/api/suppliers/import', matchedRoute: '/api/suppliers/import', status: 200, contentType: 'multipart/form-data; boundary=x', contentLength: 900 }
    ]
    for (const input of ctxs) {
      const row = buildAuditRow({ headers: { forwardedFor: '203.0.113.9', userAgent: 'ua', platform: 'web' }, ...input } as any)
      const json = JSON.stringify(row).replace(/'/g, '\'\'')
      const cols = Object.keys(row).join(', ')
      psql(`INSERT INTO public.audit_logs (${cols}) SELECT ${cols} FROM jsonb_populate_record(NULL::public.audit_logs, '${json}'::jsonb)`, 'service_role')
    }
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE request_id='99999999-9999-4999-8999-999999999999'`)).toBe('5')
    expect(psql(`SELECT request_body->>'password' FROM public.audit_logs WHERE action='service_order.update'`)).toBe('[REDACTED]')
    expect(psql(`SELECT actor_type || ':' || actor_email || ':' || outcome FROM public.audit_logs WHERE action='auth.login'`)).toBe('anonymous:f@x.com:denied')
    expect(psql(`SELECT changes->'diff'->'total'->>'to' FROM public.audit_logs WHERE action='service_order.update'`)).toBe('50')
  })
})
