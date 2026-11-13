// [OSH-020..027] Histórico da OS (F0): tabela service_order_events contra Postgres REAL (stack Docker).
// Docs: docs/testing/os-history-scenarios.md §2.3. Migration: 20240101000108_create_service_order_events.sql.
//
// DECISÃO DE LIMPEZA: a tabela é append-only (trigger bloqueia DELETE/UPDATE) e sem FK, então estes testes NÃO
// apagam linhas. Cada teste usa organization_id / service_order_id / idempotency_key únicos (randomUUID) e só
// consulta o que ele mesmo criou. As linhas ficam na stack efêmera (Postgres em memória; `stack:down` apaga tudo).
// Nunca fazer TRUNCATE/DELETE aqui para "limpar": quebraria a garantia que o teste prova.
//
// Duas vias: PostgREST (adminDb, service_role) para o que a aplicação faz, e `docker exec psql` (como
// audit-logs.sql.test.ts) para papéis (SET ROLE), catálogo e trigger. O container vem de OSH_PG_CONTAINER
// (padrão `autopro-e2e-db`, o da stack). Sem container, os testes de psql são pulados com o motivo.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { describe, expect, inject, it } from 'vitest'
import { adminDb } from '../support/db'
import { TEST_ENV } from '../support/env'

const available = inject('apiAvailable')
const CONTAINER = process.env.OSH_PG_CONTAINER ?? process.env.AUDIT_PG_CONTAINER ?? 'autopro-e2e-db'
const TABLE = 'service_order_events'

function psqlRaw(sql: string, role?: string): string {
  const wrapped = role ? `SET ROLE ${role};\n${sql}` : sql
  return execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-q'], { input: wrapped, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
const pgReady = (() => {
  try { return psqlRaw(`SELECT to_regclass('public.${TABLE}') IS NOT NULL`) === 't' } catch { return false }
})()
// REQUIRE_API_TESTS=1 (CI/test:stack) transforma "indisponível" em falha, como o restante do projeto.
if (available && !pgReady && process.env.REQUIRE_API_TESTS === '1') {
  throw new Error(`[os-history db] container ${CONTAINER} ou tabela ${TABLE} indisponível (migration 108 aplicada?)`)
}

function psqlFails(sql: string, role?: string): string {
  try {
    psqlRaw(sql, role)
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? err)
  }
  throw new Error(`esperava erro, mas passou: ${sql}`)
}

/** Cria uma linha mínima válida (service_role via PostgREST). Devolve o que foi gravado. */
async function insertEvent(over: Record<string, unknown> = {}) {
  const row = {
    organization_id: randomUUID(), service_order_id: randomUUID(), event_type: 'installment.paid',
    category: 'payment', visibility: 'financial', correlation_id: randomUUID(),
    source_code: 'os_detail', source_label: 'Ordem de serviço (detalhe)', source_trust: 'declared',
    ...over
  }
  const { data, error } = await adminDb().from(TABLE).insert(row).select('id, seq, organization_id, service_order_id').single()
  if (error) throw new Error(`insertEvent: ${error.message}`)
  return data as { id: string, seq: number, organization_id: string, service_order_id: string }
}

const sqlRow = (org: string, extra = '') =>
  `INSERT INTO public.${TABLE} (organization_id, service_order_id, event_type, category, visibility, correlation_id, source_code, source_label, source_trust${extra ? `, ${extra.split('|')[0]}` : ''})
   VALUES ('${org}', gen_random_uuid(), 'installment.paid', 'payment', 'financial', gen_random_uuid(), 'os_detail', 'x', 'declared'${extra ? `, ${extra.split('|')[1]}` : ''})`

describe.skipIf(!available || !pgReady)('[OSH-020] catálogo da tabela service_order_events', () => {
  it('colunas NOT NULL do modelo, índices e unique de idempotência por organização', () => {
    const notNull = psqlRaw(`SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='${TABLE}' AND is_nullable='NO'`).split(',')
    expect(notNull).toEqual(expect.arrayContaining(['id', 'seq', 'organization_id', 'service_order_id', 'occurred_at', 'event_type', 'category', 'visibility', 'payload', 'correlation_id', 'source_code', 'source_label', 'source_trust', 'origin', 'actor_type', 'schema_version']))
    for (const nullable of ['idempotency_key', 'source_declared', 'actor_user_id', 'actor_name', 'entity_id']) expect(notNull).not.toContain(nullable)

    const defs = psqlRaw(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='${TABLE}'`)
    expect(defs).toContain('(organization_id, service_order_id, occurred_at DESC, seq DESC)')
    expect(defs).toContain('(organization_id, event_type, occurred_at DESC)')
    expect(defs).toMatch(/UNIQUE INDEX service_order_events_idempotency_unique .*\(organization_id, idempotency_key\)/)
  })

  it('[OSH-023] RLS ligado e nenhuma policy (só service_role acessa)', () => {
    expect(psqlRaw(`SELECT relrowsecurity FROM pg_class WHERE oid='public.${TABLE}'::regclass`)).toBe('t')
    expect(psqlRaw(`SELECT count(*) FROM pg_policies WHERE tablename='${TABLE}'`)).toBe('0')
  })
})

describe.skipIf(!available || !pgReady)('[OSH-021/022] append-only', () => {
  it('UPDATE e DELETE falham pelo gatilho para dono e service_role; linha intacta', async () => {
    const { id } = await insertEvent({ payload: { amount: 10 } })
    for (const role of [undefined, 'service_role']) {
      expect(psqlFails(`UPDATE public.${TABLE} SET event_type='x' WHERE id='${id}'`, role)).toMatch(/append-only/)
      expect(psqlFails(`DELETE FROM public.${TABLE} WHERE id='${id}'`, role)).toMatch(/append-only/)
    }
    const { data } = await adminDb().from(TABLE).select('event_type, payload').eq('id', id).single()
    expect(data).toEqual({ event_type: 'installment.paid', payload: { amount: 10 } })
  }, 60_000)

  it('authenticated: mesmo com GRANT concedido (dentro de transação sem commit) não altera nem apaga nenhuma linha', async () => {
    const { id } = await insertEvent()
    // O GRANT fica só na transação (sem COMMIT, o psql encerra com rollback). RLS sem policy filtra as linhas
    // antes do gatilho: 0 afetadas, nenhuma exceção. O que importa é a linha continuar intacta.
    const out = psqlRaw(`BEGIN;
      GRANT ALL ON public.${TABLE} TO authenticated;
      SET ROLE authenticated;
      WITH u AS (UPDATE public.${TABLE} SET event_type='x' WHERE id='${id}' RETURNING 1) SELECT 'upd:' || count(*) FROM u;
      WITH d AS (DELETE FROM public.${TABLE} WHERE id='${id}' RETURNING 1) SELECT 'del:' || count(*) FROM d;`)
    expect(out).toContain('upd:0')
    expect(out).toContain('del:0')
    const { data } = await adminDb().from(TABLE).select('event_type').eq('id', id).single()
    expect(data?.event_type).toBe('installment.paid')
  })

  it('TRUNCATE negado a service_role, anon e authenticated', () => {
    for (const role of ['service_role', 'anon', 'authenticated']) {
      expect(psqlFails(`TRUNCATE public.${TABLE}`, role)).toMatch(/permission denied/)
    }
  }, 60_000)
})

describe.skipIf(!available || !pgReady)('[OSH-023] anon e authenticated sem acesso', () => {
  it('SELECT e INSERT negados por privilégio (psql)', () => {
    const org = randomUUID()
    for (const role of ['anon', 'authenticated']) {
      expect(psqlFails(`SELECT * FROM public.${TABLE}`, role)).toMatch(/permission denied/)
      expect(psqlFails(sqlRow(org), role)).toMatch(/permission denied/)
    }
  }, 60_000)

  it('PostgREST com a chave anon não lê nem grava', async () => {
    const headers = { apikey: TEST_ENV.anonKey, Authorization: `Bearer ${TEST_ENV.anonKey}`, 'Content-Type': 'application/json' }
    const read = await fetch(`${TEST_ENV.url}/rest/v1/${TABLE}?select=id&limit=1`, { headers })
    expect(read.status).toBeGreaterThanOrEqual(400)
    expect(read.status).toBeLessThan(500)
    const write = await fetch(`${TEST_ENV.url}/rest/v1/${TABLE}`, { method: 'POST', headers, body: JSON.stringify({ organization_id: randomUUID() }) })
    expect(write.status).toBeGreaterThanOrEqual(400)
    expect(write.status).toBeLessThan(500)
  })

  it('service_role escreve e lê', async () => {
    const e = await insertEvent()
    const { data } = await adminDb().from(TABLE).select('id').eq('id', e.id)
    expect(data).toHaveLength(1)
  })
})

describe.skipIf(!available)('[OSH-024/025] idempotência (organization_id, idempotency_key)', () => {
  const count = async (org: string, key?: string) => {
    let q = adminDb().from(TABLE).select('id', { count: 'exact', head: true }).eq('organization_id', org)
    if (key) q = q.eq('idempotency_key', key)
    const { count: c, error } = await q
    expect(error).toBeNull()
    return c
  }
  const upsert = (row: Record<string, unknown>) =>
    adminDb().from(TABLE).upsert(row, { onConflict: 'organization_id,idempotency_key', ignoreDuplicates: true })
  const base = (org: string, key: string | null) => ({
    organization_id: org, service_order_id: randomUUID(), event_type: 'installment.paid', category: 'payment', visibility: 'financial',
    correlation_id: randomUUID(), source_code: 'os_detail', source_label: 'x', source_trust: 'declared', idempotency_key: key
  })

  it('mesma chave na mesma org: 1 linha, sem erro; em outra org: aceita; chave NULL repetida: aceita', async () => {
    const [a, b] = [randomUUID(), randomUUID()]
    const key = `k-${randomUUID()}`
    expect((await upsert(base(a, key))).error).toBeNull()
    expect((await upsert(base(a, key))).error).toBeNull()
    expect(await count(a, key)).toBe(1)

    expect((await upsert(base(b, key))).error).toBeNull()
    expect(await count(b, key)).toBe(1)

    expect((await adminDb().from(TABLE).insert(base(a, null))).error).toBeNull()
    expect((await adminDb().from(TABLE).insert(base(a, null))).error).toBeNull()
    expect(await count(a)).toBe(3)
  })

  it('INSERT puro com chave repetida na mesma org falha com 23505', async () => {
    const org = randomUUID()
    const key = `k-${randomUUID()}`
    expect((await adminDb().from(TABLE).insert(base(org, key))).error).toBeNull()
    const dup = await adminDb().from(TABLE).insert(base(org, key))
    expect(dup.error?.code).toBe('23505')
  })

  it('10 gravações concorrentes com a mesma chave: exatamente 1 linha e nenhuma com erro', async () => {
    const org = randomUUID()
    const key = `k-${randomUUID()}`
    const results = await Promise.all(Array.from({ length: 10 }, () => upsert(base(org, key))))
    expect(results.map(r => r.error)).toEqual(Array(10).fill(null))
    expect(await count(org, key)).toBe(1)
  })
})

describe.skipIf(!available)('[OSH-026] ordem e seq', () => {
  it('3 eventos com o mesmo occurred_at: seq estritamente crescente, na ordem de inserção; seq não é reaproveitado após falha', async () => {
    const org = randomUUID()
    const so = randomUUID()
    const at = '2026-11-13T12:00:00.000Z'
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push((await insertEvent({ organization_id: org, service_order_id: so, occurred_at: at, payload: { i } })).id)

    const failed = await adminDb().from(TABLE).insert({ organization_id: org, service_order_id: so, event_type: 'x', category: 'INVALIDA', visibility: 'general', correlation_id: randomUUID(), source_code: 'os_detail', source_label: 'x', source_trust: 'declared' })
    expect(failed.error?.code).toBe('23514')
    ids.push((await insertEvent({ organization_id: org, service_order_id: so, occurred_at: at, payload: { i: 3 } })).id)

    const { data } = await adminDb().from(TABLE).select('id, seq').eq('organization_id', org).order('occurred_at').order('seq')
    expect(data!.map(r => r.id)).toEqual(ids)
    const seqs = data!.map(r => Number(r.seq))
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!)
  })
})

describe.skipIf(!available)('[OSH-027] campos obrigatórios e CHECKs (Q4 resolvida na migration: há CHECK)', () => {
  const valid = () => ({
    organization_id: randomUUID(), service_order_id: randomUUID(), event_type: 'installment.paid', category: 'payment', visibility: 'financial',
    correlation_id: randomUUID(), source_code: 'os_detail', source_label: 'x', source_trust: 'declared'
  })
  it.each(['source_code', 'source_label', 'source_trust', 'correlation_id', 'organization_id', 'service_order_id', 'event_type'])('sem %s: rejeita (NOT NULL 23502)', async (field) => {
    const row: Record<string, unknown> = valid()
    delete row[field]
    expect((await adminDb().from(TABLE).insert(row)).error?.code).toBe('23502')
  })
  it.each([['visibility', 'secret'], ['source_trust', 'trusted'], ['category', 'other'], ['actor_type', 'robot'], ['origin', 'import']])('%s=%s fora do conjunto: rejeita (CHECK 23514)', async (field, value) => {
    expect((await adminDb().from(TABLE).insert({ ...valid(), [field]: value })).error?.code).toBe('23514')
  })
})
