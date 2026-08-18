import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { requireOrgPermission } from '../../utils/require-org-permission'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchBonus } from '../../utils/bonuses'

/**
 * PUT /api/bonuses/:id
 * Updates name/description/active only — the value (goal/bonus amount)
 * never updates in place, it always goes through POST .../value-versions
 * instead (see docs/employee-bonus-feature-design.md §4.2).
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  await requireOrgPermission(authUser.id, 'bonuses.update')
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bonus id is required' })
  }

  const existing = await fetchBonus(supabase, organizationId, id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Bônus não encontrado' })
  }

  const body = await readBody(event)
  const updates: Record<string, unknown> = { updated_by: authUser.email }

  if (body?.name !== undefined) {
    if (!String(body.name).trim()) {
      throw createError({ statusCode: 400, statusMessage: 'name não pode ser vazio' })
    }
    updates.name = String(body.name).trim()
  }
  if (body?.description !== undefined) {
    updates.description = body.description?.trim() || null
  }
  if (body?.active !== undefined) {
    updates.active = Boolean(body.active)
  }

  const { data, error } = await supabase
    .from('bonuses')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', organizationId)
    .select()
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to update bonus: ${error.message}` })
  }

  return { item: data }
})
