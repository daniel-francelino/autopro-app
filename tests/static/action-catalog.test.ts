// L0 — Fase 2 do plano de controle de acesso: catálogo de actions, enum e concessões R2.
// Ver docs/engineering/access-control-rollout-plan.md, seção 7.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ActionCode } from '../../app/constants/action-codes'
import { ROOT, read } from '../support/source-scan'

interface ActionRow { code: string, name: string, resource: string, action_type: string, description: string, created_by: string | null }

const expected: ActionRow[] = JSON.parse(readFileSync(join(ROOT, 'tests/static/fixtures/actions-prod-103.json'), 'utf8'))
const MIG = 'supabase/migrations/'
const code = (sql: string) => sql.replace(/--.*$/gm, '')
const noWrites = (sql: string) => expect(code(sql).replace(/'(?:[^']|'')*'/g, '\'\'')).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE)\b/)

/** Lê as tuplas ('a', 'b', ...) de um bloco VALUES, respeitando '' como aspa escapada. */
function parseValues(sql: string): (string | null)[][] {
  const body = sql.replace(/^--.*$/gm, '')
  const values = body.slice(body.indexOf('VALUES') + 6, body.lastIndexOf('ON CONFLICT'))
  const rows: (string | null)[][] = []
  let i = 0
  while (i < values.length) {
    if (values[i] !== '(') { i++; continue }
    i++
    const row: (string | null)[] = []
    while (values[i] !== ')') {
      if (values[i] === '\'') {
        let s = ''
        i++
        for (;;) {
          if (values[i] === '\'' && values[i + 1] === '\'') { s += '\''; i += 2 } else if (values[i] === '\'') { i++; break } else { s += values[i++] }
        }
        row.push(s)
      } else if (values.startsWith('NULL', i)) { row.push(null); i += 4 } else i++
    }
    i++
    rows.push(row)
  }
  return rows
}

describe('L0: migração 105 (catálogo de actions)', () => {
  const sql = read(`${MIG}20240101000105_sync_actions_catalog.sql`)
  const rows = parseValues(sql).map(([code, name, resource, action_type, description, created_by]) => ({ code, name, resource, action_type, description, created_by }))

  it('the fixture has 103 unique codes', () => {
    expect(expected).toHaveLength(103)
    expect(new Set(expected.map(r => r.code)).size).toBe(103)
  })

  it('has exactly the 103 production rows (all fields, same order)', () => {
    expect(rows).toEqual(expected)
  })

  it('is idempotent, a single insert into actions, grants nothing', () => {
    expect(code(sql).match(/INSERT INTO public\.actions/g)).toHaveLength(1)
    expect(code(sql).match(/ON CONFLICT \(code\) DO NOTHING/g)).toHaveLength(1)
    expect(code(sql)).not.toMatch(/role_actions/i)
    noWrites(sql)
  })

  it('contains no e-mail (privacy) in the migration or the fixture', () => {
    expect(sql).not.toContain('@')
    expect(readFileSync(join(ROOT, 'tests/static/fixtures/actions-prod-103.json'), 'utf8')).not.toContain('@')
  })
})

describe('L0: enum ActionCode (Fase 2.3)', () => {
  const values = Object.values(ActionCode) as string[]

  it.each(['bank_accounts.view', 'roles.read', 'members.delete', 'orders.pay', 'employees.pay', 'fiscal.manage', 'subscription.manage', 'roles.manage_permissions', 'roles.manage_members', 'bank_accounts.create', 'bank_accounts.update', 'bank_accounts.delete'])(
    'contains %s', (code) => { expect(values).toContain(code) })

  it.each(['bank_accounts.read', 'roles.view', 'members.remove', 'orders.finish', 'inventory.adjust', 'purchases.authorize'])(
    'does not contain %s', (code) => { expect(values).not.toContain(code) })

  it('every enum code that is not in the 103 production rows is seeded by 104, 107 or 109', () => {
    const prod = new Set(expected.map(r => r.code))
    const extra = values.filter(c => !prod.has(c)).sort()
    expect(extra).toEqual(['bank_accounts.create', 'bank_accounts.delete', 'orders.history', 'roles.manage_members', 'roles.manage_permissions'])
    const seed = read(`${MIG}20240101000104_seed_missing_action_codes.sql`) + read(`${MIG}20240101000107_seed_roles_manage_codes.sql`) + read(`${MIG}20240101000109_seed_orders_history_action.sql`)
    for (const c of extra) expect(seed).toContain(`'${c}'`)
  })
})

describe('L0: migrações de seed e concessão (Fase 2.2)', () => {
  const seed104 = read(`${MIG}20240101000104_seed_missing_action_codes.sql`)
  const grant106 = read(`${MIG}20240101000106_grant_bank_accounts_create_delete.sql`)
  const seed107 = read(`${MIG}20240101000107_seed_roles_manage_codes.sql`)
  const codesIn = (sql: string) => [...sql.replace(/^--.*$/gm, '').matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]).sort()

  it('104 seeds only bank_accounts.create/delete and grants nothing', () => {
    expect(codesIn(seed104)).toEqual(['bank_accounts.create', 'bank_accounts.delete'])
    expect(code(seed104)).not.toMatch(/role_actions/i)
    noWrites(seed104)
  })

  it('106 grants only bank_accounts.create/delete, keyed on bank_accounts.update, idempotent', () => {
    expect(codesIn(grant106)).toEqual(['bank_accounts.create', 'bank_accounts.delete', 'bank_accounts.update'])
    expect(grant106).toMatch(/upd\.code = 'bank_accounts\.update'/)
    expect(grant106).toMatch(/new_action\.code IN \('bank_accounts\.create', 'bank_accounts\.delete'\)/)
    expect(grant106).toMatch(/JOIN public\.roles r\s+ON r\.id = ra\.role_id\s+AND r\.deleted_at IS NULL/)
    expect(codesIn(grant106).filter(c => c !== 'bank_accounts.update').sort()).toEqual(['bank_accounts.create', 'bank_accounts.delete'])
    noWrites(grant106)
    expect(grant106).toMatch(/ra\.is_granted = true/)
    expect(grant106).toMatch(/ra\.deleted_at IS NULL/)
    expect(grant106).toMatch(/'migration-104'/)
    expect(grant106).toMatch(/ON CONFLICT \(role_id, action_id\) DO NOTHING/)
  })

  it('107 seeds roles.manage_* and grants nothing', () => {
    expect(codesIn(seed107)).toEqual(['roles.manage_members', 'roles.manage_permissions'])
    expect(code(seed107)).not.toMatch(/role_actions/i)
    noWrites(seed107)
  })
})

describe('L0: migração 109 (orders.history)', () => {
  const sql = read(`${MIG}20240101000109_seed_orders_history_action.sql`)
  it('seeds only orders.history (read), idempotent, grants nothing', () => {
    const rows = parseValues(sql)
    expect(rows).toEqual([['orders.history', 'Ver histórico da OS', 'orders', 'read', 'Permite ver o histórico (linha do tempo) da ordem de serviço.', 'migration']])
    expect(code(sql)).toMatch(/ON CONFLICT \(code\) DO NOTHING/)
    expect(code(sql)).not.toMatch(/role_actions/i)
    noWrites(sql)
  })
})
