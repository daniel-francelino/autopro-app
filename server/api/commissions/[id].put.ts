import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchCommissionPlan } from '../../utils/employee-commission-plans'

/**
 * PUT /api/commissions/:id
 * Updates a plan's identity fields (name/description/active) — never its
 * rules. Rule changes always go through POST /versions, which appends a new
 * version rather than mutating an existing one.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'commissions.update')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const planId = getRouterParam(event, 'id')
  if (!planId) {
    throw createError({ statusCode: 400, statusMessage: 'Plan id is required' })
  }

  const plan = await fetchCommissionPlan(supabase, organizationId, planId)
  if (!plan) {
    throw createError({ statusCode: 404, statusMessage: 'Configuração de comissão não encontrada' })
  }

  const body = await readBody(event)
  const updates: Record<string, unknown> = { updated_by: authUser.email }

  if (body.name !== undefined) {
    if (!String(body.name).trim()) {
      throw createError({ statusCode: 400, statusMessage: 'name não pode ser vazio' })
    }
    updates.name = String(body.name).trim()
  }
  if (body.description !== undefined) updates.description = body.description?.trim() || null
  if (body.active !== undefined) updates.active = body.active === true

  const { data, error } = await supabase
    .from('employee_commission_plans')
    .update(updates)
    .eq('id', planId)
    .select()
    .single()

  if (error) {
    if (String(error.code) === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'Já existe uma configuração de comissão com esse nome.' })
    }
    throw createError({ statusCode: 500, statusMessage: `Failed to update commission plan: ${error.message}` })
  }

  return { item: data }
})
