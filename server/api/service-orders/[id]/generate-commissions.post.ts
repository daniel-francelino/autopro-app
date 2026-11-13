import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'
import { requireOrgPermission } from '../../../utils/require-org-permission'
import { releaseServiceOrderCommissions } from '../../../utils/service-order-commissions'
import { recordAudit } from '../../../utils/audit/record'
import { OS_EVENT_KEYS, OS_SOURCE_POLICIES, historyContext, osEvent, recordWithContext, snapshotMoney } from '../../../utils/os-history/events'

/**
 * POST /api/service-orders/:id/generate-commissions
 * Recomputes commission entitlement and release for a service order from
 * its current items, responsibles and amount already received.
 *
 * An optional `employeeId` in the body scopes the recalculation to a single
 * employee — only their records are created/adjusted, and it errors instead
 * of touching anything if that employee already has a paid commission on
 * this order. When `employeeId` is set, `reason` is required and gets
 * appended (with who/when) to the order's commission_manual_adjustments_log.
 *
 * An optional `override` alongside `employeeId`/`reason` applies or removes
 * a manual commission-plan override for that employee on this order only
 * (docs/finance/commissions-manual-override.md) — e.g. use "Comissão
 * mecânicos — plantão" instead of their usual "Comissão mecânicos — padrão",
 * just for this OS. The override plan doesn't need to be assigned to the
 * employee. It reuses the same recalculation path: the override takes
 * effect immediately in this same call (the entitlement is recomputed under
 * the override plan's rules) and is recorded in the same audit log entry.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'orders.update', event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const history = historyContext(event, OS_SOURCE_POLICIES.osDetail)
  const orderId = getRouterParam(event, 'id')
  const body = await readBody(event).catch(() => ({})) as {
    employeeId?: unknown
    reason?: unknown
    override?: {
      action?: unknown
      commissionPlanId?: unknown
    }
  }
  const employeeId = typeof body.employeeId === 'string' && body.employeeId.trim()
    ? body.employeeId.trim()
    : null
  const reason = typeof body.reason === 'string' ? body.reason.trim() : null

  const overrideAction = body.override?.action === 'apply' || body.override?.action === 'remove'
    ? body.override.action
    : null
  const overrideCommissionPlanId = typeof body.override?.commissionPlanId === 'string' && body.override.commissionPlanId.trim()
    ? body.override.commissionPlanId.trim()
    : null

  if (!orderId) {
    throw createError({ statusCode: 400, statusMessage: 'orderId is required' })
  }

  // Antes/depois por funcionário: é o recálculo que, rodado sem critério, já zerou comissões (KF-36).
  const commissionsByEmployee = async () => {
    const { data } = await supabase
      .from('employee_financial_records')
      .select('employee_id, amount, status')
      .eq('organization_id', organizationId)
      .eq('service_order_id', orderId)
      .eq('record_type', 'commission')
      .is('deleted_at', null)
    const out: Record<string, { amount: number, status: string }[]> = {}
    for (const row of data ?? []) (out[String(row.employee_id)] ||= []).push({ amount: Number(row.amount), status: String(row.status) })
    return out
  }
  const before = await commissionsByEmployee()

  const result = await releaseServiceOrderCommissions({
    supabase,
    organizationId,
    orderId,
    userEmail: authUser.email,
    userName: typeof authUser.user_metadata?.name === 'string' ? authUser.user_metadata.name : null,
    employeeId,
    reason,
    overrideAction,
    overrideCommissionPlanId,
    history
  })

  const after = await commissionsByEmployee()
  const sum = (m: Record<string, { amount: number }[]>) => Object.values(m).flat().reduce((t, r) => t + r.amount, 0)

  // Regeneração geral (sem funcionário): um resumo, só se o total mudou; o escopo por funcionário já gera `commission.recalculated`.
  if (!employeeId && Math.abs(sum(before) - sum(after)) >= 0.01) {
    await recordWithContext(history, supabase, async () => {
      return [osEvent('commission.regenerated', {
        organizationId,
        serviceOrderId: orderId,
        entityType: 'service_order',
        entityId: orderId,
        idempotencyKey: OS_EVENT_KEYS.commissionRegenerated(orderId, history.scope!)
      }, { total_before: snapshotMoney(sum(before)), total_after: snapshotMoney(sum(after)) })]
    })
  }

  recordAudit(event, {
    resourceType: 'service_order',
    resourceId: orderId,
    before,
    after,
    extra: {
      employeeId,
      reason,
      override: overrideAction ? { action: overrideAction, commissionPlanId: overrideCommissionPlanId } : null
    }
  })

  return {
    data: result
  }
})
