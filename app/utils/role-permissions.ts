import { useRoleResources } from '../composables/useRoleResources'
import { getActionDescription } from '../constants/action-descriptions'

export type PermissionAction = {
  id: string
  code: string
  name: string | null
  description: string | null
  resource: string | null
}

export type PermissionState = Record<string, boolean>

export type PermissionGroup = {
  resource: string
  label: string
  icon: string
  actions: PermissionAction[]
}

/** Minusculo e sem acentos, para busca. */
export function normalizeSearchText(text: string | null | undefined): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Agrupa por resource e ordena os grupos pelo rotulo (pt-BR). */
export function groupActionsByResource(
  actions: PermissionAction[]
): PermissionGroup[] {
  const { formatResourceLabel, getResourceIcon } = useRoleResources()
  const map = new Map<string, PermissionAction[]>()

  for (const action of actions) {
    const key = action.resource || 'Geral'
    const list = map.get(key)
    if (list) list.push(action)
    else map.set(key, [action])
  }

  return [...map.entries()]
    .map(([resource, groupActions]) => ({
      resource,
      label: formatResourceLabel(resource),
      icon: getResourceIcon(resource),
      actions: groupActions
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

export function countGranted(
  actions: PermissionAction[],
  state: PermissionState
): number {
  return actions.reduce((total, a) => total + (state[a.id] ? 1 : 0), 0)
}

/** Ids das acoes cujo valor atual difere do original. */
export function diffPermissions(
  actions: PermissionAction[],
  original: PermissionState,
  current: PermissionState
): string[] {
  return actions
    .filter(a => Boolean(current[a.id]) !== Boolean(original[a.id]))
    .map(a => a.id)
}

/**
 * Descricao de uma linha da permissao: mapa local (pt-BR) -> `description` da API se diferir do titulo -> null.
 * Nunca devolve o codigo tecnico.
 */
export function permissionDescription(action: PermissionAction): string | null {
  const mapped = getActionDescription(action.code)
  if (mapped) return mapped

  const apiDescription = action.description?.trim()
  if (
    apiDescription
    && normalizeSearchText(apiDescription) !== normalizeSearchText(action.name)
    && normalizeSearchText(apiDescription) !== normalizeSearchText(action.code)
  ) return apiDescription

  return null
}

/** Filtra por busca (nome+codigo+descricao) e, opcionalmente, so marcadas. */
export function filterActions(
  actions: PermissionAction[],
  query: string,
  onlyGranted: boolean,
  state: PermissionState
): PermissionAction[] {
  const q = normalizeSearchText(query)

  return actions.filter((a) => {
    if (onlyGranted && !state[a.id]) return false
    if (!q) return true

    return normalizeSearchText(`${a.name ?? ''} ${a.code} ${a.description ?? ''} ${permissionDescription(a) ?? ''}`).includes(q)
  })
}

/** Id de DOM seguro (a-z, 0-9, hifen) para o painel de um grupo; `resource` cru pode ter caracteres invalidos. */
export function permissionPanelId(resource: string): string {
  const slug = normalizeSearchText(resource)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `perm-group-${slug || 'geral'}`
}

/** Rotulo visivel do checkbox de grupo e aria-label que comeca pelo texto visivel (WCAG 2.5.3). */
export function groupCheckboxLabels(
  filterActive: boolean,
  groupLabel: string
): { visible: string, aria: string } {
  return filterActive
    ? { visible: 'Marcar resultados', aria: `Marcar resultados de ${groupLabel}` }
    : { visible: 'Marcar todas', aria: `Marcar todas as permissões de ${groupLabel}` }
}

/** Retorna novo estado com todas as acoes informadas no valor dado. */
export function setGroup(
  state: PermissionState,
  actions: PermissionAction[],
  value: boolean
): PermissionState {
  const next = { ...state }
  for (const a of actions) next[a.id] = value
  return next
}

type SortableRole = { is_system_role: boolean, display_name: string | null, name: string }

function roleSortName(role: SortableRole): string {
  return role.display_name?.trim() || role.name
}

/** Papeis de sistema primeiro (ordem original preservada); depois personalizados por nome (pt-BR). Nao muta a entrada. */
export function sortRolesForList<T extends SortableRole>(roles: readonly T[]): T[] {
  const system = roles.filter(r => r.is_system_role)
  const custom = roles
    .filter(r => !r.is_system_role)
    .sort((a, b) => roleSortName(a).localeCompare(roleSortName(b), 'pt-BR'))
  return [...system, ...custom]
}

/** Rotulo singular/plural; valor ausente vira 0. */
export function pluralLabel(count: number | null | undefined, singular: string, plural: string): string {
  const n = typeof count === 'number' ? count : 0
  return `${n} ${n === 1 ? singular : plural}`
}

export const roleUsersLabel = (count: number | null | undefined) => pluralLabel(count, 'usuário', 'usuários')
export const rolePermissionsLabel = (count: number | null | undefined) => pluralLabel(count, 'permissão', 'permissões')
