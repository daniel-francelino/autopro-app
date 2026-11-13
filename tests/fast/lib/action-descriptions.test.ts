import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ActionCode } from '../../../app/constants/action-codes'
import { ACTION_DESCRIPTIONS, getActionDescription } from '../../../app/constants/action-descriptions'
import { filterActions, permissionDescription, type PermissionAction } from '../../../app/utils/role-permissions'

const catalog: Array<{ code: string, name: string, resource: string, description: string }> = JSON.parse(
  readFileSync(join(__dirname, '../../static/fixtures/actions-prod-103.json'), 'utf8')
)
const enumCodes = new Set<string>(Object.values(ActionCode))

describe('descricoes de permissoes', () => {
  it('todo codigo do catalogo tem descricao nao vazia de uma linha', () => {
    for (const { code } of catalog) {
      const d = getActionDescription(code)
      expect(d, code).toBeTruthy()
      expect(d, code).not.toMatch(/[\r\n]/)
      expect(d!.length, code).toBeLessThanOrEqual(100)
      expect(d, code).not.toBe(code)
    }
  })

  it('todo codigo do enum tem descricao e nao ha chaves orfas', () => {
    const catalogCodes = new Set(catalog.map(a => a.code))
    for (const key of Object.keys(ACTION_DESCRIPTIONS)) {
      expect(enumCodes.has(key) || catalogCodes.has(key), `orfa: ${key}`).toBe(true)
    }
    for (const code of enumCodes) expect(ACTION_DESCRIPTIONS[code as ActionCode], code).toBeTruthy()
  })
})

const mk = (code: string, name: string, description: string | null): PermissionAction => ({
  id: code, code, name, description, resource: code.split('.')[0]!
})

describe('permissionDescription (fallback)', () => {
  it('usa o mapa quando o codigo existe', () => {
    expect(permissionDescription(mk('authorizations.approve', 'Aprovar Autorizações', 'Aprovar Autorizações')))
      .toBe(ACTION_DESCRIPTIONS[ActionCode.AUTHORIZATIONS_APPROVE])
  })
  it('sem mapa: usa a descricao da API se diferir do titulo', () => {
    expect(permissionDescription(mk('novo.codigo', 'Novo', 'Faz algo novo'))).toBe('Faz algo novo')
  })
  it('sem mapa e descricao igual ao titulo ou ao codigo: nada (nunca o codigo)', () => {
    expect(permissionDescription(mk('novo.codigo', 'Novo', 'novo'))).toBeNull()
    expect(permissionDescription(mk('novo.codigo', 'Novo', 'novo.codigo'))).toBeNull()
    expect(permissionDescription(mk('novo.codigo', 'Novo', null))).toBeNull()
  })
})

describe('busca com descricao', () => {
  const actions = [
    mk('authorizations.approve', 'Aprovar Autorizações', 'Aprovar Autorizações'),
    mk('customers.read', 'Visualizar Clientes', 'Visualizar Clientes')
  ]
  it('acha por descricao do mapa, sem acento', () => {
    expect(filterActions(actions, 'SOLICITACOES de compra', false, {}).map(a => a.id)).toEqual(['authorizations.approve'])
  })
  it('continua achando por titulo e por codigo', () => {
    expect(filterActions(actions, 'clientes', false, {}).map(a => a.id)).toEqual(['customers.read'])
    expect(filterActions(actions, 'customers.read', false, {}).map(a => a.id)).toEqual(['customers.read'])
  })
})
