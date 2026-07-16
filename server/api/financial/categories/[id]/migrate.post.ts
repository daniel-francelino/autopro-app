import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../../utils/supabase'
import { requireAuthUser } from '../../../../utils/require-auth'
import { resolveOrganizationId } from '../../../../utils/organization'

const BATCH_SIZE = 500

/**
 * POST /api/financial/categories/:id/migrate
 * Moves active financial transactions from one category to another in small
 * batches, avoiding one large update for organizations with many rows.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const sourceId = getRouterParam(event, 'id')
  if (!sourceId) throw createError({ statusCode: 400, statusMessage: 'ID invalido' })

  const body = await readBody(event)
  const targetId = String(body?.target_category_id || '').trim()

  if (!targetId) throw createError({ statusCode: 400, statusMessage: 'Categoria de destino obrigatoria' })
  if (targetId === sourceId) throw createError({ statusCode: 400, statusMessage: 'Selecione uma categoria diferente' })

  const { data: categories, error: categoriesError } = await supabase
    .from('financial_categories')
    .select('id, name, type')
    .eq('organization_id', organizationId)
    .in('id', [sourceId, targetId])
    .is('deleted_at', null)

  if (categoriesError) throw createError({ statusCode: 500, statusMessage: categoriesError.message })

  const source = categories?.find(category => category.id === sourceId)
  const target = categories?.find(category => category.id === targetId)

  if (!source) throw createError({ statusCode: 404, statusMessage: 'Categoria de origem nao encontrada' })
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Categoria de destino nao encontrada' })
  if (source.type !== target.type) {
    throw createError({ statusCode: 409, statusMessage: 'A categoria de destino deve ter o mesmo tipo da origem' })
  }

  const { count, error: countError } = await supabase
    .from('financial_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('category_id', sourceId)
    .is('deleted_at', null)

  if (countError) throw createError({ statusCode: 500, statusMessage: countError.message })

  const total = count ?? 0
  let migrated = 0

  while (migrated < total) {
    const { data: rows, error: rowsError } = await supabase
      .from('financial_transactions')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('category_id', sourceId)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .limit(BATCH_SIZE)

    if (rowsError) throw createError({ statusCode: 500, statusMessage: rowsError.message })

    const ids = (rows ?? []).map(row => row.id)
    if (!ids.length) break

    const { error: updateError } = await supabase
      .from('financial_transactions')
      .update({
        category_id: target.id,
        category: target.name,
        updated_by: authUser.email
      })
      .eq('organization_id', organizationId)
      .in('id', ids)

    if (updateError) throw createError({ statusCode: 500, statusMessage: updateError.message })

    migrated += ids.length
  }

  return {
    success: true,
    migrated,
    total,
    batch_size: BATCH_SIZE
  }
})
