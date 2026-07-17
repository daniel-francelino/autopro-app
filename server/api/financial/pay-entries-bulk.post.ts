import { defineEventHandler, readBody, createError } from 'h3'
import { getSupabaseAdminClient } from '../../utils/supabase'
import { requireAuthUser } from '../../utils/require-auth'
import { resolveOrganizationId } from '../../utils/organization'

/**
 * POST /api/financial/pay-entries-bulk
 * Marks multiple financial entries as paid, creates bank statements, updates balances.
 * Migrated from: supabase/functions/payFinancialEntriesBulk
 */

function normalizeId(value: unknown) {
  const id = String(value ?? '').trim()
  return id.length > 0 ? id : null
}

function normalizeNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const raw = String(value ?? '').trim()
  if (!raw) return 0
  const cleaned = raw.replace(/\s+/g, '').replace(/^R\$/i, '').replace(/\.(?=\d{3}(,|$))/g, '').replace(',', '.')
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item: unknown) => normalizeId(item)).filter(Boolean) as string[]
}

function uniquePreserveOrder(ids: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export default defineEventHandler(async (event) => {
  const authUser = await requireAuthUser(event)
  const supabase = getSupabaseAdminClient()
  const organizationId = await resolveOrganizationId(event, authUser.id)

  const body = (await readBody(event)) || {}
  const entryIds = uniquePreserveOrder(parseStringArray(body.entryIds))

  if (entryIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'entryIds é obrigatório (array não vazio)' })
  }
  if (entryIds.length > 200) {
    throw createError({ statusCode: 400, statusMessage: 'Limite excedido: máximo 200 lançamentos por operação' })
  }

  const today = new Date().toISOString().split('T')[0]

  const results: any[] = []
  let paidCount = 0, skippedCount = 0, failedCount = 0, extratoSkippedCount = 0

  for (const entryId of entryIds) {
    const baseResult: any = { entryId }

    const { data: lancamento } = await supabase.from('financial_transactions').select('*').eq('id', entryId).eq('organization_id', organizationId).is('deleted_at', null).single()

    if (!lancamento) {
      failedCount += 1
      results.push({ ...baseResult, status: 'failed', message: 'Lançamento não encontrado ou acesso negado' })
      continue
    }

    if (String(lancamento?.status || '') === 'paid') {
      skippedCount += 1
      results.push({ ...baseResult, status: 'skipped', message: 'Já estava pago' })
      continue
    }

    const warnings: string[] = []
    let createdExtrato: any = null
    let saldoAnterior: number | null = null
    let contaId: string | null = normalizeId(lancamento?.bank_account_id)

    try {
      if (contaId) {
        const { data: conta } = await supabase.from('bank_accounts').select('*').eq('id', contaId).eq('organization_id', organizationId).single()

        if (!conta) {
          warnings.push('Conta bancária não encontrada ou acesso negado (extrato não registrado)')
          contaId = null
        } else {
          const { data: extratosExistentes } = await supabase.from('bank_account_statements').select('id').eq('bank_account_id', contaId).eq('financial_transaction_id', entryId).eq('organization_id', organizationId)

          if (Array.isArray(extratosExistentes) && extratosExistentes.length > 0) {
            warnings.push('Já existe registro no extrato para este lançamento (extrato não duplicado)')
            contaId = null
            extratoSkippedCount += 1
          } else {
            saldoAnterior = normalizeNumber(conta?.current_balance)
            const valor = normalizeNumber(lancamento?.amount)
            const saldoPosterior = String(lancamento?.type || '') === 'income'
              ? saldoAnterior + valor
              : saldoAnterior - valor

            const { data: newExtrato } = await supabase.from('bank_account_statements').insert({
              bank_account_id: contaId,
              financial_transaction_id: entryId,
              transaction_date: lancamento?.due_date || today,
              description: lancamento?.description || `Lançamento (${entryId})`,
              transaction_type: lancamento?.type || 'expense',
              amount: valor,
              previous_balance: saldoAnterior,
              balance_after: saldoPosterior,
              notes: `Ref. ao lançamento financeiro: ${String(lancamento?.description || '')}`,
              organization_id: organizationId,
              created_by: authUser.email
            }).select().single()

            createdExtrato = newExtrato

            await supabase.from('bank_accounts').update({ current_balance: saldoPosterior, updated_by: authUser.email }).eq('id', contaId)
          }
        }
      }

      await supabase.from('financial_transactions').update({ status: 'paid', updated_by: authUser.email }).eq('id', entryId)

      if (lancamento?.employee_financial_record_id) {
        try {
          await supabase.from('employee_financial_records').update({
            status: 'paid',
            payment_date: today,
            updated_by: authUser.email
          }).eq('id', String(lancamento.employee_financial_record_id))
        } catch {
          warnings.push('Falha ao sincronizar registro do funcionário')
        }
      }

      paidCount += 1
      results.push({ ...baseResult, status: 'paid', warnings })
    } catch (error: any) {
      failedCount += 1

      // Best-effort rollback
      try { if (createdExtrato?.id) await supabase.from('bank_account_statements').delete().eq('id', createdExtrato.id) } catch {}
      try { if (contaId && saldoAnterior !== null) await supabase.from('bank_accounts').update({ current_balance: saldoAnterior, updated_by: authUser.email }).eq('id', contaId) } catch {}

      results.push({ ...baseResult, status: 'failed', message: error?.message || String(error) })
    }
  }

  return {
    organization_id: organizationId,
    data: { paidCount, skippedCount, failedCount, extratoSkippedCount, results }
  }
})
