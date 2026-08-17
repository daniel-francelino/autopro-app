import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { fetchBonus } from '../../utils/bonuses'

/**
 * DELETE /api/bonuses/:id
 * Soft-deletes a bonus. Value history, assignments and past bonus_generations
 * rows are left untouched (organization-scoped FKs cascade only on hard
 * delete, which this never does) — deleting a bonus doesn't erase what it
 * already paid out.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
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

  const { error } = await supabase
    .from('bonuses')
    .update({ deleted_at: new Date().toISOString(), deleted_by: authUser.email })
    .eq('id', id)
    .eq('organization_id', organizationId)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Failed to delete bonus: ${error.message}` })
  }

  return { success: true }
})
