import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'

/**
 * PUT /api/financial/categories/:id
 * Edit a custom financial category (name/icon/color). Default categories
 * (is_default=true) can't be edited — docs/financial-categories-crud.md,
 * section 3.3 leaves open whether name should ever be freely editable even
 * for custom categories; icon/color are always safe to edit since they
 * carry no "old transaction shows the old name" implication.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const body = await readBody(event)

  const { data: existing } = await supabase
    .from('financial_categories')
    .select('id, type, is_default')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Categoria não encontrada' })
  if (existing.is_default) throw createError({ statusCode: 409, statusMessage: 'Categoria padrão não pode ser editada' })

  const updates: Record<string, unknown> = { updated_by: authUser.email }

  if ('name' in body) {
    const name = String(body.name || '').trim()
    if (!name) throw createError({ statusCode: 400, statusMessage: 'O campo "name" é obrigatório' })

    const { data: duplicate } = await supabase
      .from('financial_categories')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('type', existing.type)
      .ilike('name', name)
      .neq('id', id)
      .is('deleted_at', null)
      .maybeSingle()

    if (duplicate) throw createError({ statusCode: 409, statusMessage: 'Categoria já existe' })

    updates.name = name
  }

  if ('icon' in body) updates.icon = String(body.icon || '').trim() || 'i-lucide-folder-open'
  if ('color' in body) {
    const colorInput = String(body.color || '').trim()
    updates.color = /^#[0-9a-fA-F]{6}$/.test(colorInput) ? colorInput : '#64748b'
  }

  const { data: category, error } = await supabase
    .from('financial_categories')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', organizationId)
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return category
})
