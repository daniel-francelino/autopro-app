import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { resolveEmployeeCommissionRules } from '../../utils/employee-commission-plans'
import { currentCommissionMonthStart, buildCommissionSnapshot } from '../../../lib/utils/employee-commission-engine'

interface PreviewItemInput {
  id?: string
  categoryId?: string | null
  revenue?: number | string
  profit?: number | string
  quantity?: number | string
}

/**
 * POST /api/commissions/preview
 * The "client-safe equivalent / preview endpoint" Step 6 of
 * docs/finance/commissions-configuration-architecture.md asks for: runs the
 * new consolidated engine (resolveEmployeeCommissionRules + a per-item
 * buildCommissionSnapshot) for a given employee against caller-supplied
 * items, so the OS screen (or any other UI) can show what the NEW commission
 * model would compute — without wiring it into the real OS flow, which stays
 * on the 4 legacy engines until Step 8.
 *
 * Not a public calculator: still requires commissions.read and an employee
 * that belongs to the caller's organization, same as every other commissions
 * endpoint.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'commissions.read')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)

  const employeeId = String(body?.employeeId || '').trim()
  if (!employeeId) {
    throw createError({ statusCode: 400, statusMessage: 'employeeId é obrigatório' })
  }

  const rawItems = Array.isArray(body?.items) ? body.items : []
  if (rawItems.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'items é obrigatório e não pode ser vazio' })
  }

  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('id, name')
    .eq('id', employeeId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (employeeError || !employee) {
    throw createError({ statusCode: 404, statusMessage: 'Funcionário não encontrado' })
  }

  const referenceDate = typeof body?.referenceDate === 'string' && body.referenceDate.trim()
    ? body.referenceDate.trim()
    : currentCommissionMonthStart()

  const rules = await resolveEmployeeCommissionRules(supabase, organizationId, employeeId, referenceDate)

  const planIds = [...new Set(rules.map(rule => rule.plan_id))]
  const planNameById = new Map<string, string>()
  if (planIds.length > 0) {
    const { data: plans } = await supabase
      .from('employee_commission_plans')
      .select('id, name')
      .in('id', planIds)
    for (const plan of plans || []) planNameById.set(plan.id, plan.name)
  }

  const items = (rawItems as PreviewItemInput[]).map((rawItem, index) => {
    const categoryId = rawItem?.categoryId ? String(rawItem.categoryId) : null
    const revenue = Number(rawItem?.revenue ?? 0) || 0
    const profit = Number(rawItem?.profit ?? revenue) || 0
    const quantity = Number(rawItem?.quantity ?? 1) || 1

    const snapshot = buildCommissionSnapshot(rules, { categoryId, revenue, profit, quantity })

    return {
      itemId: rawItem?.id ?? String(index),
      categoryId,
      matched: snapshot !== null,
      commission: snapshot
        ? {
            planId: snapshot.commission_plan_id,
            planName: planNameById.get(snapshot.commission_plan_id) ?? null,
            ruleId: snapshot.commission_rule_id,
            ruleVersionId: snapshot.commission_rule_version_id,
            ruleName: snapshot.commission_rule_name,
            commissionType: snapshot.commission_type,
            commissionBase: snapshot.commission_base,
            amount: snapshot.commission_amount_snapshot
          }
        : null
    }
  })

  const totalCommission = items.reduce((sum, item) => sum + (item.commission?.amount ?? 0), 0)

  return {
    data: {
      employeeId,
      employeeName: employee.name ?? null,
      referenceDate,
      items,
      totalCommission
    }
  }
})
