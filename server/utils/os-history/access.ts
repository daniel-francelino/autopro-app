import { createError, type H3Event } from 'h3'
import { requireOrgPermission } from '../require-org-permission'
import type { OsEventVisibility } from './record'

/** Permissão dedicada que abre o histórico da OS (seção 11.2 do desenho). Sem ela, nada do histórico é consultado. */
export const HISTORY_PERMISSION = 'orders.history'

/** Permissão que libera cada visibilidade (além de `orders.history`, que libera `general`). */
export const VISIBILITY_PERMISSION: Record<Exclude<OsEventVisibility, 'general'>, string> = {
  // Mesmo gate que o servidor já exige para receber na OS (route-map V5).
  financial: 'orders.pay',
  // Gate de ver comissão por funcionário (D4 do desenho, a confirmar no rollout de acesso).
  commission: 'reports.commissions'
}

async function can(userId: string, code: string, event?: H3Event): Promise<boolean> {
  try {
    await requireOrgPermission(userId, code, event)
    return true
  } catch (err) {
    if ((err as { statusCode?: number })?.statusCode === 403) return false
    throw err
  }
}

/** Visibilidades que o usuário pode ver. Evento sem permissão é omitido da lista, não mascarado. */
export async function allowedVisibilities(userId: string): Promise<OsEventVisibility[]> {
  const allowed: OsEventVisibility[] = ['general']
  if (await can(userId, VISIBILITY_PERMISSION.financial)) allowed.push('financial')
  if (await can(userId, VISIBILITY_PERMISSION.commission)) allowed.push('commission')
  return allowed
}

/**
 * Exige `orders.history` (e `orders.read`, pois o histórico é de uma OS que o usuário precisa poder ver).
 * Sem permissão responde 404 com o mesmo corpo de "OS não encontrada", nunca 403, para não revelar que o
 * histórico existe. Deve ser chamada antes de qualquer consulta ao histórico.
 */
export async function requireOsHistoryAccess(userId: string, event?: H3Event): Promise<void> {
  const allowed = (await can(userId, HISTORY_PERMISSION, event)) && (await can(userId, 'orders.read'))
  if (!allowed) throw createError({ statusCode: 404, statusMessage: 'Service order not found' })
}
