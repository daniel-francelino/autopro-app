// Fake mínimo do SupabaseClient para testes L2: tabelas em memória + registro das escritas.
// Só implementa o encadeamento usado pelos utilitários de servidor.
import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, any>
type Filter = (row: Row) => boolean

export interface FakeWrite {
  table: string
  op: 'insert' | 'update' | 'delete' | 'upsert'
  values?: Row | Row[]
  filters: string[]
}

export interface FakeSupabase {
  client: SupabaseClient
  tables: Record<string, Row[]>
  writes: FakeWrite[]
  /** Faz a próxima consulta da tabela devolver este erro. */
  failNext: (table: string, message?: string) => void
}

export function createFakeSupabase(seed: Record<string, Row[]> = {}): FakeSupabase {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map(r => ({ ...r }))
  const writes: FakeWrite[] = []
  const failures = new Map<string, string>()
  let idCounter = 0

  function from(table: string) {
    tables[table] ||= []
    const filters: Filter[] = []
    const filterLabels: string[] = []
    let mode: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
    let payload: Row | Row[] | undefined
    let head = false
    let wantCount = false
    let limitN: number | null = null
    let orderBy: { col: string, asc: boolean } | null = null

    const addFilter = (label: string, fn: Filter) => {
      filters.push(fn)
      filterLabels.push(label)
    }

    const matching = () => tables[table]!.filter(row => filters.every(f => f(row)))

    function run() {
      const failure = failures.get(table)
      if (failure) {
        failures.delete(table)
        return { data: null, error: { message: failure }, count: null }
      }

      if (mode === 'insert' || mode === 'upsert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map(r => ({ id: `fake-${++idCounter}`, ...r }))
        tables[table]!.push(...list)
        writes.push({ table, op: mode, values: payload, filters: filterLabels })
        return { data: list, error: null, count: null }
      }
      if (mode === 'update') {
        const rows = matching()
        rows.forEach(r => Object.assign(r, payload))
        writes.push({ table, op: 'update', values: payload, filters: filterLabels })
        return { data: rows, error: null, count: null }
      }
      if (mode === 'delete') {
        const rows = matching()
        tables[table] = tables[table]!.filter(r => !rows.includes(r))
        writes.push({ table, op: 'delete', filters: filterLabels })
        return { data: rows, error: null, count: null }
      }

      let rows = matching()
      if (orderBy) {
        const { col, asc } = orderBy
        rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1))
      }
      const count = wantCount ? rows.length : null
      if (limitN !== null) rows = rows.slice(0, limitN)
      return { data: head ? null : rows, error: null, count }
    }

    const builder: any = {
      select(_cols?: string, opts?: { count?: string, head?: boolean }) {
        if (mode === 'select') mode = 'select'
        head = !!opts?.head
        wantCount = !!opts?.count
        return builder
      },
      insert(values: Row | Row[]) { mode = 'insert'; payload = values; return builder },
      upsert(values: Row | Row[]) { mode = 'upsert'; payload = values; return builder },
      update(values: Row) { mode = 'update'; payload = values; return builder },
      delete() { mode = 'delete'; return builder },
      eq(col: string, val: unknown) { addFilter(`${col}=${val}`, r => r[col] === val); return builder },
      neq(col: string, val: unknown) { addFilter(`${col}!=${val}`, r => r[col] !== val); return builder },
      is(col: string, val: unknown) { addFilter(`${col} is ${val}`, r => (val === null ? r[col] == null : r[col] === val)); return builder },
      in(col: string, vals: unknown[]) { addFilter(`${col} in`, r => vals.includes(r[col])); return builder },
      gt(col: string, val: any) { addFilter(`${col}>${val}`, r => r[col] > val); return builder },
      gte(col: string, val: any) { addFilter(`${col}>=${val}`, r => r[col] >= val); return builder },
      lt(col: string, val: any) { addFilter(`${col}<${val}`, r => r[col] < val); return builder },
      lte(col: string, val: any) { addFilter(`${col}<=${val}`, r => r[col] <= val); return builder },
      ilike(col: string, pattern: string) {
        const needle = pattern.replace(/^%|%$/g, '').replace(/\\([%_])/g, '$1').toLowerCase()
        addFilter(`${col} ilike ${pattern}`, r => String(r[col] ?? '').toLowerCase().includes(needle))
        return builder
      },
      or() { return builder },
      order(col: string, opts?: { ascending?: boolean }) { orderBy = { col, asc: opts?.ascending !== false }; return builder },
      limit(n: number) { limitN = n; return builder },
      range(from: number, to: number) { limitN = to - from + 1; return builder },
      maybeSingle() {
        const res = run()
        const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data
        return Promise.resolve({ ...res, data })
      },
      single() {
        const res = run()
        const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data
        return Promise.resolve(data || res.error ? { ...res, data } : { ...res, data: null, error: { message: 'No rows' } })
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject)
      }
    }
    return builder
  }

  return {
    client: { from } as unknown as SupabaseClient,
    tables,
    writes,
    failNext: (table, message = 'fake failure') => failures.set(table, message)
  }
}
