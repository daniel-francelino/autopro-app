import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { resolveFinancialCategory } from '../../utils/resolve-financial-category'
import { assertNotInstallmentAndRecurring } from '../../utils/financial-mutual-exclusion'

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
    .select('id, type, is_installment, recurrence')
    .eq('id', id!)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Lançamento não encontrado' })

  // Bug 7 (docs/financial-recurrence-flow.md): validate the RESULTING state
  // (existing row + whatever this request changes), not just what's in the
  // body — editing only `recurrence` on a row that's already an installment
  // must still be rejected.
  const resultingIsInstallment = 'is_installment' in body ? body.is_installment : existing.is_installment
  const resultingRecurrence = 'recurrence' in body ? body.recurrence : existing.recurrence
  assertNotInstallmentAndRecurring(resultingIsInstallment, resultingRecurrence)

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
