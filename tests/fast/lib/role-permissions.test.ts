import { ResourceType } from '../../../app/composables/useRoleResources'
import { describe, expect, it } from 'vitest'
import {
  countGranted,
  diffPermissions,
  filterActions,
  groupActionsByResource,
  normalizeSearchText,
  setGroup,
  type PermissionAction
} from '../../../app/utils/role-permissions'

const mk = (id: string, resource: string | null, name: string, description: string | null = null): PermissionAction => ({
  id, code: `${resource}.${id}`, name, description, resource
})

const actions = [
  mk('1', ResourceType.ROLES, 'Criar papéis'),
  mk('2', ResourceType.APPOINTMENTS, 'Ver agenda', 'Consultar horários'),
  mk('3', ResourceType.APPOINTMENTS, 'Editar agenda'),
  mk('4', null, 'Algo geral')
]

describe('role-permissions', () => {
  it('normaliza acentos e caixa', () => {
    expect(normalizeSearchText('  Ações ')).toBe('acoes')
  })

  it('agrupa e ordena por rotulo pt-BR', () => {
    const groups = groupActionsByResource(actions)
    expect(groups.map(g => g.label)).toEqual(['Agendamentos', 'Geral', 'Papéis'])
    expect(groups[0]!.actions).toHaveLength(2)
  })

  it('conta marcadas', () => {
    expect(countGranted(actions, { 1: true, 2: true, 3: false })).toBe(2)
  })

  it('diff retorna so ids alterados', () => {
    expect(diffPermissions(actions, { 1: true, 2: false }, { 1: true, 2: true, 3: false })).toEqual(['2'])
    expect(diffPermissions(actions, {}, {})).toEqual([])
  })

  it('filtra por busca sem acento e por marcadas', () => {
    expect(filterActions(actions, 'HORARIOS', false, {}).map(a => a.id)).toEqual(['2'])
    expect(filterActions(actions, 'agenda', true, { 3: true }).map(a => a.id)).toEqual(['3'])
    expect(filterActions(actions, 'zzz', false, {})).toEqual([])
    expect(filterActions(actions, '', false, {})).toHaveLength(4)
  })

  it('setGroup nao muta o original', () => {
    const state = { 1: false }
    const next = setGroup(state, actions.slice(0, 2), true)
    expect(next).toEqual({ 1: true, 2: true })
    expect(state).toEqual({ 1: false })
  })
})
