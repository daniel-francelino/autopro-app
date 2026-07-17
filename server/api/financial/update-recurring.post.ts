import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { addMonths, addYears, differenceInCalendarMonths, differenceInCalendarYears, format } from 'date-fns'

/**
 * POST /api/financial/update-recurring
 * Updates recurring series entries from a base date forward.
 * Migrated from: supabase/functions/updateRecurringFinanceEntries
 */

function parseDateOnly(value?: string | null) {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDateOnly(date: Date | null) {
  return date ? format(date, 'yyyy-MM-dd') : null
}

function normalizeComparableValue(value: unknown) {
  if (value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return value
}

function hasEntryChanges(currentEntry: Record<string, any>, updateData: Record<string, any>) {
  return Object.entries(updateData).some(([key, value]) =>
    normalizeComparableValue(currentEntry?.[key]) !== normalizeComparableValue(value)
  )
}

function summarizeEntry(entry: Record<string, any>) {
  return {
    id: entry?.id || null,
    amount: Number(entry?.amount || 0),
    due_date: entry?.due_date || null,
    description: entry?.description || ''
  }
}

function resolveUpdatedDueDate(originalEntry: Record<string, any>, currentEntry: Record<string, any>, requestedDueDate?: string) {
  if (!requestedDueDate) return currentEntry?.due_date || null
  const requestedDate = parseDateOnly(requestedDueDate)
  if (!requestedDate) return currentEntry?.due_date || requestedDueDate
  const originalDate = parseDateOnly(originalEntry?.due_date)
  const currentDate = parseDateOnly(currentEntry?.due_date)
  const recurrence = String(originalEntry?.recurrence || currentEntry?.recurrence || '').toLowerCase()

  if (!originalDate || !currentDate) return requestedDueDate

  if (recurrence === 'mensal' || recurrence === 'monthly') {
    const monthOffset = differenceInCalendarMonths(currentDate, originalDate)
    return formatDateOnly(addMonths(requestedDate, monthOffset)) || requestedDueDate
  }
  if (recurrence === 'anual' || recurrence === 'annual') {
    const yearOffset = differenceInCalendarYears(currentDate, originalDate)
    return formatDateOnly(addYears(requestedDate, yearOffset)) || requestedDueDate
  }

  return currentEntry?.id === originalEntry?.id ? requestedDueDate : currentEntry?.due_date || requestedDueDate
}

async function registrarExtratoContaBancaria(supabase: any, organizationId: string, email: string, lancamento: any) {
  if (!lancamento?.bank_account_id || lancamento?.status !== 'paid') return

  const { data: conta } = await supabase.from('bank_accounts').select('*').eq('id', lancamento.bank_account_id).eq('organization_id', organizationId).single()
  if (!conta) return

  const saldoAnterior = Number(conta?.current_balance || 0)
  const valor = Number(lancamento?.amount || 0)
  const saldoPosterior = lancamento.type === 'income' ? saldoAnterior + valor : saldoAnterior - valor

  await supabase.from('bank_account_statements').insert({
    bank_account_id: conta.id,
    financial_transaction_id: lancamento.id,
    transaction_date: lancamento.due_date,
    description: lancamento.description,
    transaction_type: lancamento.type,
    amount: valor,
    previous_balance: saldoAnterior,
    balance_after: saldoPosterior,
    notes: `Ref. ao lançamento financeiro: ${lancamento.description}`,
    organization_id: organizationId,
    created_by: email
  })

  await supabase.from('bank_accounts').update({ current_balance: saldoPosterior }).eq('id', conta.id)
}

async function reverterExtrato(supabase: any, organizationId: string, lancamento: any) {
  if (!lancamento?.bank_account_id || lancamento?.status !== 'paid') return

  const { data: extratoEntries } = await supabase.from('bank_account_statements').select('*').eq('bank_account_id', lancamento.bank_account_id).eq('financial_transaction_id', lancamento.id).eq('organization_id', organizationId)
  if (!extratoEntries || extratoEntries.length === 0) return

  const { data: conta } = await supabase.from('bank_accounts').select('*').eq('id', lancamento.bank_account_id).eq('organization_id', organizationId).single()
  if (!conta) return

  let saldoAtual = Number(conta?.current_balance || 0)
  for (const _extrato of extratoEntries) {
    if (lancamento.type === 'income') saldoAtual -= Number(lancamento.amount || 0)
    else saldoAtual += Number(lancamento.amount || 0)
  }

  await supabase.from('bank_accounts').update({ current_balance: saldoAtual }).eq('id', conta.id)
  for (const extrato of extratoEntries) {
    await supabase.from('bank_account_statements').delete().eq('id', extrato.id)
  }
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const payload = (await readBody(event)) || {}
  const originalEntryId = String(payload?.originalEntryId || '').trim()
  const inputUpdateData = payload?.updateData || {}

  if (!originalEntryId) {
    throw createError({ statusCode: 400, statusMessage: 'originalEntryId é obrigatório' })
  }

  const { data: originalEntryList } = await supabase.from('financial_transactions').select('*').eq('id', originalEntryId).eq('organization_id', organizationId)

  const originalEntry = originalEntryList?.[0]
  if (!originalEntry) {
    throw createError({ statusCode: 404, statusMessage: 'Lançamento original não encontrado' })
  }

  const rootRecurringId = originalEntry.parent_recurrence_id || originalEntry.id
  const baseDate = String(originalEntry.due_date || '')

  const [rootResult, childResult] = await Promise.all([
    supabase.from('financial_transactions').select('*').eq('id', rootRecurringId).eq('organization_id', organizationId),
    supabase.from('financial_transactions').select('*').eq('parent_recurrence_id', rootRecurringId).eq('organization_id', organizationId)
  ])

  const allSeriesEntries = [...(rootResult.data || []), ...(childResult.data || [])]
  const seen = new Set<string>()
  const entriesToUpdate = allSeriesEntries
    .filter((entry: any) => {
      const id = String(entry?.id || '')
      if (!id || seen.has(id)) return false
      seen.add(id)
      return String(entry?.due_date || '') >= baseDate
    })
    .sort((a: any, b: any) => String(a?.due_date || '').localeCompare(String(b?.due_date || '')))

  if (entriesToUpdate.length === 0) {
    return { data: { updatedCount: 0, updatedEntries: [] } }
  }

  // Destructure out fields that shouldn't be directly updated
  const {
    organization_id: _orgId, recurrenceEditScope: _scope, created_by: _cb, id: _id,
    created_at: _ca, updated_at: _ua, ...sharedUpdateData
  } = inputUpdateData

  let updatedCount = 0
  const updatedEntries: any[] = []

  for (const entry of entriesToUpdate) {
    const nextDueDate = resolveUpdatedDueDate(originalEntry, entry, sharedUpdateData.due_date)

    const updateData = {
      ...sharedUpdateData,
      due_date: nextDueDate,
      status: entry.status,
      payment_date: entry.payment_date,
      is_installment: entry.is_installment,
      installment_count: entry.installment_count,
      current_installment: entry.current_installment,
      parent_transaction_id: entry.parent_transaction_id,
      parent_recurrence_id: entry.parent_recurrence_id
    }

    if (!hasEntryChanges(entry, updateData)) continue

    await reverterExtrato(supabase, organizationId, entry)

    const { data: lancamentoAtualizado } = await supabase
      .from('financial_transactions')
      .update(updateData)
      .eq('id', entry.id)
      .select()
      .single()

    await registrarExtratoContaBancaria(supabase, organizationId, authUser.email, lancamentoAtualizado)

    updatedCount += 1
    updatedEntries.push({
      id: lancamentoAtualizado?.id || entry.id,
      before: summarizeEntry(entry),
      after: summarizeEntry(lancamentoAtualizado)
    })
  }

  return {
    organization_id: organizationId,
    data: { updatedCount, updatedEntries }
  }
})
