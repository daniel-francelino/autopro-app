import type { SupabaseClient } from '@supabase/supabase-js'

export type FinancialCategoryType = 'income' | 'expense'

export interface DefaultFinancialCategory {
  name: string
  type: FinancialCategoryType
  icon: string
  color: string
}

/**
 * The 9 default category rows seeded per organization (8 names — 'Outros'
 * exists once per type). icon/color mirror the keyword heuristic that used
 * to live in app/utils/report-costs.ts for the expense side; the income side
 * (Vendas/Serviços/Outros) has no prior heuristic to copy, so these are a
 * fresh choice, adjustable later from the categories CRUD screen.
 * See docs/financial-categories-crud.md, section 3.5.
 */
export const DEFAULT_FINANCIAL_CATEGORIES: DefaultFinancialCategory[] = [
  { name: 'Vendas', type: 'income', icon: 'i-lucide-shopping-cart', color: '#22c55e' },
  { name: 'Serviços', type: 'income', icon: 'i-lucide-wrench', color: '#3b82f6' },
  { name: 'Outros', type: 'income', icon: 'i-lucide-circle-dollar-sign', color: '#64748b' },
  { name: 'Aluguel', type: 'expense', icon: 'i-lucide-building-2', color: '#8b5cf6' },
  { name: 'Salários', type: 'expense', icon: 'i-lucide-users', color: '#f97316' },
  { name: 'Fornecedores', type: 'expense', icon: 'i-lucide-package', color: '#22c55e' },
  { name: 'Impostos', type: 'expense', icon: 'i-lucide-landmark', color: '#ef4444' },
  { name: 'Marketing', type: 'expense', icon: 'i-lucide-megaphone', color: '#ec4899' },
  { name: 'Outros', type: 'expense', icon: 'i-lucide-folder-open', color: '#64748b' }
]

/**
 * Idempotent: only inserts the 9 default rows if the organization doesn't
 * already have any is_default=true category. Safe to call from multiple
 * call sites (both webhook implementations, the backfill script) without
 * risking duplicates on retries/redeliveries.
 */
export async function ensureDefaultFinancialCategories(
  supabase: SupabaseClient,
  organizationId: string,
  createdBy: string
) {
  const { count, error: countError } = await supabase
    .from('financial_categories')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('is_default', true)

  if (countError) {
    throw createError({ statusCode: 500, statusMessage: `financial_categories: ${countError.message}` })
  }

  if (count) return

  const { error: insertError } = await supabase
    .from('financial_categories')
    .insert(
      DEFAULT_FINANCIAL_CATEGORIES.map(category => ({
        organization_id: organizationId,
        name: category.name,
        type: category.type,
        icon: category.icon,
        color: category.color,
        is_default: true,
        created_by: createdBy
      }))
    )

  if (insertError) {
    throw createError({ statusCode: 500, statusMessage: `financial_categories: ${insertError.message}` })
  }
}

/**
 * Looks up a default category's id by name+type, self-healing by seeding
 * the 9 defaults if the organization is somehow missing them (e.g. created
 * in a gap before the org-creation hook covered this — see
 * docs/financial-categories-crud.md, section 8). Used by payment flows that
 * write to a fixed default category (commission/service-order income) so a
 * missing category never fails the payment itself.
 */
export async function resolveDefaultCategoryId(
  supabase: SupabaseClient,
  organizationId: string,
  name: string,
  type: FinancialCategoryType
): Promise<{ id: string, name: string }> {
  const lookup = () => supabase
    .from('financial_categories')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('is_default', true)
    .eq('name', name)
    .eq('type', type)
    .maybeSingle()

  const { data: existing } = await lookup()
  if (existing) return { id: existing.id as string, name: existing.name as string }

  await ensureDefaultFinancialCategories(supabase, organizationId, 'financial-category-fallback')

  const { data: created, error } = await lookup()
  if (error) throw createError({ statusCode: 500, statusMessage: `financial_categories: ${error.message}` })
  if (!created) throw createError({ statusCode: 500, statusMessage: `Default category "${name}" (${type}) could not be resolved for organization ${organizationId}` })

  return { id: created.id as string, name: created.name as string }
}
