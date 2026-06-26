import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'

/**
 * DELETE /api/financial/categories/:id
 * Soft-delete a custom financial category.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const { data: existing } = await supabase
    .from('financial_categories')
    .select('id, is_default')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Categoria não encontrada' })
  if (existing.is_default) throw createError({ statusCode: 409, statusMessage: 'Categoria padrão não pode ser removida' })

  const { count } = await supabase
    .from('financial_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id)
    .is('deleted_at', null)

  if (count) throw createError({ statusCode: 409, statusMessage: `Categoria em uso por ${count} lançamento(s) e não pode ser removida` })

  const { error } = await supabase
    .from('financial_categories')
    .update({ deleted_at: new Date().toISOString(), deleted_by: authUser.email })
    .eq('id', id)
    .eq('organization_id', organizationId)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
