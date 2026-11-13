import { requireOrgPermission } from '../require-org-permission'
import type { OsEventVisibility } from './record'

/** Permissão que libera cada visibilidade (além de `orders.read`, que libera `general`). */
export const VISIBILITY_PERMISSION: Record<Exclude<OsEventVisibility, 'general'>, string> = {
  // Mesmo gate que o servidor já exige para receber na OS (route-map V5).
  financial: 'orders.pay',
  // Gate de ver comissão por funcionário (D4 do desenho, a confirmar no rollout de acesso).
  commission: 'reports.commissions'
}

async function can(userId: string, code: string): Promise<boolean> {
  try {
    await requireOrgPermission(userId, code)
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
