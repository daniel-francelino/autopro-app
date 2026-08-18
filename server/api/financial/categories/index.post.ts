import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'

/**
 * POST /api/financial/categories
 * Create a custom financial category.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = await readBody(event)

  const name = String(body?.name || '').trim()
  const type = String(body?.type || '').trim()
  const icon = String(body?.icon || 'i-lucide-folder-open').trim()
  const colorInput = String(body?.color || '#64748b').trim()
  const color = /^#[0-9a-fA-F]{6}$/.test(colorInput) ? colorInput : '#64748b'

  if (!name) throw createError({ statusCode: 400, statusMessage: 'O campo "name" é obrigatório' })
  if (!['income', 'expense'].includes(type)) throw createError({ statusCode: 400, statusMessage: 'O campo "type" deve ser "income" ou "expense"' })

  // Matches against is_default rows too — a custom category can't shadow a
  // default one of the same name+type (docs/finance/financial-categories-crud.md,
  // section 4.1). Scoped by type because 'Outros' legitimately exists once
  // per type (financial_categories_org_name_type_uq).
  const { data: existing } = await supabase
    .from('financial_categories')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('type', type)
    .ilike('name', name)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) throw createError({ statusCode: 409, statusMessage: 'Categoria já existe' })

  const { data: category, error } = await supabase
    .from('financial_categories')
    .insert({
      organization_id: organizationId,
      name,
      type,
      icon,
      color,
      created_by: authUser.email
    })
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return category
})
