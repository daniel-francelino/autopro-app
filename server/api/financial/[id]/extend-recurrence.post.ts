import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { addMonths, addYears, format } from 'date-fns'
import { getSupabaseAdminClient } from '../../../utils/supabase'
import { requireAuthUser } from '../../../utils/require-auth'
import { resolveOrganizationId } from '../../../utils/organization'

const MAX_ADDITIONAL_COUNT = 60

/**
 * POST /api/financial/:id/extend-recurrence
 * Adds more occurrences to an existing recurring series, starting from
 * whichever occurrence has the latest due_date (not necessarily the root —
 * "this and future" edits (update-recurring.post.ts) only touch pending
 * rows going forward, so the most recent one already reflects any shared
 * field changes made to the series).
 *
 * There's no cron in this infra — see docs/finance/financial-recurrence-flow.md —
 * so a series that runs out of pre-generated occurrences (created either at
 * creation time or by a previous call to this endpoint) needs this explicit
 * action to keep going. No cap on how many times a series can be extended,
 * only a per-call ceiling (MAX_ADDITIONAL_COUNT).
 */
export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID obrigatório' })

  const body = (await readBody(event).catch(() => null)) || {}
  const additionalCount = Math.floor(Number(body?.additional_count))
  if (!Number.isFinite(additionalCount) || additionalCount < 1) {
    throw createError({ statusCode: 400, statusMessage: 'additional_count deve ser pelo menos 1' })
  }
  const total = Math.min(additionalCount, MAX_ADDITIONAL_COUNT)

  const { data: entry, error: entryError } = await supabase
    .from('financial_transactions')
    .select('*')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (entryError || !entry) throw createError({ statusCode: 404, statusMessage: 'Lançamento não encontrado' })
  if (!entry.recurrence || entry.recurrence === 'non_recurring') {
    throw createError({ statusCode: 400, statusMessage: 'Este lançamento não faz parte de uma recorrência' })
  }

  const rootId: string = entry.parent_recurrence_id ?? entry.id

  const [rootResult, childrenResult] = await Promise.all([
    supabase.from('financial_transactions').select('*').eq('id', rootId).eq('organization_id', organizationId).is('deleted_at', null),
    supabase.from('financial_transactions').select('*').eq('parent_recurrence_id', rootId).eq('organization_id', organizationId).is('deleted_at', null)
  ])

  const root = rootResult.data?.[0]
  if (!root) throw createError({ statusCode: 404, statusMessage: 'A série recorrente não foi encontrada (o lançamento raiz pode ter sido excluído)' })

  const seriesEntries = [root, ...(childrenResult.data || [])]

  // The occurrence with the latest due_date is the template for the new
  // rows — if "este e os próximos" already changed description/amount/
  // category/bank account going forward, that's the state that should keep
  // repeating, not the (possibly stale) original root.
  const template = seriesEntries.reduce((latest, current) =>
    String(current.due_date) > String(latest.due_date) ? current : latest
  )

  const advance = (date: Date) => (root.recurrence === 'annual' ? addYears(date, 1) : addMonths(date, 1))

  let cursor = new Date(`${template.due_date}T00:00:00`)
  const newDueDates = Array.from({ length: total }, () => {
    cursor = advance(cursor)
    return format(cursor, 'yyyy-MM-dd')
  })
  const newRecurrenceEndDate = newDueDates[newDueDates.length - 1]!

  const newRows = newDueDates.map(dueDate => ({
    organization_id: organizationId,
    description: template.description,
    amount: template.amount,
    due_date: dueDate,
    type: template.type,
    status: 'pending',
    category: template.category,
    category_id: template.category_id,
    recurrence: root.recurrence,
    recurrence_end_date: newRecurrenceEndDate,
    parent_recurrence_id: root.id,
    bank_account_id: template.bank_account_id,
    notes: template.notes,
    created_by: authUser.email,
    updated_by: authUser.email
  }))

  const { error: insertError } = await supabase.from('financial_transactions').insert(newRows)
  if (insertError) throw createError({ statusCode: 500, statusMessage: insertError.message })

  // The series just grew — every existing row (root + previously-created
  // children) needs recurrence_end_date bumped to the new final date too,
  // or it goes stale the moment a series is extended (docs/financial-
  // recurrence-flow.md section 10.4a/10.7).
  const existingIds = seriesEntries.map(e => e.id)
  const { error: updateError } = await supabase
    .from('financial_transactions')
    .update({ recurrence_end_date: newRecurrenceEndDate, updated_by: authUser.email })
    .in('id', existingIds)
    .eq('organization_id', organizationId)
  if (updateError) throw createError({ statusCode: 500, statusMessage: updateError.message })

  return { success: true, created: total }
})
