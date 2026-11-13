// L3 (banco LOCAL) — o filtro real do PostgREST para o escopo de papeis (RE-01 / D-1).
// Roda só com Supabase local no ar; sem ele o arquivo é PULADO. adminDb() recusa URL não local.
// NÃO foi executado ao ser escrito (regra: nunca rodar contra o banco real; Docker/local indisponível).
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, inject, it } from 'vitest'
import { adminDb } from '../support/db'
import { createOrg, deleteOrgs } from '../support/factories'
import { roleScopeFilter } from '../../server/utils/role-scope'

const available = inject('apiAvailable')
const orgIds: string[] = []
const roleIds: string[] = []

afterAll(async () => {
  if (!available) return
  if (roleIds.length) await adminDb().from('roles').delete().in('id', roleIds)
  await deleteOrgs(orgIds)
})

async function insertRole(organization_id: string | null, is_system_role: boolean) {
  const name = `t-${randomUUID().slice(0, 8)}`
  const { data, error } = await adminDb()
    .from('roles')
    .insert({ organization_id, name, display_name: name, is_system_role })
    .select('id')
    .single()
  if (error) throw new Error(`insertRole: ${error.message}`)
  roleIds.push(data.id as string)
  return data.id as string
}

describe.skipIf(!available)('banco: escopo de papeis por organizacao (roleScopeFilter)', () => {
  it('devolve globais e da propria org; nunca papel de sistema de outra org', async () => {
    const [a, b] = [await createOrg(), await createOrg()]
    orgIds.push(a.id, b.id)
    const global = await insertRole(null, true)
    const sysA = await insertRole(a.id, true)
    const sysB = await insertRole(b.id, true)
    const customB = await insertRole(b.id, false)

    const { data, error } = await adminDb()
      .from('roles')
      .select('id')
      .or(roleScopeFilter(a.id))
      .in('id', [global, sysA, sysB, customB])
    expect(error).toBeNull()
    const ids = (data ?? []).map(r => r.id as string).sort()
    expect(ids).toEqual([global, sysA].sort())
  })
})
