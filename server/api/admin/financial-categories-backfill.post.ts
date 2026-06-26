import { defineEventHandler, readBody } from 'h3'
import { requireOwner } from '../../utils/require-owner'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { fetchAllOrganizationRows } from '../../utils/supabase-pagination'
import { ensureDefaultFinancialCategories } from '../../utils/financial-category-defaults'

/**
 * POST /api/admin/financial-categories-backfill
 * One-off migration script — see docs/financial-categories-crud.md, section 5
 * (Phase 1). Per organization:
 *   1. Ensures the 9 default category rows exist.
 *   2. For every distinct (category text, transaction type) pair still
 *      missing a category_id, reuses an exact name+type match if one exists,
 *      otherwise creates a new custom category named exactly after the text
 *      found (no normalization, no merging of similar spellings — see the
 *      doc for why that matching strategy was rejected).
 *   3. Points every matching transaction at the resolved category_id.
 *
 * Restricted to platform owners. Meant to be run once, then deleted (same
 * lifecycle as the old seed-commissions endpoint).
 */

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>

interface PendingTransactionRow {
  id: string
  category: string | null
  type: string | null
}

interface ExpenseVisual {
  icon: string
  color: string
}

// Mirrors app/utils/report-costs.ts getCostCategoryVisual — duplicated here
// (rather than imported across the app/server boundary) because this file is
// temporary and gets deleted once the backfill has run. Only used for
// expense-type categories created from free text; income has no equivalent
// heuristic (see docs/financial-categories-crud.md, section 3.5).
function guessExpenseCategoryVisual(categoryText: string): ExpenseVisual {
  const key = String(categoryText || 'other')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (/(tax|impost|fiscal)/.test(key)) return { icon: 'i-lucide-landmark', color: '#ef4444' }
  if (/(salari|folha|employee|funcion|prolabore|pessoal)/.test(key)) return { icon: 'i-lucide-users', color: '#f97316' }
  if (/(financi|emprest|parcelamento)/.test(key)) return { icon: 'i-lucide-banknote-arrow-down', color: '#3b82f6' }
  if (/(cartao|credito)/.test(key)) return { icon: 'i-lucide-credit-card', color: '#f59e0b' }
  if (/(fuel|combust|transport|frete|logistic)/.test(key)) return { icon: 'i-lucide-truck', color: '#06b6d4' }
  if (/(rent|alug|building|estrutura|custo fixo)/.test(key)) return { icon: 'i-lucide-building-2', color: '#8b5cf6' }
  if (/(market|ads|public|meta|trafeg)/.test(key)) return { icon: 'i-lucide-megaphone', color: '#ec4899' }
  if (/(energy|water|internet|telefon|utility|luz)/.test(key)) return { icon: 'i-lucide-zap', color: '#f59e0b' }
  if (/(software|system|saas|license|licen)/.test(key)) return { icon: 'i-lucide-monitor-cog', color: '#6366f1' }
  if (/(part|piece|peca|stock|inventory|suprimento|material|fornecedor|terceirizado)/.test(key)) return { icon: 'i-lucide-package', color: '#22c55e' }
  if (/(maint|manuten|repair|service|custo variavel)/.test(key)) return { icon: 'i-lucide-wrench', color: '#06b6d4' }
  if (/(fee|tarifa|charge|bank|finance)/.test(key)) return { icon: 'i-lucide-receipt', color: '#64748b' }

  return { icon: 'i-lucide-folder-open', color: '#64748b' }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function backfillOrganization(supabase: SupabaseAdminClient, organizationId: string) {
  await ensureDefaultFinancialCategories(supabase, organizationId, 'financial-categories-backfill')

  const { data: existingCategories, error: categoriesError } = await supabase
    .from('financial_categories')
    .select('id, name, type')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)

  if (categoriesError) throw new Error(`financial_categories: ${categoriesError.message}`)

  const categoryIdByKey = new Map<string, string>(
    (existingCategories ?? []).map(c => [`${c.name}::${c.type}`, c.id as string])
  )

  const pendingTransactions = await fetchAllOrganizationRows<PendingTransactionRow>(supabase, {
    table: 'financial_transactions',
    organizationId,
    columns: 'id, category, type',
    nullColumns: ['deleted_at', 'category_id']
  })

  if (pendingTransactions.length === 0) {
    return { distinctPairs: 0, categoriesCreated: 0, transactionsUpdated: 0, skipped: [] as Array<{ text: string, type: string | null, count: number, reason: string }> }
  }

  const pairs = new Map<string, { text: string, type: string, ids: string[] }>()
  const skipped: Array<{ text: string, type: string | null, count: number, reason: string }> = []

  for (const row of pendingTransactions) {
    const text = String(row.category ?? '').trim()
    const type = String(row.type ?? '').trim()

    // A blank category or an unrecognized type can't become a meaningful
    // category name on its own. Per the "don't auto-guess, don't lose
    // anything" rule (docs/financial-categories-crud.md, section 5), this
    // is reported in `skipped` for manual review instead of being silently
    // assigned to some default category.
    if (!text || (type !== 'income' && type !== 'expense')) {
      skipped.push({ text, type: row.type, count: 1, reason: 'blank category or invalid type — needs manual review' })
      continue
    }

    const key = `${text}::${type}`
    if (!pairs.has(key)) pairs.set(key, { text, type, ids: [] })
    pairs.get(key)!.ids.push(row.id)
  }

  let categoriesCreated = 0
  let transactionsUpdated = 0

  for (const pair of pairs.values()) {
    const key = `${pair.text}::${pair.type}`
    let categoryId = categoryIdByKey.get(key)

    if (!categoryId) {
      const visual = pair.type === 'expense' ? guessExpenseCategoryVisual(pair.text) : { icon: 'i-lucide-circle-dollar-sign', color: '#64748b' }

      const { data: created, error: insertError } = await supabase
        .from('financial_categories')
        .insert({
          organization_id: organizationId,
          name: pair.text,
          type: pair.type,
          icon: visual.icon,
          color: visual.color,
          is_default: false,
          created_by: 'financial-categories-backfill'
        })
        .select('id')
        .single()

      if (insertError || !created) {
        skipped.push({ text: pair.text, type: pair.type, count: pair.ids.length, reason: insertError?.message || 'insert failed' })
        continue
      }

      categoryId = created.id as string
      categoryIdByKey.set(key, categoryId)
      categoriesCreated += 1
    }

    for (const idBatch of chunk(pair.ids, 200)) {
      const { error: updateError } = await supabase
        .from('financial_transactions')
        .update({ category_id: categoryId })
        .in('id', idBatch)

      if (updateError) {
        skipped.push({ text: pair.text, type: pair.type, count: idBatch.length, reason: updateError.message })
        continue
      }

      transactionsUpdated += idBatch.length
    }
  }

  return { distinctPairs: pairs.size, categoriesCreated, transactionsUpdated, skipped }
}

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const supabase = getSupabaseAdminClient()

  const body = (await readBody(event)) || {}
  const organizationIds = Array.isArray(body?.organizationIds)
    ? body.organizationIds.map((id: unknown) => String(id)).filter(Boolean)
    : []

  let orgsQuery = supabase.from('organizations').select('id, name').is('deleted_at', null)
  if (organizationIds.length > 0) orgsQuery = orgsQuery.in('id', organizationIds)

  const { data: organizations, error: orgsError } = await orgsQuery

  if (orgsError) {
    return { success: false, error: orgsError.message }
  }

  const results: Array<{ organizationId: string, organizationName: string } & Awaited<ReturnType<typeof backfillOrganization>>> = []

  for (const org of organizations ?? []) {
    const result = await backfillOrganization(supabase, org.id as string)
    results.push({ organizationId: org.id as string, organizationName: org.name as string, ...result })
  }

  const totals = results.reduce(
    (acc, r) => ({
      categoriesCreated: acc.categoriesCreated + r.categoriesCreated,
      transactionsUpdated: acc.transactionsUpdated + r.transactionsUpdated,
      skipped: acc.skipped + r.skipped.length
    }),
    { categoriesCreated: 0, transactionsUpdated: 0, skipped: 0 }
  )

  return {
    success: true,
    data: {
      organizationsProcessed: results.length,
      totals,
      results
    }
  }
})
