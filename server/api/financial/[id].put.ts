import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { resolveFinancialCategory } from '../../utils/resolve-financial-category'

/**
 * PUT /api/financial/:id
 * Update a financial transaction.
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const { data: existing } = await supabase
    .from('financial_transactions')
    .select('id, type')
    .eq('id', id!)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Lançamento não encontrado' })

  const updates: Record<string, any> = { updated_by: authUser.email }
  const allowed = ['description', 'amount', 'due_date', 'type', 'status', 'recurrence', 'recurrence_end_date', 'is_installment', 'installment_count', 'current_installment', 'bank_account_id', 'notes']
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if ('category_id' in body || 'category' in body) {
    const resolvedCategory = await resolveFinancialCategory(supabase, organizationId, body.type ?? existing.type, {
      category_id: body.category_id,
      category: body.category
    })
    updates.category_id = resolvedCategory.id
    updates.category = resolvedCategory.name
  }

  const { data: item, error } = await supabase
    .from('financial_transactions')
    .update(updates)
    .eq('id', id!)
    .eq('organization_id', organizationId)
    .select('*, category_ref:financial_categories(id, name, icon, color)')
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return item
})
