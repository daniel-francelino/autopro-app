import type { SupabaseClient } from '@supabase/supabase-js'
import { createError } from 'h3'

interface ResolveCategoryInput {
  category_id?: string | null
  category?: string | null
}

/**
 * Resolves the category to write on a financial_transactions row from
 * either the new category_id or the legacy free-text category — dual-accept
 * during the migration window (docs/finance/financial-categories-crud.md, Phase 2).
 * Returns both the id (for category_id) and the name (still needed to
 * satisfy the legacy `category` column, which stays NOT NULL until Phase 5).
 */
export async function resolveFinancialCategory(
  supabase: SupabaseClient,
  organizationId: string,
  type: string,
  input: ResolveCategoryInput
): Promise<{ id: string, name: string }> {
  if (input.category_id) {
    const { data, error } = await supabase
      .from('financial_categories')
      .select('id, name')
      .eq('id', input.category_id)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    if (!data) throw createError({ statusCode: 400, statusMessage: 'Categoria inválida' })

    return { id: data.id as string, name: data.name as string }
  }

  const categoryText = String(input.category ?? '').trim()
  if (categoryText) {
    // ilike, not eq: legacy callers (e.g. the pre-cutover FormModal.vue) send
    // the category name lowercased — see docs/finance/financial-categories-crud.md,
    // section 2.2. Case-insensitive match keeps this endpoint backward
    // compatible with any client still on the old contract.
    const { data, error } = await supabase
      .from('financial_categories')
      .select('id, name')
      .eq('organization_id', organizationId)
      .eq('type', type)
      .ilike('name', categoryText)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    if (data) return { id: data.id as string, name: data.name as string }
  }

  throw createError({ statusCode: 400, statusMessage: 'O campo "category_id" é obrigatório' })
}
