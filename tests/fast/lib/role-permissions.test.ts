import { ResourceType } from '../../../app/composables/useRoleResources'
import { describe, expect, it } from 'vitest'
import {
  countGranted,
  diffPermissions,
  filterActions,
  filterModulesByName,
  grantedOfTotalLabel,
  groupActionsByResource,
  groupCheckboxLabels,
  normalizeSearchText,
  permissionPanelId,
  rolePermissionsLabel,
  roleUsersLabel,
  setGroup,
  sortRolesForList,
  summarizeModules,
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

  it('permissionPanelId gera id seguro e estavel', () => {
    expect(permissionPanelId('service_orders')).toBe('perm-group-service-orders')
    expect(permissionPanelId('Ações / Gerais!')).toBe('perm-group-acoes-gerais')
    expect(permissionPanelId('***')).toBe('perm-group-geral')
  })

  it('aria-label do checkbox de grupo comeca pelo texto visivel', () => {
    for (const active of [true, false]) {
      const { visible, aria } = groupCheckboxLabels(active, 'Agenda')
      expect(aria.startsWith(visible)).toBe(true)
      expect(aria).toContain('Agenda')
    }
    expect(groupCheckboxLabels(true, 'X').visible).toBe('Marcar resultados')
    expect(groupCheckboxLabels(false, 'X').visible).toBe('Marcar todas')
  })

  it('setGroup nao muta o original', () => {
    const state = { 1: false }
    const next = setGroup(state, actions.slice(0, 2), true)
    expect(next).toEqual({ 1: true, 2: true })
    expect(state).toEqual({ 1: false })
  })
})

describe('sortRolesForList / rótulos de contagem', () => {
  const r = (name: string, sys: boolean) => ({ id: name, name, display_name: name, is_system_role: sys })

  it('sistema primeiro (ordem original), depois personalizados em pt-BR', () => {
    const input = [r('Marcineia', false), r('Administrador', true), r('Funcionário', true), r('Álvaro', false), r('Gerente', true), r('Anderson', false)]
    const out = sortRolesForList(input).map(x => x.name)
    expect(out).toEqual(['Administrador', 'Funcionário', 'Gerente', 'Álvaro', 'Anderson', 'Marcineia'])
    expect(input[0]!.name).toBe('Marcineia')
  })

  it('usa name quando display_name vazio', () => {
    const out = sortRolesForList([{ ...r('b', false), display_name: null }, r('A', false)]).map(x => x.name)
    expect(out).toEqual(['A', 'b'])
  })

  it('singular/plural e zero', () => {
    expect(roleUsersLabel(0)).toBe('0 usuários')
    expect(roleUsersLabel(1)).toBe('1 usuário')
    expect(roleUsersLabel(2)).toBe('2 usuários')
    expect(roleUsersLabel(undefined)).toBe('0 usuários')
    expect(rolePermissionsLabel(1)).toBe('1 permissão')
    expect(rolePermissionsLabel(105)).toBe('105 permissões')
  })

  it('rotulo "N de M"', () => {
    expect(grantedOfTotalLabel(105, 107)).toBe('105 de 107')
    expect(grantedOfTotalLabel(undefined, null)).toBe('0 de 0')
  })

  it('resume modulos com contagem de liberadas', () => {
    const mods = summarizeModules(actions, new Set(['2', '1']))
    expect(mods.map(m => [m.label, m.granted, m.total])).toEqual([
      ['Agendamentos', 1, 2],
      ['Geral', 0, 1],
      ['Papéis', 1, 1]
    ])
    expect(mods[0]!.grantedActions.map(a => a.id)).toEqual(['2'])
  })

  it('busca modulo parcial, sem acento e sem caixa', () => {
    const mods = summarizeModules(actions, new Set())
    expect(filterModulesByName(mods, 'PAPEIS').map(m => m.label)).toEqual(['Papéis'])
    expect(filterModulesByName(mods, 'agend').map(m => m.label)).toEqual(['Agendamentos'])
    expect(filterModulesByName(mods, '  ')).toHaveLength(3)
    expect(filterModulesByName(mods, 'zzz')).toEqual([])
  })
})
