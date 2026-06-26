import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'

/**
 * GET /api/financial/:id
 * Returns a single financial transaction plus its linked entries
 * (installment siblings or recurring series siblings).
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  // Fetch the target entry
  const { data: entry, error: entryError } = await supabase
    .from('financial_transactions')
    .select('*, category_ref:financial_categories(id, name, icon, color)')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (entryError) throw createError({ statusCode: 500, statusMessage: entryError.message })
  if (!entry) throw createError({ statusCode: 404, statusMessage: 'Lançamento não encontrado' })

  // ── Installment family ───────────────────────────────────────────────────────
  let installmentSiblings: unknown[] = []
  if (entry.is_installment) {
    // Root ID is either the parent or the entry itself if it is the parent
    const rootId: string = entry.parent_transaction_id ?? entry.id

    const { data: siblings } = await supabase
      .from('financial_transactions')
      .select('id, description, amount, due_date, status, current_installment, installment_count, parent_transaction_id')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .or(`id.eq.${rootId},parent_transaction_id.eq.${rootId}`)
      .order('current_installment', { ascending: true })

    installmentSiblings = (siblings ?? []).filter((s: { id: string }) => s.id !== entry.id)
  }

  // ── Recurring series ─────────────────────────────────────────────────────────
  let recurringSiblings: unknown[] = []
  const hasRecurrence = entry.recurrence && entry.recurrence !== 'non_recurring'
  if (hasRecurrence) {
    const rootId: string = entry.parent_recurrence_id ?? entry.id

    const { data: series } = await supabase
      .from('financial_transactions')
      .select('id, description, amount, due_date, status, recurrence, parent_recurrence_id')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .or(`id.eq.${rootId},parent_recurrence_id.eq.${rootId}`)
      .order('due_date', { ascending: true })

    recurringSiblings = (series ?? []).filter((s: { id: string }) => s.id !== entry.id)
  }

  return {
    entry,
    installmentSiblings,
    recurringSiblings
  }
})
