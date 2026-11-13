import { useRoleResources } from '../composables/useRoleResources'

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

    return normalizeSearchText(`${a.name ?? ''} ${a.code} ${a.description ?? ''}`).includes(q)
  })
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
