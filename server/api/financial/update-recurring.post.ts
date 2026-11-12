import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'
import { recordAudit } from '../../utils/audit/record'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addMonths, addYears, differenceInCalendarMonths, differenceInCalendarYears, format } from 'date-fns'

/**
 * POST /api/financial/update-recurring
 * Updates recurring series entries from a base date forward.
 * Migrated from: supabase/functions/updateRecurringFinanceEntries
 */

type EntryRecord = {
  id?: string
  bank_account_id?: string | null
  status?: string | null
  type?: string | null
  amount?: number | string | null
  due_date?: string | null
  recurrence?: string | null
  description?: string | null
  [key: string]: unknown
}

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

function hasEntryChanges(currentEntry: EntryRecord, updateData: EntryRecord) {
  return Object.entries(updateData).some(([key, value]) =>
    normalizeComparableValue(currentEntry?.[key]) !== normalizeComparableValue(value)
  )
}

function summarizeEntry(entry: EntryRecord | null | undefined) {
  return {
    id: entry?.id || null,
    amount: Number(entry?.amount || 0),
    due_date: entry?.due_date || null,
    description: entry?.description || ''
  }
}

function resolveUpdatedDueDate(originalEntry: EntryRecord, currentEntry: EntryRecord, requestedDueDate?: string) {
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

async function registrarExtratoContaBancaria(supabase: SupabaseClient, organizationId: string, email: string | null, lancamento: EntryRecord | null) {
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

async function reverterExtrato(supabase: SupabaseClient, organizationId: string, lancamento: EntryRecord | null) {
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

  const { data: originalEntryList } = await supabase.from('financial_transactions').select('*').eq('id', originalEntryId).eq('organization_id', organizationId).is('deleted_at', null)

  const originalEntry = originalEntryList?.[0]
  if (!originalEntry) {
    throw createError({ statusCode: 404, statusMessage: 'Lançamento original não encontrado' })
  }

  const rootRecurringId = originalEntry.parent_recurrence_id || originalEntry.id
  const baseDate = String(originalEntry.due_date || '')

  const [rootResult, childResult] = await Promise.all([
    supabase.from('financial_transactions').select('*').eq('id', rootRecurringId).eq('organization_id', organizationId).is('deleted_at', null),
    supabase.from('financial_transactions').select('*').eq('parent_recurrence_id', rootRecurringId).eq('organization_id', organizationId).is('deleted_at', null)
  ])

  const allSeriesEntries = [...(rootResult.data || []), ...(childResult.data || [])]
  const seen = new Set<string>()
  const entriesToUpdate = allSeriesEntries
    .filter((entry: EntryRecord) => {
      const id = String(entry?.id || '')
      if (!id || seen.has(id)) return false
      seen.add(id)
      // Never rewrite an occurrence that's already been paid and reconciled
      // in the bank statement — only propagate to what's still pending.
      if (entry?.status === 'paid') return false
      return String(entry?.due_date || '') >= baseDate
    })
    .sort((a: EntryRecord, b: EntryRecord) => String(a?.due_date || '').localeCompare(String(b?.due_date || '')))

  if (entriesToUpdate.length === 0) {
    return { data: { updatedCount: 0, updatedEntries: [] } }
  }

  // Destructure out fields that shouldn't be directly updated
  const {
    organization_id: _orgId, recurrenceEditScope: _scope, created_by: _cb, id: _id,
    created_at: _ca, updated_at: _ua, ...sharedUpdateData
  } = inputUpdateData

  let updatedCount = 0
  const updatedEntries: Array<Record<string, unknown>> = []

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

  recordAudit(event, { extra: { updatedCount, updatedEntries } })

  return {
    organization_id: organizationId,
    data: { updatedCount, updatedEntries }
  }
})
